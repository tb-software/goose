// TB-Software: schmale Metrik-/Statistik-Leiste am unteren Rand des Chats.
// Zeigt echte Kennzahlen des aktuellen Chats (keine erfundenen Werte) plus einen
// Sparkline-Graphen des Kontext-Token-Verlaufs. Bewusst self-contained: nutzt nur
// die Werte, die BaseChat ohnehin schon berechnet (Tokens/Kosten/messages/session).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Coins, Gauge, Clock, Database } from 'lucide-react';

interface TbMetricsBarProps {
  messages: Array<{ role?: string; created?: number }>;
  totalTokens?: number;
  contextLimit?: number;
  cost?: number;
  sessionStartMs?: number;
}

const fmtTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
};

const Stat: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  title?: string;
}> = ({ icon, label, value, title }) => (
  <div className="flex items-center gap-1.5 whitespace-nowrap" title={title}>
    <span className="text-text-muted">{icon}</span>
    <span className="text-text-muted">{label}</span>
    <span className="font-medium text-text-standard tabular-nums">{value}</span>
  </div>
);

/** Mini-Sparkline (SVG) für eine Zahlenreihe; Farbe aus dem Theme-Token. */
const Sparkline: React.FC<{ data: number[]; width?: number; height?: number }> = ({
  data,
  width = 96,
  height = 20,
}) => {
  if (data.length < 2) {
    return <div style={{ width, height }} className="text-text-muted text-[10px] leading-5">—</div>;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / span) * (height - 3) - 1.5).toFixed(1)}`)
    .join(' ');
  const lastX = (data.length - 1) * stepX;
  const lastY = height - ((data[data.length - 1] - min) / span) * (height - 3) - 1.5;
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-text-accent"
      />
      <circle cx={lastX} cy={lastY} r="2" className="fill-current text-text-accent" />
    </svg>
  );
};

export const TbMetricsBar: React.FC<TbMetricsBarProps> = ({
  messages,
  totalTokens,
  contextLimit,
  cost,
  sessionStartMs,
}) => {
  // Kontext-Token-Verlauf mitschneiden (jede Änderung ein Punkt), gedeckelt.
  const [series, setSeries] = useState<number[]>([]);
  const lastRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typeof totalTokens === 'number' && totalTokens !== lastRef.current) {
      lastRef.current = totalTokens;
      setSeries((prev) => [...prev, totalTokens].slice(-40));
    }
  }, [totalTokens]);

  // Laufende Dauer (aktualisiert alle 10 s).
  const startMs = useMemo(() => {
    if (sessionStartMs) return sessionStartMs;
    const firstWithTime = messages.find((m) => typeof m.created === 'number');
    return firstWithTime?.created ? firstWithTime.created * 1000 : Date.now();
  }, [sessionStartMs, messages]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const userCount = messages.filter((m) => m.role === 'user').length;
  const used = totalTokens ?? 0;
  const limit = contextLimit ?? 0;
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const remaining = limit > 0 ? Math.max(0, limit - used) : 0;

  return (
    <div className="no-drag mx-4 mb-2 flex items-center gap-4 overflow-x-auto rounded-lg border border-border-subtle bg-background-muted px-3 py-1.5 text-[11px] text-text-muted">
      <Stat
        icon={<MessageSquare className="w-3.5 h-3.5" />}
        label="Anfragen"
        value={String(userCount)}
        title={`${messages.length} Nachrichten insgesamt`}
      />
      <Stat
        icon={<Gauge className="w-3.5 h-3.5" />}
        label="Kontext"
        value={limit > 0 ? `${fmtTokens(used)}/${fmtTokens(limit)} (${pct}%)` : fmtTokens(used)}
        title="Belegter Kontext des aktuellen Chats"
      />
      {limit > 0 && (
        <Stat
          icon={<Database className="w-3.5 h-3.5" />}
          label="Frei"
          value={fmtTokens(remaining)}
          title="Verbleibender Kontext bis zum Limit"
        />
      )}
      {typeof cost === 'number' && cost > 0 && (
        <Stat
          icon={<Coins className="w-3.5 h-3.5" />}
          label="Kosten"
          value={`$${cost.toFixed(4)}`}
          title="Kosten dieser Sitzung"
        />
      )}
      <Stat
        icon={<Clock className="w-3.5 h-3.5" />}
        label="Dauer"
        value={fmtDuration(now - startMs)}
        title="Dauer dieser Sitzung"
      />
      <div className="ml-auto flex items-center gap-2">
        <span className="text-text-muted">Token-Verlauf</span>
        <Sparkline data={series} />
      </div>
    </div>
  );
};
