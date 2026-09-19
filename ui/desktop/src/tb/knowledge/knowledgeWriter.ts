// TB-Software Milestone [12]: schreibt beim Verdichten die parallele `.knowledge/`-Ablage.
// Rein Node (fs/path) — KEIN electron-Import, damit voll unit-testbar. Atomar (Temp+Rename),
// Fehler nie fatal (die Verdichtung darf nie an der Ablage scheitern). Format ist mit dem
// LenaX-Konzept abgestimmt (chat.md + summary.md + details/NNNN + index.json + index.md).
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { chatKnowledgePaths, type KnowledgeScope } from './knowledgePaths';

export interface KnowledgePersistRequest {
  scope: KnowledgeScope;
  workingDir: string;
  globalDir?: string | null;
  localDirName?: string | null;
  homedir?: string;

  sessionId: string;
  title: string | null;
  model?: string | null;

  /** Fertig gerenderte Zusammenfassung (Markdown-Body, ohne Front-Matter). */
  summaryText: string;
  /** Fertig gerendertes Transkript des herausgefallenen Verlaufs (Markdown-Body). */
  detailMarkdown: string;

  sourceRange?: string | null;
  detailTokens?: number | null;
  summaryTokens?: number | null;
  createdIso?: string | null;
  compactionIso?: string | null;
}

export interface KnowledgePersistResult {
  ok: boolean;
  error?: string;
  chatDir?: string;
  detailFile?: string;
  compaction?: number;
}

