// TB-Software: korreliert mehrere Fortschritts-Snapshots (Status-Polls) zu EINER Box.
// Gleiche taskId -> eine Box; Einmal-Aufrufe ohne taskId fallen auf die Tool-Request-ID zurueck.
// Rein funktional, Muster wie utils/toolCallChaining.ts.
import { getToolRequests, getToolResponses, type Message } from '../../types/message';
import { detectProgress, parseToolResultJson, type TbProgress } from './progressSchema';

export interface TbProgressSeed {
  audioSekunden?: number;
  geschaetzteGesamtSek?: number;
  title?: string;
}

export interface TbProgressBox {
  key: string;
  taskId?: string;
  latest: TbProgress;
  raw: Record<string, unknown>[];
  seed: TbProgressSeed;
  pollCount: number;
  anchorIndex: number;
  requestIds: string[];
}

export interface CollectProgressResult {
  boxes: Map<string, TbProgressBox>;
  claimedKeys: Set<string>;
}

interface ToolCallInfo {
  name?: string;
  args?: Record<string, unknown>;
}

function getRequestCall(req: { toolCall: Record<string, unknown> }): ToolCallInfo {
  const tc = req.toolCall as {
    value?: { name?: unknown; arguments?: unknown };
    name?: unknown;
    arguments?: unknown;
  };
  const name =
    typeof tc?.value?.name === 'string'
      ? tc.value.name
      : typeof tc?.name === 'string'
        ? tc.name
        : undefined;
  const argsRaw = tc?.value?.arguments ?? tc?.arguments;
  const args =
    argsRaw && typeof argsRaw === 'object' ? (argsRaw as Record<string, unknown>) : undefined;
  return { name, args };
}

function titleFromArgs(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const source = args.file ?? args.url;
  if (typeof source !== 'string' || source.trim() === '') return undefined;
  const clean = source.split(/[?#]/)[0];
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || clean;
}

export function collectProgressBoxes(messages: Message[]): CollectProgressResult {
  const callsById = new Map<string, ToolCallInfo>();
  for (const message of messages) {
    for (const req of getToolRequests(message)) {
      callsById.set(req.id, getRequestCall(req));
    }
  }

  const boxes = new Map<string, TbProgressBox>();
  const claimedKeys = new Set<string>();

  messages.forEach((message, index) => {
    for (const resp of getToolResponses(message)) {
      const json = parseToolResultJson(resp.toolResult);
      if (!json) continue;
      const prog = detectProgress(json);
      if (!prog) continue;

      const key = prog.taskId ?? resp.id;
      let box = boxes.get(key);
      if (!box) {
        box = {
          key,
          taskId: prog.taskId,
          latest: prog,
          raw: [],
          seed: {},
          pollCount: 0,
          anchorIndex: index,
          requestIds: [],
        };
        boxes.set(key, box);
      }

      box.latest = prog;
      box.taskId = box.taskId ?? prog.taskId;
      box.anchorIndex = index;
      box.pollCount += 1;
      box.raw.push(json);
      if (!box.requestIds.includes(resp.id)) box.requestIds.push(resp.id);
      claimedKeys.add(resp.id);

      const aud = typeof json.audioSekunden === 'number' ? json.audioSekunden : undefined;
      const ges = typeof json.geschaetzteGesamtSek === 'number' ? json.geschaetzteGesamtSek : undefined;
      if (aud != null && box.seed.audioSekunden == null) box.seed.audioSekunden = aud;
      if (ges != null && box.seed.geschaetzteGesamtSek == null) box.seed.geschaetzteGesamtSek = ges;

      if (!box.seed.title) {
        const t = titleFromArgs(callsById.get(resp.id)?.args);
        if (t) box.seed.title = t;
      }
    }
  });

  return { boxes, claimedKeys };
}
