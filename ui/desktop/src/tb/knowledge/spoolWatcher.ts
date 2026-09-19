// TB-Software Milestone [12]: liest die vom Backend geschriebenen Spool-Dateien und legt daraus
// die `.knowledge/`-Ablage an (via getestetem persistKnowledge). Läuft im Electron-Main-Prozess.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import log from '../../utils/logger';
import { persistKnowledge, type KnowledgePersistRequest } from './knowledgeWriter';

/** Von Main gesetzter, dem Backend per Env übergebener Spool-Ordner. */
export function knowledgeSpoolDir(userDataDir: string): string {
  return path.join(userDataDir, 'tb-knowledge-spool');
}

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
const inFlight = new Set<string>();

async function processFile(dir: string, name: string): Promise<void> {
  if (!name.endsWith('.json') || name.startsWith('.') || name.endsWith('.tmp')) return;
  if (inFlight.has(name)) return;
  inFlight.add(name);
  const full = path.join(dir, name);
  try {
    let payload: KnowledgePersistRequest;
    try {
      payload = JSON.parse(await fsp.readFile(full, 'utf8')) as KnowledgePersistRequest;
    } catch (e) {
      // Unlesbar/halb geschrieben: verwerfen, damit es nicht endlos wiederkehrt.
      log.warn(`knowledge spool: ungültige Datei ${name} verworfen: ${String(e)}`);
      await fsp.rm(full, { force: true }).catch(() => {});
      return;
    }
    const res = await persistKnowledge(payload);
    if (res.ok) {
      log.info(`knowledge: abgelegt (#${res.compaction}) ${res.chatDir}`);
      await fsp.rm(full, { force: true }).catch(() => {});
    } else {
      // Dauerfehler nicht endlos wiederholen: als .failed markieren.
      log.warn(`knowledge: Ablage fehlgeschlagen (${name}): ${res.error}`);
      await fsp.rename(full, `${full}.failed`).catch(() => {});
    }
  } finally {
    inFlight.delete(name);
  }
}

/** Verarbeitet alle aktuell vorhandenen Spool-Dateien einmal (exportiert für Tests). */
export async function processSpoolDir(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    await processFile(dir, name);
  }
}

/** Startet den Watcher (idempotent). Initial-Sweep + periodischer Sweep + fs.watch. */
export function startKnowledgeSpoolWatcher(dir: string): void {
  if (started) return;
  started = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* egal */
  }
  void processSpoolDir(dir);
  timer = setInterval(() => void processSpoolDir(dir), 5000);
  timer.unref?.();
  try {
    fs.watch(dir, (_event, filename) => {
      if (filename) void processFile(dir, filename.toString());
    });
  } catch (e) {
    log.warn(`knowledge spool: fs.watch nicht möglich (nur Sweep aktiv): ${String(e)}`);
  }
}

/** Nur für Tests: internen Zustand zurücksetzen. */
export function __resetSpoolWatcherForTests(): void {
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  inFlight.clear();
}
