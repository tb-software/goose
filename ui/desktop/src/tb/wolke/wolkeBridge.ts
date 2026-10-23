// TB-Software Milestone [13] — Wolke: Steuer-Bridge im Main-Prozess.
// Macht diesen PC als Wolken-Client verfügbar: registriert sich an der t78-Queue, pollt AUSGEHEND
// nach Arbeit (NAT-sicher), treibt je Cloud-Chat ein dediziertes headless `goose serve` und streamt
// die Antwort in Chunks zurück; lange Turns bleiben per Heartbeat am Leben. Ein PC = ein Client,
// daher Modul-Singleton (nicht pro Fenster).
import { app, net } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import log from '../../utils/logger';
import { startGooseServe, type GooseServeResult } from '../../gooseServe';
import {
  createGooseAcpDriver,
  type WolkeAgentDriver,
  type WolkeAttachment,
} from './gooseAcpBridgeDriver';
import { readWolkeConfig, type WolkeConfig, type WolkeProfile } from './wolkeConfig';

export type WolkePhase = 'stopped' | 'starting' | 'running' | 'error';

export interface WolkeStatus {
  phase: WolkePhase;
  clientId: string;
  clientName: string;
  queueBase: string;
  registered: boolean;
  activeRuns: number;
  requestsServed: number;
  requestsFailed: number;
  lastError: string | null;
  startedAt: number | null;
  lastPollAt: number | null;
}

const HEARTBEAT_MS = 15000;
const POLL_WAIT_MS = 2000;
const REGISTER_MS = 8000;
const CONCURRENCY = 4;

let phase: WolkePhase = 'stopped';
let running = false;
let serve: GooseServeResult | null = null;
let driver: WolkeAgentDriver | null = null;
let registerTimer: ReturnType<typeof setInterval> | null = null;
let cfg: WolkeConfig | null = null;
const metrics = { activeRuns: 0, requestsServed: 0, requestsFailed: 0, lastError: null as string | null };
let registered = false;
let startedAt: number | null = null;
let lastPollAt: number | null = null;
const listeners = new Set<(s: WolkeStatus) => void>();

// Renderer-Push: bei jeder Zustandsänderung den aktuellen Status verteilen.
function emit(): void {
  const s = getWolkeStatus();
  for (const l of listeners) {
    try {
      l(s);
    } catch {
      /* ignore */
    }
  }
}

