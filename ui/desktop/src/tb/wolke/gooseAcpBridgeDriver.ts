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

export interface WolkeTurnOptions {
  model?: string | null; // gewünschtes LLM (z. B. auto:chat / auto:code), pro Anfrage aus der Wolke.
}
export interface WolkeAgentDriver {
  kind: string;
  runTurn: (
    chatId: string,
    text: string,
    onChunk: (t: string) => void,
    opts?: WolkeTurnOptions
  ) => Promise<{ text: string }>;
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
    unstable_sessionUpdate: () => {},
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

  // Modell pro Session setzen (nur bei Änderung), so wie die Desktop-UI via session.setConfigOption.
  async function applyModel(sid: string, model: string | null | undefined): Promise<void> {
    if (!model || appliedModel.get(sid) === model) return;
    try {
      await client.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: sid,
        configId: 'model',
        value: model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      appliedModel.set(sid, model);
    } catch {
      /* Modell nicht setzbar -> Session-Default nutzen */
    }
  }

  return {
    kind: 'goose',
    async runTurn(chatId, text, onChunk, opts) {
      const sid = await ensureSession(chatId);
      await applyModel(sid, opts?.model);
      let acc = '';
      chunkSinks.set(sid, (t) => {
        acc += t;
        onChunk(t);
      });
      try {
        await client.connection.agent.request(methods.agent.session.prompt, {
          sessionId: sid,
          prompt: [{ type: 'text', text }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        return { text: acc };
      } finally {
        chunkSinks.delete(sid);
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
