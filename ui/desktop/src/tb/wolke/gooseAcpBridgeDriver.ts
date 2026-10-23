// TB-Software Milestone [13] — Wolke: headless ACP-Treiber im Main-Prozess.
//
// Rolle: EIN ACP-CLIENT (kein MCP), 1:1 zur Desktop-UI (`src/acp/acpConnection.ts`):
// WebSocket-Stream -> connectGooseAcpClient -> initialize -> session/new(cwd) -> session/prompt(text)
// -> sessionUpdate-Chunks (agent_message_chunk) sammeln. Anders als der Standalone-`.mjs`-Treiber
// nutzt dieser die App-eigenen ACP-SDKs direkt (statische Imports, kein NODE_PATH) und läuft gegen
// ein dediziertes, vom Main-Prozess gestartetes `goose serve` (plain ws, localhost).
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { DEFAULT_GOOSE_MCP_HOST_CAPABILITIES } from '@aaif/goose-acp-client';
import { connectGooseAcpClient } from '../../acp/gooseAcpClient';

// Bild-Anhang aus der Wolke (Screenshots/Fotos aus dem Web), base64 wie im ACP-Bildinhalt.
export interface WolkeAttachment {
  type?: string; // nur 'image' wird weitergegeben; Dokumente kommen bereits als Text an.
  name?: string;
  mimeType?: string;
  data?: string; // base64 ohne data:-Präfix
}
// Nutzung in OpenAI-Form, so wie die Wolken-Queue sie bei /done erwartet.
export interface WolkeUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
export interface WolkeTurnOptions {
  model?: string | null; // gewünschtes LLM (z. B. auto:chat / auto:code), pro Anfrage aus der Wolke.
  thinkingEffort?: string | null; // Denk-Aufwand: low | medium | high (leer = Session-Default).
  attachments?: WolkeAttachment[]; // Bild-Anhänge für den Prompt (Modell muss Bilder können).
  signal?: AbortSignal; // Stopp aus dem Web -> Turn abbrechen (ACP session/cancel).
}
export interface WolkeAgentDriver {
  kind: string;
  runTurn: (
    chatId: string,
    text: string,
    onChunk: (t: string) => void,
    opts?: WolkeTurnOptions
  ) => Promise<{ text: string; usage?: WolkeUsage }>;
  close: () => Promise<void>;
}

export interface GooseAcpDriverConfig {
  acpUrl: string;
  cwd: string;
  clientName?: string;
  clientVersion?: string;
}

