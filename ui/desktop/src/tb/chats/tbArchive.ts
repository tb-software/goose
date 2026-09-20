// TB-Software Milestone [15]: Archiv-/Papierkorb-Schicht für Chats.
// „Löschen" verschiebt einen Chat NICHT physisch, sondern ins Archiv (tb-archive.json). Er ist dann
// überall im UI unsichtbar, aber vorhanden. Erst „endgültig löschen" im Papierkorb (bzw. der 60-Tage-
// Retention-Sweep) entfernt ihn physisch — dann wird zusätzlich die Wissens-Ablage aufgeräumt.
// Eigene Datei im Config-Ordner, bewusst getrennt von den ACP-Sessions (analog tb-tags.json).
import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import log from '../../utils/logger';
import {
  DEFAULT_LOCAL_DIRNAME,
  KNOWLEDGE_GLOBAL_DIR_KEY,
  KNOWLEDGE_LOCAL_DIRNAME_KEY,
  defaultGlobalKnowledgeDir,
  expandHome,
} from '../knowledge/knowledgePaths';

// 60 Tage Aufbewahrung, dann automatischer physischer Löschvorgang.
export const RETENTION_DAYS = 60;

export interface ArchiveEntry {
  archivedAt: number; // ms
  deleteAfter: number; // ms — archivedAt + 60 Tage
  workingDir?: string; // für Konsistenz-Cleanup ohne Nachladen
  name?: string; // Anzeigename im Papierkorb
}
export interface TbArchiveData {
  archived: Record<string, ArchiveEntry>; // sessionId -> Eintrag
}

function archiveFile(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Block', 'goose', 'config', 'tb-archive.json');
}

function readArchive(): TbArchiveData {
  try {
    const f = archiveFile();
    if (!fs.existsSync(f)) return { archived: {} };
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8')) as TbArchiveData;
    return { archived: parsed?.archived && typeof parsed.archived === 'object' ? parsed.archived : {} };
  } catch (e) {
    log.error('[TB] readArchive fehlgeschlagen', e);
    return { archived: {} };
  }
}

function writeArchive(data: TbArchiveData): void {
  const f = archiveFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ archived: data.archived ?? {} }, null, 2));
}

// Sessionsicherer ID-Anteil des Ordnernamens (identisch zu knowledgePaths.chatFolderName).
function safeSessionId(sessionId: string): string {
  return (sessionId || '').replace(/[^A-Za-z0-9._-]/g, '') || 'session';
}

// Kandidaten-Wurzeln der Wissens-Ablage (global + optional der lokale Working-Dir des Chats).
function knowledgeChatsDirs(workingDir?: string): string[] {
  const dirs: string[] = [];
  const globalRaw = (process.env[KNOWLEDGE_GLOBAL_DIR_KEY] ?? '').trim();
  const globalRoot = globalRaw ? path.resolve(expandHome(globalRaw)) : defaultGlobalKnowledgeDir();
  dirs.push(path.join(globalRoot, 'chats'));
  if (workingDir && workingDir.trim()) {
    const localName = (process.env[KNOWLEDGE_LOCAL_DIRNAME_KEY] ?? '').trim() || DEFAULT_LOCAL_DIRNAME;
    dirs.push(path.join(workingDir, localName, 'chats'));
  }
  return dirs;
}

// Physisches Aufräumen der Wissens-Ablage eines Chats (best effort, wirft nie).
function cleanupKnowledge(sessionId: string, workingDir?: string): { removed: string[] } {
  const removed: string[] = [];
  const suffix = `__${safeSessionId(sessionId)}`;
  for (const chatsDir of knowledgeChatsDirs(workingDir)) {
    try {
      if (!fs.existsSync(chatsDir)) continue;
      for (const entry of fs.readdirSync(chatsDir)) {
        if (entry.endsWith(suffix)) {
          const target = path.join(chatsDir, entry);
          try {
            fs.rmSync(target, { recursive: true, force: true });
            removed.push(target);
          } catch (e) {
            log.warn?.(`[TB][archive] Wissens-Ordner nicht löschbar: ${target}`, e);
          }
        }
      }
    } catch (e) {
      log.warn?.(`[TB][archive] chatsDir nicht lesbar: ${chatsDir}`, e);
    }
  }
  return { removed };
}

export function registerTbArchiveIpc(): void {
  ipcMain.handle('tb-archive-get', (): TbArchiveData => readArchive());

  ipcMain.handle('tb-archive-save', (_e, data: TbArchiveData) => {
    try {
      writeArchive({ archived: data?.archived ?? {} });
      return { ok: true };
    } catch (e) {
      log.error('[TB][archive] save fehlgeschlagen', e);
      return { ok: false, error: String(e) };
    }
  });

  // Physisches Aufräumen der Wissens-Ablage nach endgültigem Löschen (die ACP-Session selbst löscht
  // der Renderer via acpDeleteSession; Tags räumt der Tag-Store). Best effort.
  ipcMain.handle('tb-archive-cleanup', (_e, sessionId: string, workingDir?: string) => {
    try {
      return { ok: true, ...cleanupKnowledge(sessionId, workingDir) };
    } catch (e) {
      log.warn?.('[TB][archive] cleanup fehlgeschlagen', e);
      return { ok: false, error: String(e), removed: [] };
    }
  });
}