export function onWolkeStatus(fn: (s: WolkeStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getWolkeStatus(): WolkeStatus {
  const c = cfg ?? readWolkeConfig();
  return {
    phase,
    clientId: c.clientId,
    clientName: c.clientName,
    queueBase: c.queueBase,
    registered,
    activeRuns: metrics.activeRuns,
    requestsServed: metrics.requestsServed,
    requestsFailed: metrics.requestsFailed,
    lastError: metrics.lastError,
    startedAt,
    lastPollAt,
  };
}

const doFetch = net.fetch as unknown as typeof globalThis.fetch;

const postJson = (url: string, body: unknown) =>
  doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// Aktive Erweiterungen aus der goose-config.yaml zählen (für die Profil-Metadaten). Defensiv: bei
// Fehlern 0/false, damit die Registrierung nie an der Profil-Berechnung scheitert.
function readExtensionStats(): { active: number; lenaxDb: boolean } {
  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const cfgFile = path.join(appData, 'Block', 'goose', 'config', 'config.yaml');
    const raw = fs.readFileSync(cfgFile, 'utf8');
    const parsed = (yaml.parse(raw) ?? {}) as {
      extensions?: Record<string, { enabled?: boolean; type?: string; cmd?: string }>;
    };
    const exts = parsed.extensions ?? {};
    let active = 0;
    let lenaxDb = false;
    for (const [key, ext] of Object.entries(exts)) {
      if (ext?.enabled === false) continue;
      active++;
      if (/lenax[-_]?db/i.test(key) || /lenax[-_]?db/i.test(ext?.cmd ?? '')) lenaxDb = true;
    }
    return { active, lenaxDb };
  } catch {
    return { active: 0, lenaxDb: false };
  }
}

// Effektives Profil: vom Nutzer gepflegte Felder (cfg.profile) über sinnvollen Vorbelegungen, die
// TB-Goose selbst kennt. KEINE Pfade/Benutzernamen/Schlüssel — das Profil ist öffentlich sichtbar.
function buildProfile(c: WolkeConfig): WolkeProfile {
  const host = os.hostname() || 'TB-Goose-PC';
  const version = (() => {
    try {
      return app.getVersion();
    } catch {
      return '';
    }
  })();
  const { active, lenaxDb } = readExtensionStats();
  const meta: Record<string, string> = {
    Betreiber: host,
    Agent: version ? `TB-Goose ${version}` : 'TB-Goose',
    Werkzeuge: `${active} aktive Erweiterungen`,
  };
  if (lenaxDb) meta['Wissen'] = 'LenaX-DB (lokal)';
  const user = c.profile ?? {};
  return {
    title: user.title ?? c.clientName,
    subtitle: user.subtitle ?? 'TB-Goose-PC',
    emoji: user.emoji ?? '🪿',
    color: user.color ?? '#4E79E0',
    ...(user.description ? { description: user.description } : {}),
    ...(user.icon ? { icon: user.icon } : {}),
    ...(user.url ? { url: user.url } : {}),
    ...(user.disclaimer ? { disclaimer: user.disclaimer } : {}),
    ...(user.owner ? { owner: user.owner } : {}),
    ...(user.tags && user.tags.length ? { tags: user.tags } : {}),
    // Nutzer-Metadaten gewinnen gegenüber den berechneten Vorbelegungen.
    meta: { ...meta, ...(user.meta ?? {}) },
  };
}

async function register(): Promise<void> {
  if (!cfg || !driver) return;
  try {
    await postJson(`${cfg.queueBase}/api/clients`, {
      clientId: cfg.clientId,
      name: cfg.clientName,
      kind: driver.kind,
      capabilities: { streaming: 'chunk', longTurns: true },
      profile: buildProfile(cfg),
    });
    if (!registered) {
      registered = true;
      emit();
    }
  } catch (e) {
    if (registered) {
      registered = false;
      emit();
    }
    log.warn?.('[TB][wolke] register fehlgeschlagen', e);
  }
}

interface WorkItem {
  id: string;
  clientId: string;
  userId: string;
  chatId: string;
  text: string;
  model?: string | null;
  thinkingEffort?: string | null;
  attachments?: WolkeAttachment[];
}

async function processOne(work: WorkItem): Promise<void> {
  if (!cfg || !driver) return;
  const base = `${cfg.queueBase}/api/work/${encodeURIComponent(work.id)}`;
  // Stopp aus dem Web: Queue antwortet auf heartbeat/chunk mit {cancel:true} -> Turn abbrechen.
  const ac = new AbortController();
  const watch = (p: Promise<Response>) =>
    p.then(async (res) => {
      try {
        const r = (await res.clone().json()) as { cancel?: boolean } | null;
        if (r && r.cancel && !ac.signal.aborted) ac.abort();
      } catch {
        /* keine/leere Antwort */
      }
      return res;
    });
  const hb = setInterval(() => {
    watch(postJson(`${base}/heartbeat`, {})).catch(() => {});
  }, HEARTBEAT_MS);
  metrics.activeRuns++;
  emit();
  try {
    const onChunk = (text: string) => {
      watch(postJson(`${base}/chunk`, { text })).catch(() => {});
    };
    const { text, usage } = await driver.runTurn(work.chatId, work.text, onChunk, {
      model: work.model,
      thinkingEffort: work.thinkingEffort,
      attachments: work.attachments ?? [],
      signal: ac.signal,
    });
    // Auch nach Abbruch den Teiltext senden: die Anfrage bleibt „abgebrochen", der Verlauf
    // bleibt aber vollständig (Queue übernimmt den Text).
    await postJson(`${base}/done`, { finalText: text, usage: usage ?? null });
    metrics.requestsServed++;
  } catch (e) {
    metrics.requestsFailed++;
    metrics.lastError = String(e);
    log.warn?.(`[TB][wolke] Turn-Fehler (${work.chatId})`, e);
    await postJson(`${base}/error`, { error: String(e) }).catch(() => {});
  } finally {
    clearInterval(hb);
    metrics.activeRuns--;
    emit();
  }
}

async function worker(): Promise<void> {
  if (!cfg) return;
  const url = `${cfg.queueBase}/api/work?clientId=${encodeURIComponent(cfg.clientId)}&waitMs=${POLL_WAIT_MS}`;
  while (running) {
    try {
      const res = await doFetch(url);
      lastPollAt = Date.now();
      if (res.status === 204) continue;
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const work = (await res.json()) as WorkItem;
      await processOne(work);
    } catch (e) {
      log.warn?.('[TB][wolke] Worker-Fehler', e);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function wolkeWorkingDir(): string {
  const dir = path.join(app.getPath('userData'), 'wolke-workdir');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Dediziertes headless `goose serve` (plain ws, localhost) für die Wolke — bewusst getrennt vom
// interaktiven Serve der Fenster, damit Cloud-Turns die lokale Bedienung nicht stören.
export async function startWolke(): Promise<WolkeStatus> {
  if (running) return getWolkeStatus();
  cfg = readWolkeConfig();
  phase = 'starting';
  metrics.lastError = null;
  emit();
  try {
    const secret = `wolke-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    serve = await startGooseServe({
      serverSecret: secret,
      dir: wolkeWorkingDir(),
      tls: false,
      isPackaged: app.isPackaged,
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      logger: log,
      readinessFetch: doFetch,
    });
    driver = await createGooseAcpDriver({ acpUrl: serve.acpUrl, cwd: serve.workingDir, clientName: cfg.clientName });

    running = true;
    startedAt = Date.now();
    phase = 'running';
    await register();
    registerTimer = setInterval(register, REGISTER_MS);
    if (registerTimer.unref) registerTimer.unref();
    for (let i = 0; i < CONCURRENCY; i++) void worker();
    emit();
  } catch (e) {
    metrics.lastError = String(e);
    phase = 'error';
    running = false;
    await teardown();
    emit();
    log.error('[TB][wolke] Start fehlgeschlagen', e);
  }
  return getWolkeStatus();
}

async function teardown(): Promise<void> {
  if (registerTimer) {
    clearInterval(registerTimer);
    registerTimer = null;
  }
  try {
    await driver?.close();
  } catch {
    /* ignore */
  }
  driver = null;
  try {
    await serve?.cleanup();
  } catch {
    /* ignore */
  }
  serve = null;
  registered = false;
}

export async function stopWolke(): Promise<WolkeStatus> {
  running = false;
  await teardown();
  phase = 'stopped';
  startedAt = null;
  metrics.activeRuns = 0;
  emit();
  return getWolkeStatus();
}

// Beim App-Start: wenn der Nutzer die Wolke aktiviert gelassen hat, automatisch verbinden.
export async function initWolke(): Promise<void> {
  cfg = readWolkeConfig();
  if (cfg.enabled) {
    void startWolke();
  }
}
