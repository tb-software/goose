// TB-Software Milestone [13] — Wolke: Verwaltungsseite.
// Macht diesen PC als Wolken-Client verfügbar: Verbindung konfigurieren, an-/abschalten, Live-Status
// und Metriken beobachten. Reine Anzeige/Steuerung — die Bridge-Logik lebt im Main-Prozess.
import React, { useEffect, useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import { cn } from '../../utils';
import type { TbWolkeConfig, TbWolkeStatus } from '../../preload';

const PHASE_LABEL: Record<TbWolkeStatus['phase'], string> = {
  stopped: 'Getrennt',
  starting: 'Verbindet …',
  running: 'Verbunden',
  error: 'Fehler',
};

const PHASE_DOT: Record<TbWolkeStatus['phase'], string> = {
  stopped: 'bg-text-secondary',
  starting: 'bg-yellow-500',
  running: 'bg-green-500',
  error: 'bg-red-500',
};

export const WolkeView: React.FC = () => {
  const [config, setConfig] = useState<TbWolkeConfig | null>(null);
  const [status, setStatus] = useState<TbWolkeStatus | null>(null);
  const [queueBase, setQueueBase] = useState('');
  const [clientName, setClientName] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    window.electron
      .tbWolkeGet()
      .then(({ config: c, status: s }) => {
        setConfig(c);
        setStatus(s);
        setQueueBase(c.queueBase);
        setClientName(c.clientName);
      })
      .catch(() => {});
    const off = window.electron.onTbWolkeStatus((s) => setStatus(s));
    return off;
  }, []);

  const running = status?.phase === 'running' || status?.phase === 'starting';

  const saveConfig = async () => {
    setBusy(true);
    try {
      const { config: c, status: s } = await window.electron.tbWolkeSetConfig({ queueBase, clientName });
      setConfig(c);
      setStatus(s);
      setDirty(false);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    setBusy(true);
    try {
      // Vor dem Verbinden noch offene Änderungen übernehmen, damit die Bridge sie nutzt.
      if (!running && dirty) {
        await window.electron.tbWolkeSetConfig({ queueBase, clientName });
        setDirty(false);
      }
      const s = running ? await window.electron.tbWolkeStop() : await window.electron.tbWolkeStart();
      setStatus(s);
    } finally {
      setBusy(false);
    }
  };

  const phase = status?.phase ?? 'stopped';

  return (
    <div className="flex flex-col h-full p-4 pt-12 gap-4 overflow-auto">
      <div className="flex items-center gap-3">
        <Cloud className="w-6 h-6 text-text-primary" />
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Wolke</h1>
          <p className="text-xs text-text-secondary">
            Diesen PC als Wolken-Client bereitstellen — dein Handy oder Web-Client steuert dann diesen Rechner.
          </p>
        </div>
      </div>

      {/* Status */}
      <div className="rounded-xl border border-border-primary p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className={cn('w-2.5 h-2.5 rounded-full', PHASE_DOT[phase])} />
          <span className="text-sm font-medium text-text-primary">{PHASE_LABEL[phase]}</span>
          {status?.registered && phase === 'running' && (
            <span className="text-xs text-text-secondary">· im Client-Index sichtbar</span>
          )}
          <button
            onClick={toggle}
            disabled={busy}
            className={cn(
              'ml-auto px-4 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50',
              running
                ? 'bg-background-tertiary text-text-primary hover:bg-background-tertiary/70'
                : 'bg-green-600 text-white hover:bg-green-500'
            )}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : running ? 'Trennen' : 'Verbinden'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Metric label="Bearbeitet" value={status?.requestsServed ?? 0} />
          <Metric label="Aktiv" value={status?.activeRuns ?? 0} />
          <Metric label="Fehler" value={status?.requestsFailed ?? 0} />
        </div>

        {status?.lastError && phase === 'error' && (
          <div className="text-xs text-red-500 break-words">Letzter Fehler: {status.lastError}</div>
        )}
      </div>

      {/* Verbindung */}
      <div className="rounded-xl border border-border-primary p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-primary">Verbindung</h2>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">Wolke (Queue-Basis)</span>
          <input
            value={queueBase}
            onChange={(e) => {
              setQueueBase(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            className="bg-transparent border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">Anzeigename in der Wolke</span>
          <input
            value={clientName}
            onChange={(e) => {
              setClientName(e.target.value);
              setDirty(true);
            }}
            className="bg-transparent border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary"
          />
        </label>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">
            Client-ID: <code className="text-text-primary">{config?.clientId ?? '…'}</code>
          </span>
          <button
            onClick={saveConfig}
            disabled={busy || !dirty}
            className="ml-auto px-3 py-1 rounded-full text-xs font-medium bg-background-tertiary text-text-primary hover:bg-background-tertiary/70 disabled:opacity-40"
          >
            Speichern
          </button>
        </div>
        {running && dirty && (
          <p className="text-xs text-yellow-500">
            Änderung wird nach dem nächsten Trennen/Verbinden aktiv.
          </p>
        )}
      </div>

      <p className="text-xs text-text-secondary">
        Hinweis: Die Wolke startet ein eigenes, unbeaufsichtigtes goose-Backend für Cloud-Anfragen — getrennt
        von deinen offenen Chat-Fenstern. Berechtigungen werden dabei automatisch gewährt.
      </p>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg bg-background-tertiary/40 p-3 flex flex-col gap-0.5">
    <span className="text-lg font-semibold text-text-primary tabular-nums">{value}</span>
    <span className="text-xs text-text-secondary">{label}</span>
  </div>
);
