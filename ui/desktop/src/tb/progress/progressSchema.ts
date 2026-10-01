// TB-Software: generische Fortschritts-Erkennung aus Tool-Ergebnissen.
// Erkennt einen "Fortschritts-Snapshot" (z. B. die n8n/lenax-flow-Transkription) in einem
// beliebigen Tool-Ergebnis-JSON und normalisiert ihn auf ein stabiles Schema, das die
// Fortschritts-Box rendern kann. Rein funktional, ohne React/Electron (unit-testbar).
import { fmtDuration } from '../status/forecast';

export type TbProgressStatus = 'queued' | 'running' | 'done' | 'error' | 'unknown';

export interface TbProgressDetail {
  label: string;
  value: string;
}

export interface TbProgress {
  taskId?: string;
  status: TbProgressStatus;
  percent?: number;
  indeterminate: boolean;
  title?: string;
  phaseText?: string;
  headline?: string;
  etaSec?: number;
  livePreview?: string;
  details: TbProgressDetail[];
  result?: Record<string, unknown>;
  error?: string;
  raw: Record<string, unknown>[];
}

const STATUS_ALIAS: Record<string, TbProgressStatus> = {
  queued: 'queued',
  preparing: 'queued',
  transcribing: 'running',
  naming: 'running',
  diarizing: 'running',
  running: 'running',
  done: 'done',
  error: 'error',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (isPlainObject(parsed)) return parsed;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        if (isPlainObject(parsed)) return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parseToolResultJson(result: unknown): Record<string, unknown> | null {
  if (!isPlainObject(result)) return null;
  const value = result.value;
  if (!isPlainObject(value)) return null;

  if (isPlainObject(value.structuredContent)) {
    return value.structuredContent;
  }

  const content = value.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const text = (block as { text?: unknown })?.text;
      if (typeof text === 'string') {
        const parsed = tryParseJsonObject(text);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

function pickNumber(json: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = json[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function pickString(json: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = json[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

function taskIdFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/taskId=([^&\s]+)/);
  return m ? m[1] : undefined;
}

function fmtSec(sec: number): string {
  return fmtDuration(sec * 1000);
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function buildDetails(json: Record<string, unknown>): TbProgressDetail[] {
  const details: TbProgressDetail[] = [];

  const inputBytes = pickNumber(json, 'inputBytes');
  if (inputBytes != null) details.push({ label: 'Groesse', value: fmtBytes(inputBytes) });

  const audioSekunden = pickNumber(json, 'audioSekunden');
  if (audioSekunden != null) details.push({ label: 'Dauer', value: fmtSec(audioSekunden) });

  const phase = pickString(json, 'phase');
  const chunkAktuell = pickNumber(json, 'chunkAktuell');
  const chunks = pickNumber(json, 'chunks');
  if (phase || (chunkAktuell != null && chunks != null)) {
    const block = chunkAktuell != null && chunks != null ? `Block ${chunkAktuell}/${chunks}` : '';
    const value = [phase, block].filter(Boolean).join('   ·   ');
    if (value) details.push({ label: 'Phase', value });
  }

  const aktuelleSekunde = pickNumber(json, 'aktuelleSekunde');
  const gesamtSekunden = pickNumber(json, 'gesamtSekunden');
  if (aktuelleSekunde != null && gesamtSekunden != null) {
    details.push({ label: 'Position', value: `${fmtSec(aktuelleSekunde)} von ${fmtSec(gesamtSekunden)}` });
  }

  const segmenteBisher = pickNumber(json, 'segmenteBisher');
  if (segmenteBisher != null) details.push({ label: 'Segmente', value: `${segmenteBisher} erkannt` });

  const laufzeitSek = pickNumber(json, 'laufzeitSek');
  const verbleibendCaSek = pickNumber(json, 'verbleibendCaSek');
  if (laufzeitSek != null) {
    const rest = verbleibendCaSek != null ? `   ·   Rest ca. ${fmtSec(verbleibendCaSek)}` : '';
    details.push({ label: 'Laeuft', value: `${fmtSec(laufzeitSek)}${rest}` });
  }

  const letzterText = pickString(json, 'letzterText');
  if (letzterText) details.push({ label: 'Zuletzt erkannt', value: letzterText });

  return details;
}

function buildHeadline(status: TbProgressStatus, json: Record<string, unknown>): string | undefined {
  if (status === 'done') {
    const result = json.ergebnis;
    if (isPlainObject(result)) {
      const parts: string[] = [];
      const anzahlSprecher = pickNumber(result, 'anzahlSprecher');
      if (anzahlSprecher != null) parts.push(`${anzahlSprecher} Sprecher`);
      const dauer = pickNumber(result, 'audioSekunden', 'dauerSek');
      if (dauer != null) parts.push(fmtSec(dauer));
      const datei = pickString(result, 'transkriptDatei');
      if (datei) parts.push(datei.split(/[/\\]/).pop() || datei);
      if (parts.length) return parts.join(' · ');
    }
    return pickString(json, 'phase');
  }
  if (status === 'error') return pickString(json, 'fehler', 'error');
  return pickString(json, 'phase', 'message');
}

export function detectProgress(json: Record<string, unknown>): TbProgress | null {
  if (!isPlainObject(json)) return null;

  const rawStatus = pickString(json, 'status');
  const mappedStatus = rawStatus ? STATUS_ALIAS[rawStatus.toLowerCase()] : undefined;
  const hasKnownStatus = mappedStatus != null;

  let percent = pickNumber(json, 'fortschrittProzent', 'progressPercent', 'percent');
  const fraction = pickNumber(json, 'fortschritt', 'progress');
  const hasPercentAlias = percent != null || fraction != null;
  if (percent == null && fraction != null) percent = Math.round(fraction * 100);
  if (percent != null) percent = Math.max(0, Math.min(100, Math.round(percent)));

  const phaseText = pickString(json, 'phase', 'message');
  const hasPhaseAlias = phaseText != null;

  let taskId = pickString(json, 'taskId', 'task_id', 'jobId', 'id');
  if (!taskId) taskId = taskIdFromUrl(pickString(json, 'statusUrl'));
  const hasTaskAlias = taskId != null;

  const confident = hasKnownStatus || (hasPercentAlias && (hasPhaseAlias || hasTaskAlias));
  if (!confident) return null;

  const status: TbProgressStatus = mappedStatus ?? 'unknown';
  const etaSec = pickNumber(json, 'verbleibendCaSek');
  const livePreview = pickString(json, 'letzterText');
  const error = pickString(json, 'fehler', 'error');
  const resultRaw = json.ergebnis;
  const result = isPlainObject(resultRaw) ? resultRaw : undefined;
  const title = pickString(json, 'title', 'titel');

  const indeterminate = percent == null && status !== 'done' && status !== 'error';

  return {
    taskId,
    status,
    percent,
    indeterminate,
    title,
    phaseText,
    headline: buildHeadline(status, json),
    etaSec,
    livePreview,
    details: buildDetails(json),
    result,
    error,
    raw: [json],
  };
}
