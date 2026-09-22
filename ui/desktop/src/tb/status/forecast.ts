// TB-Software Milestone [16]: reine Logik für Phasen + Zeit-Prognose (unit-testbar, ohne React/Electron).
// - Phasen: Anfrage → Verarbeitung → Antwort (bzw. Wartet auf Eingabe).
// - Restzeit-Schätzung aus lokaler Historie der Turn-Dauern (Median); bei langen Turns optional per KI.

export type TurnPhase = 'anfrage' | 'verarbeitung' | 'antwort' | 'warten';

export const PHASE_LABEL: Record<TurnPhase, string> = {
  anfrage: 'Anfrage',
  verarbeitung: 'Verarbeitung',
  antwort: 'Antwort',
  warten: 'Wartet auf dich',
};

// Signale, die während eines Turns beobachtet werden (aus dem ACP-Snapshot abgeleitet).
export interface PhaseSignals {
  waitingForUserInput: boolean; // Berechtigung/Rückfrage offen
  toolActive: boolean; // Tool-Call / Skript / Subagent läuft
  hasResponseText: boolean; // Antworttext streamt bereits
}

// Aktuelle Phase bestimmen. Reihenfolge = Priorität.
export function derivePhase(s: PhaseSignals): TurnPhase {
  if (s.waitingForUserInput) return 'warten';
  if (s.toolActive) return 'verarbeitung';
  if (s.hasResponseText) return 'antwort';
  return 'anfrage';
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Schätzung der Turn-Dauer (ms) aus der Historie: Median der letzten Läufe. Null bei zu wenig Daten.
export function estimateTurnMs(history: number[], minSamples = 3, window = 50): number | null {
  if (history.length < minSamples) return null;
  return median(history.slice(-window));
}

// Verbleibende Zeit (ms, ≥ 0). Null, wenn keine Schätzung vorliegt. Ist die Schätzung überschritten,
// gibt 0 zurück (UI zeigt dann „gleich fertig …" statt negativ zu zählen).
export function remainingMs(estimateMs: number | null, elapsedMs: number): number | null {
  if (estimateMs == null) return null;
  return Math.max(0, estimateMs - elapsedMs);
}

// Soll für diesen Turn eine KI-Verfeinerung (auto:chat) angefragt werden?
// Ja, wenn die Schätzung über der Schwelle liegt ODER (keine Schätzung) der Turn schon lange läuft.
export function shouldAiForecast(
  estimateMs: number | null,
  elapsedMs: number,
  thresholdMs = 60000
): boolean {
  if (estimateMs != null) return estimateMs > thresholdMs;
  return elapsedMs > thresholdMs;
}

// Menschliche Kurzform „m:ss".
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Sekundenzahl aus einer KI-Antwort robust herauslesen (z. B. "~90", "90 Sekunden", "1:30").
export function parseForecastSeconds(text: string): number | null {
  if (!text) return null;
  const mmss = text.match(/(\d{1,2}):([0-5]\d)/);
  if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  const min = text.match(/(\d+(?:[.,]\d+)?)\s*(?:min|minute)/i);
  if (min) return Math.round(parseFloat(min[1].replace(',', '.')) * 60);
  const sec = text.match(/(\d+)\s*(?:s|sek|sec|second)/i);
  if (sec) return parseInt(sec[1], 10);
  const bare = text.match(/\d+/);
  return bare ? parseInt(bare[0], 10) : null;
}
