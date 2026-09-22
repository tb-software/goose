// TB-Software Milestone [16]: Live-Status eines laufenden Turns — Phase + Zeit-Prognose.
// Leitet die Phase aus den Notifications ab (chatState bleibt währenddessen konstant „Streaming"),
// misst die Turn-Dauer über activePromptAttemptId (stabiler Turn-Schlüssel), schätzt die Restzeit aus
// der lokalen Historie (Median) und verfeinert lange Turns optional per auto:chat (Teil C).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAcpChatSessionSnapshot } from '../../acp/chatSessionStore';
import { ChatState } from '../../types/chatState';
import {
  derivePhase,
  estimateTurnMs,
  remainingMs,
  shouldAiForecast,
  parseForecastSeconds,
  PHASE_LABEL,
  type TurnPhase,
} from './forecast';

const HISTORY_KEY = 'lenax.turnstats.v1';
const AI_ENABLED_KEY = 'lenax.forecast.ai';
const MAX_HISTORY = 100;

function loadHistory(): number[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number' && n > 0) : [];
  } catch {
    return [];
  }
}
function saveHistory(list: number[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}
function aiEnabled(): boolean {
  try {
    return localStorage.getItem(AI_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') {
      const txt = (m.content || [])
        .filter((c: { type?: string }) => c?.type === 'text')
        .map((c: { text?: string }) => c.text || '')
        .join(' ')
        .trim();
      return txt.slice(0, 300);
    }
  }
  return '';
}

// Phasen-Signale aus dem Nachrichten-Tail des aktuellen Turns ableiten.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeSignals(messages: any[], chatState: ChatState, progressMessage?: string) {
  const toolReq = new Set<string>();
  const toolResp = new Set<string>();
  let hasText = false;
  let hasThinking = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') break; // Turn-Grenze
    for (const c of m?.content || []) {
      if (c?.type === 'toolRequest') toolReq.add(c.id);
      else if (c?.type === 'toolResponse') toolResp.add(c.id);
      else if (c?.type === 'text' && typeof c.text === 'string' && c.text.trim()) hasText = true;
      else if (c?.type === 'thinking') hasThinking = true;
    }
  }
  const toolRunning = [...toolReq].some((id) => !toolResp.has(id));
  return {
    waitingForUserInput: chatState === ChatState.WaitingForUserInput,
    toolActive: toolRunning || !!progressMessage || (hasThinking && !hasText),
    hasResponseText: hasText,
  };
}

export interface TurnStatus {
  active: boolean;
  phase: TurnPhase;
  phaseLabel: string;
  elapsedMs: number;
  estimateMs: number | null;
  remainingMs: number | null;
  source: 'ai' | 'history' | null;
}

export function useTurnStatus(sessionId: string | undefined): TurnStatus {
  const snap = useAcpChatSessionSnapshot(sessionId ?? '');
  const attemptId = snap?.activePromptAttemptId ?? null;
  const active = attemptId != null;
  const chatState = snap?.chatState ?? ChatState.Idle;
  const progressMessage = snap?.progressMessage;
  const messages = useMemo(() => snap?.messages ?? [], [snap?.messages]);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [history, setHistory] = useState<number[]>(() => loadHistory());
  const [aiTotalMs, setAiTotalMs] = useState<number | null>(null);

  const startRef = useRef<number>(0);
  const prevAttemptRef = useRef<string | null>(null);
  const aiRequestedRef = useRef(false);

  const signals = useMemo(
    () => computeSignals(messages, chatState, progressMessage),
    [messages, chatState, progressMessage]
  );
  const phase = derivePhase(signals);

  // Turn-Grenzen: Start bei Wechsel auf neue attemptId, Ende bei Wechsel auf null (Dauer merken).
  useEffect(() => {
    const cur = attemptId;
    const prev = prevAttemptRef.current;
    if (cur && cur !== prev) {
      startRef.current = Date.now();
      aiRequestedRef.current = false;
      setAiTotalMs(null);
      setElapsedMs(0);
    } else if (!cur && prev) {
      const dur = Date.now() - startRef.current;
      if (dur > 800 && dur < 2 * 60 * 60 * 1000) {
        setHistory((prevH) => {
          const next = [...prevH, dur].slice(-MAX_HISTORY);
          saveHistory(next);
          return next;
        });
      }
    }
    prevAttemptRef.current = cur;
  }, [attemptId]);

  // Verstrichene Zeit sekündlich fortschreiben, solange aktiv.
  useEffect(() => {
    if (!active) return;
    setElapsedMs(Date.now() - (startRef.current || Date.now()));
    const t = setInterval(() => setElapsedMs(Date.now() - (startRef.current || Date.now())), 500);
    return () => clearInterval(t);
  }, [active]);

  const heuristicMs = useMemo(() => estimateTurnMs(history), [history]);
  const estimateMs = aiTotalMs ?? heuristicMs;
  const source: TurnStatus['source'] = aiTotalMs != null ? 'ai' : heuristicMs != null ? 'history' : null;
  const remaining = active ? remainingMs(estimateMs, elapsedMs) : null;

  // Teil C: einmalige KI-Verfeinerung bei langen Turns (auto:chat), gedrosselt + config-gesteuert.
  useEffect(() => {
    if (!active || aiRequestedRef.current || !aiEnabled()) return;
    if (!shouldAiForecast(heuristicMs, elapsedMs)) return;
    aiRequestedRef.current = true;
    const task = lastUserText(messages);
    const elapsedS = Math.round(elapsedMs / 1000);
    window.electron
      .tbForecast?.({ task, elapsedS, phase })
      .then((r) => {
        if (r?.ok && r.text) {
          const secs = parseForecastSeconds(r.text);
          if (secs && secs > 0) {
            // Modell liefert Rest-Sekunden; Gesamt = bereits verstrichen + Rest (stabil ab Turn-Start).
            setAiTotalMs(Date.now() - startRef.current + secs * 1000);
          }
        }
      })
      .catch(() => {});
  }, [active, elapsedMs, heuristicMs, phase, messages]);

  return {
    active,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    elapsedMs,
    estimateMs,
    remainingMs: remaining,
    source,
  };
}
