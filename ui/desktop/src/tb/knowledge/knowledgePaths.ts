// TB-Software Milestone [12]: Auflösung der Wissens-Ablage-Pfade (Scope × Granularität).
// Reine Logik ohne Electron/FS — dadurch unit-testbar. Das gemeinsame `.knowledge/`-Format ist mit
// dem LenaX-Konzept abgestimmt (siehe milestone[12]/_Documents/00_Konzept.md).
import * as path from 'node:path';
import * as os from 'node:os';

export type KnowledgeScope = 'local' | 'global';

// Konfig-Keys (in TB-Goose config.yaml / ENV; identische Semantik wie LenaX' lenax.new.knowledge.*).
export const KNOWLEDGE_ENABLED_KEY = 'GOOSE_KNOWLEDGE_ENABLED';
export const KNOWLEDGE_GLOBAL_DIR_KEY = 'GOOSE_KNOWLEDGE_GLOBAL_DIR';
export const KNOWLEDGE_LOCAL_DIRNAME_KEY = 'GOOSE_KNOWLEDGE_LOCAL_DIRNAME';

export const DEFAULT_LOCAL_DIRNAME = '.knowledge';

/** Gemeinsame globale Wissensbasis mit LenaX (konfigurierbar). */
export function defaultGlobalKnowledgeDir(homedir: string = os.homedir()): string {
  return path.join(homedir, 'TB-Software', 'Knowledge');
}

/** %USERPROFILE% / ~ am Anfang eines Pfads auflösen. */
export function expandHome(p: string, homedir: string = os.homedir()): string {
  let out = p.trim();
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) {
    out = path.join(homedir, out.slice(1));
  }
  return out.replace(/%USERPROFILE%/gi, homedir);
}

/** Chat-Titel -> dateisystem-sicherer Slug (ohne Akzente, klein, max 60). */
export function slugify(title: string | null | undefined): string {
  const german = (title ?? '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/[ßẞ]/g, 'ss'); // deutsche Umlaute/ß korrekt transliterieren
  const stripped = german
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, ''); // übrige kombinierende Akzente entfernen (é->e, ...)
  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'chat';
}

/** Ordnername je Chat: <slug>__<sessionId> (LenaX-Konvention). */
export function chatFolderName(title: string | null | undefined, sessionId: string): string {
  const safeId = (sessionId || '').replace(/[^A-Za-z0-9._-]/g, '') || 'session';
  return `${slugify(title)}__${safeId}`;
}

/** Detail-Segmentname: NNNN__<iso>.md (laufende Nummer + kompakter ISO-Zeitstempel). */
export function detailFileName(index: number, iso: string): string {
  const n = String(Math.max(0, Math.trunc(index))).padStart(4, '0');
  // 2026-09-19T20:51:03.123Z -> 2026-09-19T205103
  const compact = iso.replace(/\.\d+Z?$/, '').replace(/:/g, '').replace(/[^0-9T-]/g, '');
  return `${n}__${compact}.md`;
}

/** Wurzel der Wissens-Ablage für einen Chat (Scope-abhängig). */
export function resolveKnowledgeRoot(opts: {
  scope: KnowledgeScope;
  workingDir: string;
  globalDir?: string | null;
  localDirName?: string | null;
  homedir?: string;
}): string {
  const homedir = opts.homedir ?? os.homedir();
  if (opts.scope === 'global') {
    const g = (opts.globalDir ?? '').trim();
    return g.length > 0 ? path.resolve(expandHome(g, homedir)) : defaultGlobalKnowledgeDir(homedir);
  }
  const localDirName = (opts.localDirName ?? '').trim() || DEFAULT_LOCAL_DIRNAME;
  return path.join(opts.workingDir, localDirName);
}

export interface ChatKnowledgePaths {
  root: string;
  chatsDir: string;
  chatDir: string;
  chatMd: string;
  summaryMd: string;
  detailsDir: string;
  indexJson: string;
  rootIndexMd: string;
}

/** Alle Datei-/Ordnerpfade eines Chats innerhalb der aufgelösten Wurzel. */
export function chatKnowledgePaths(opts: {
  scope: KnowledgeScope;
  workingDir: string;
  globalDir?: string | null;
  localDirName?: string | null;
  title: string | null | undefined;
  sessionId: string;
  homedir?: string;
}): ChatKnowledgePaths {
  const root = resolveKnowledgeRoot(opts);
  const chatsDir = path.join(root, 'chats');
  const chatDir = path.join(chatsDir, chatFolderName(opts.title, opts.sessionId));
  return {
    root,
    chatsDir,
    chatDir,
    chatMd: path.join(chatDir, 'chat.md'),
    summaryMd: path.join(chatDir, 'summary.md'),
    detailsDir: path.join(chatDir, 'details'),
    indexJson: path.join(chatDir, 'index.json'),
    rootIndexMd: path.join(root, 'index.md'),
  };
}

/** true, wenn die Wissens-Ablage aktiv ist (Default an). Nimmt den rohen Config-Wert. */
export function knowledgeEnabled(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true; // Default AN
  if (typeof raw === 'boolean') return raw;
  return String(raw).toLowerCase() !== 'false';
}
