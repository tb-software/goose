// TB-Software Milestone [13] — Wolke: Steuer-Bridge im Main-Prozess.
// Macht diesen PC als Wolken-Client verfügbar: registriert sich an der t78-Queue, pollt AUSGEHEND
// nach Arbeit (NAT-sicher), treibt je Cloud-Chat ein dediziertes headless `goose serve` und streamt
// die Antwort in Chunks zurück; lange Turns bleiben per Heartbeat am Leben. Ein PC = ein Client,
// daher Modul-Singleton (nicht pro Fenster).
import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import log from '../../utils/logger';
import { startGooseServe, type GooseServeResult } from '../../gooseServe';
import { createGooseAcpDriver, type WolkeAgentDriver } from './gooseAcpBridgeDriver';
import { readWolkeConfig, type WolkeConfig } from './wolkeConfig';

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

async function register(): Promise<void> {
  if (!cfg || !driver) return;
  try {
    await postJson(`${cfg.queueBase}/api/clients`, {
      clientId: cfg.clientId,
      name: cfg.clientName,
      kind: driver.kind,
      capabilities: { streaming: 'chunk', longTurns: true },
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
}

async function processOne(work: WorkItem): Promise<void> {
  if (!cfg || !driver) return;
  const base = `${cfg.queueBase}/api/work/${encodeURIComponent(work.id)}`;
  const hb = setInterval(() => {
    postJson(`${base}/heartbeat`, {}).catch(() => {});
  }, HEARTBEAT_MS);
  metrics.activeRuns++;
  emit();
  try {
    const onChunk = (text: string) => {
      postJson(`${base}/chunk`, { text }).catch(() => {});
    };
    const { text } = await driver.runTurn(work.chatId, work.text, onChunk, { model: work.model });
    await postJson(`${base}/done`, { finalText: text });
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