// Eine ACP-Verbindung, viele Sessions (ein Cloud-Chat = eine Session, gecacht je chatId).
export async function createGooseAcpDriver(cfg: GooseAcpDriverConfig): Promise<WolkeAgentDriver> {
  const stream = createWebSocketStream(cfg.acpUrl, { protocols: [] });

  // sessionUpdate-Callbacks routen per sessionId auf den jeweils aktiven Chunk-Sammler.
  const chunkSinks = new Map<string, (text: string) => void>();
  // Nutzungs-Sammler je Session: die letzte message_usage-Notification des Turns gewinnt.
  const usageSinks = new Map<string, (usage: WolkeUsage) => void>();

  const callbacks = {
    sessionUpdate: (params: {
      sessionId?: string;
      update?: { sessionUpdate?: string; content?: { type?: string; text?: string } };
    }) => {
      const sid = params?.sessionId;
      const u = params?.update;
      if (sid && u?.sessionUpdate === 'agent_message_chunk' && u?.content?.type === 'text') {
        chunkSinks.get(sid)?.(u.content.text ?? '');
      }
    },
    // goose-spezifische Notifications (message_usage) kommen über diesen Kanal -> Tokens durchreichen.
    unstable_sessionUpdate: (params: {
      sessionId?: string;
      update?: {
        sessionUpdate?: string;
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      };
    }) => {
      const sid = params?.sessionId;
      const u = params?.update;
      if (sid && u?.sessionUpdate === 'message_usage' && u.usage) {
        const input = u.usage.inputTokens ?? 0;
        const output = u.usage.outputTokens ?? 0;
        usageSinks.get(sid)?.({
          prompt_tokens: input,
          completion_tokens: output,
          total_tokens: u.usage.totalTokens ?? input + output,
        });
      }
    },
    // Die Wolke läuft unbeaufsichtigt: Berechtigungen automatisch gewähren, Rückfragen abbrechen.
    requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'allow_always' } }),
    unstable_createElicitation: async () => ({ outcome: 'cancelled' }),
    unstable_sessionRecipeRequestParams: async () => ({}),
    unstable_providerDeviceCode: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const client = connectGooseAcpClient(stream, callbacks);

  await client.connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    _meta: { 'goose/useLoginShellPath': true },
    clientCapabilities: {
      elicitation: { form: {} },
      _meta: { goose: { mcpHostCapabilities: DEFAULT_GOOSE_MCP_HOST_CAPABILITIES, customNotifications: true } },
    },
    clientInfo: { name: cfg.clientName || 'tb-wolke-bridge', version: cfg.clientVersion || '0.1.0' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const sessions = new Map<string, string>();
  const appliedModel = new Map<string, string>(); // sessionId -> zuletzt gesetztes Modell
  const appliedEffort = new Map<string, string>(); // sessionId -> zuletzt gesetzter Denk-Aufwand
  async function ensureSession(chatId: string): Promise<string> {
    const existing = sessions.get(chatId);
    if (existing) return existing;
    const res = (await client.connection.agent.request(methods.agent.session.new, {
      cwd: cfg.cwd,
      mcpServers: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as { sessionId: string };
    sessions.set(chatId, res.sessionId);
    return res.sessionId;
  }

  // Session-Config pro Änderung setzen (Modell / Denk-Aufwand), wie die Desktop-UI via setConfigOption.
  async function applyOption(
    sid: string,
    cache: Map<string, string>,
    configId: string,
    value: string | null | undefined
  ): Promise<void> {
    if (!value || cache.get(sid) === value) return;
    try {
      await client.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: sid,
        configId,
        value,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      cache.set(sid, value);
    } catch {
      /* nicht setzbar -> Session-Default nutzen */
    }
  }

  return {
    kind: 'goose',
    async runTurn(chatId, text, onChunk, opts) {
      const sid = await ensureSession(chatId);
      await applyOption(sid, appliedModel, 'model', opts?.model);
      await applyOption(sid, appliedEffort, 'thinking_effort', opts?.thinkingEffort);
      let acc = '';
      chunkSinks.set(sid, (t) => {
        acc += t;
        onChunk(t);
      });
      let usage: WolkeUsage | undefined;
      usageSinks.set(sid, (u) => {
        usage = u;
      });

      // ACP-ContentBlocks: Text + Bild-Anhänge (base64) im selben Prompt.
      const prompt: Array<Record<string, unknown>> = [{ type: 'text', text }];
      for (const a of opts?.attachments ?? []) {
        if (a?.type === 'image' && a.data) {
          prompt.push({ type: 'image', data: a.data, mimeType: a.mimeType || 'image/png' });
        }
      }

      // Stopp aus dem Web: Signal abbrechen -> ACP session/cancel, Turn endet mit bisherigem Text.
      const onAbort = () => {
        try {
          const m = methods.agent.session.cancel;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const conn = client.connection.agent as any;
          const p = conn.notify ? conn.notify(m, { sessionId: sid }) : conn.request(m, { sessionId: sid });
          Promise.resolve(p).catch(() => {});
        } catch {
          /* ignore */
        }
      };
      if (opts?.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        await client.connection.agent.request(methods.agent.session.prompt, {
          sessionId: sid,
          prompt,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        return { text: acc, usage };
      } finally {
        chunkSinks.delete(sid);
        usageSinks.delete(sid);
        if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
      }
    },
    async close() {
      try {
        client.connection.close();
      } catch {
        /* ignore */
      }
    },
  };
}