function yamlScalar(v: string | number | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function renderFrontMatter(
  fields: Record<string, string | number | boolean | null | undefined>
): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === '') continue;
    lines.push(`${k}: ${yamlScalar(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function nextDetailIndex(detailsDir: string): Promise<number> {
  try {
    const entries = await fs.readdir(detailsDir);
    let max = 0;
    for (const e of entries) {
      const m = /^(\d{4})__/.exec(e);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  } catch {
    return 1;
  }
}

interface ManifestCompaction {
  n: number;
  iso: string;
  detailFile: string;
  detailTokens?: number | null;
  summaryTokens?: number | null;
  sourceRange?: string | null;
}
interface ChatManifest {
  chatId: string;
  title: string | null;
  workspace: string;
  scope: KnowledgeScope;
  model?: string | null;
  created: string;
  updated: string;
  compactions: ManifestCompaction[];
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

function compactIsoFileName(iso: string): string {
  return iso.replace(/\.\d+Z?$/, '').replace(/:/g, '').replace(/[^0-9T-]/g, '');
}

interface RootIndex {
  chats: Record<
    string,
    { title: string | null; folder: string; updated: string; compactions: number }
  >;
}

function renderRootIndexMd(idx: RootIndex): string {
  const rows = Object.entries(idx.chats)
    .sort((a, b) => (a[1].updated < b[1].updated ? 1 : -1)) // neueste oben
    .map(([, c]) => {
      const title = (c.title ?? '(ohne Titel)').replace(/\|/g, '\\|');
      return `| ${title} | ${c.updated} | ${c.compactions} | [Einstieg](chats/${c.folder}/summary.md) |`;
    });
  return [
    '# Wissens-Übersicht',
    '',
    'Automatisch beim Verdichten gepflegt. Einstieg pro Chat = `summary.md`.',
    '',
    '| Chat | Zuletzt aktualisiert | Verdichtungen | Einstieg |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

/**
 * Legt beim Verdichten die Wissens-Dateien an/aktualisiert sie. Wirft NIE — gibt {ok,error} zurück.
 */
export async function persistKnowledge(
  req: KnowledgePersistRequest
): Promise<KnowledgePersistResult> {
  try {
    const nowIso = new Date().toISOString();
    const compactionIso = req.compactionIso || nowIso;
    const createdIso = req.createdIso || nowIso;

    const paths = chatKnowledgePaths({
      scope: req.scope,
      workingDir: req.workingDir,
      globalDir: req.globalDir,
      localDirName: req.localDirName,
      title: req.title,
      sessionId: req.sessionId,
      homedir: req.homedir,
    });
    const rootIndexJson = path.join(paths.root, 'index.json');

    await fs.mkdir(paths.detailsDir, { recursive: true });

    // Lokaler Scope: den ganzen .knowledge-Ordner per .gitignore aus Repos halten (Verlauf sensibel).
    if (req.scope === 'local') {
      const gi = path.join(paths.root, '.gitignore');
      if (!(await pathExists(gi))) {
        await fs
          .writeFile(gi, '# TB-Goose Wissens-Ablage – nicht versionieren\n*\n', 'utf8')
          .catch(() => {});
      }
    }

    const n = await nextDetailIndex(paths.detailsDir);
    const detailName = `${String(n).padStart(4, '0')}__${compactIsoFileName(compactionIso)}.md`;
    const detailPath = path.join(paths.detailsDir, detailName);

    // 1) Detail-Segment (neuer, unveränderlicher Datei) — Append-only.
    const detailFront = renderFrontMatter({
      type: 'chat-detail',
      chatId: req.sessionId,
      title: req.title ?? undefined,
      workspace: req.workingDir,
      scope: req.scope,
      model: req.model ?? undefined,
      created: createdIso,
      compaction: n,
      sourceRange: req.sourceRange ?? undefined,
      tokens: req.detailTokens ?? undefined,
    });
    await atomicWrite(detailPath, `${detailFront}${req.detailMarkdown.trimEnd()}\n`);

    // 2) Zusammenfassung = Einstieg (überschrieben).
    const summaryFront = renderFrontMatter({
      type: 'chat-summary',
      chatId: req.sessionId,
      title: req.title ?? undefined,
      workspace: req.workingDir,
      scope: req.scope,
      model: req.model ?? undefined,
      created: createdIso,
      compaction: n,
      tokens: req.summaryTokens ?? undefined,
    });
    await atomicWrite(paths.summaryMd, `${summaryFront}${req.summaryText.trimEnd()}\n`);

    // 3) chat.md — Kopf, nur anlegen wenn fehlt (bewahrt manuelle Ergänzungen).
    if (!(await pathExists(paths.chatMd))) {
      const chatFront = renderFrontMatter({
        type: 'chat',
        chatId: req.sessionId,
        title: req.title ?? undefined,
        workspace: req.workingDir,
        scope: req.scope,
        model: req.model ?? undefined,
        created: createdIso,
      });
      const body = [
        `# ${req.title ?? 'Chat'}`,
        '',
        `- Arbeitsordner: \`${req.workingDir}\``,
        `- Modell: ${req.model ?? '—'}`,
        `- Erstellt: ${createdIso}`,
        '',
        'Einstieg: [summary.md](summary.md) · Verlauf: [details/](details/)',
        '',
      ].join('\n');
      await atomicWrite(paths.chatMd, `${chatFront}${body}`);
    }

    // 4) index.json (Manifest je Chat).
    const manifest =
      (await readJson<ChatManifest>(paths.indexJson)) ??
      ({
        chatId: req.sessionId,
        title: req.title,
        workspace: req.workingDir,
        scope: req.scope,
        model: req.model ?? null,
        created: createdIso,
        updated: compactionIso,
        compactions: [],
      } satisfies ChatManifest);
    manifest.title = req.title;
    manifest.model = req.model ?? manifest.model ?? null;
    manifest.updated = compactionIso;
    manifest.compactions.push({
      n,
      iso: compactionIso,
      detailFile: `details/${detailName}`,
      detailTokens: req.detailTokens ?? null,
      summaryTokens: req.summaryTokens ?? null,
      sourceRange: req.sourceRange ?? null,
    });
    await atomicWrite(paths.indexJson, `${JSON.stringify(manifest, null, 2)}\n`);

    // 5) Root-Index (index.json + gerendertes index.md), Upsert je Chat.
    const folder = path.basename(paths.chatDir);
    const rootIdx =
      (await readJson<RootIndex>(rootIndexJson)) ?? ({ chats: {} } satisfies RootIndex);
    rootIdx.chats[req.sessionId] = {
      title: req.title,
      folder,
      updated: compactionIso,
      compactions: manifest.compactions.length,
    };
    await atomicWrite(rootIndexJson, `${JSON.stringify(rootIdx, null, 2)}\n`);
    await atomicWrite(paths.rootIndexMd, renderRootIndexMd(rootIdx));

    return { ok: true, chatDir: paths.chatDir, detailFile: detailPath, compaction: n };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
