// TB-Software: Persistenz für den Chat-Tag-Manager (Milestone [10]).
// Eigene Datei im Config-Ordner, bewusst getrennt von den Goose-Sessions (überlebt Reset,
// kein Eingriff ins ACP). Struktur:
//   { tags: [{id,name,color,note}], chatTags: { <sessionId>: [tagId,…] } }
import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import log from '../../utils/logger';

export interface TbTag {
  id: string;
  name: string;
  color: string; // Hex
  note?: string;
}
export interface TbTagsData {
  tags: TbTag[];
  chatTags: Record<string, string[]>; // sessionId -> tagIds
}

function tagsFile(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Block', 'goose', 'config', 'tb-tags.json');
}

// Drei sinnvolle Default-Tags beim ersten Start.
const DEFAULT_TAGS: TbTag[] = [
  { id: 'work', name: 'Arbeit', color: '#3b82f6', note: 'Berufliche Chats' },
  { id: 'private', name: 'Privat', color: '#22c55e', note: 'Private Chats' },
  { id: 'important', name: 'Wichtig', color: '#ef4444', note: 'Nicht aus den Augen verlieren' },
];

function readTags(): TbTagsData {
  try {
    const f = tagsFile();
    if (!fs.existsSync(f)) {
      const seeded: TbTagsData = { tags: DEFAULT_TAGS, chatTags: {} };
      writeTags(seeded);
      return seeded;
    }
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8')) as TbTagsData;
    return {
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      chatTags: parsed.chatTags && typeof parsed.chatTags === 'object' ? parsed.chatTags : {},
    };
  } catch (e) {
    log.error('[TB] readTags fehlgeschlagen', e);
    return { tags: [], chatTags: {} };
  }
}

function writeTags(data: TbTagsData): void {
  const f = tagsFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
}

export function registerTbTagsIpc(): void {
  ipcMain.handle('tb-get-tags', () => readTags());
  ipcMain.handle('tb-save-tags', (_e, data: TbTagsData) => {
    try {
      // Minimal validieren + persistieren (Renderer ist Master der Logik).
      const clean: TbTagsData = {
        tags: (data?.tags ?? []).filter((t) => t && t.id && t.name),
        chatTags: data?.chatTags ?? {},
      };
      writeTags(clean);
      return { ok: true };
    } catch (e) {
      log.error('[TB] save-tags fehlgeschlagen', e);
      return { ok: false, error: String(e) };
    }
  });
}
