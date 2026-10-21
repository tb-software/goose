// TB-Software: Kleine Bereitschaftsanzeige im Chat fuer die MCP-Erweiterungen. Beim Start einer
// Sitzung verbindet goose alle aktiven Erweiterungen synchron - das kann (lenax-db-Warmup,
// computer-use ohne TBRD) dauern oder fehlschlagen und wirkt sonst wie eine unerklaerliche Haenger.
// Diese Leiste macht sichtbar: "wird verbunden" bzw. "X von Y verbunden, Z nicht erreichbar".
import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';

interface ExtResult {
  name: string;
  success: boolean;
}

type Phase = 'idle' | 'loading' | 'done';

export default function TbExtensionReadiness() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<ExtResult[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { phase: 'loading' | 'done'; results?: ExtResult[] }
        | undefined;
      if (!detail) return;
      setDismissed(false);
      if (detail.phase === 'loading') {
        if (hideTimer) clearTimeout(hideTimer);
        setPhase('loading');
        return;
      }
      // done
      const res = Array.isArray(detail.results) ? detail.results : [];
      setResults(res);
      setPhase('done');
      const failed = res.filter((r) => !r.success);
      if (failed.length === 0) {
        // Alles verbunden -> kurz bestaetigen, dann ausblenden.
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => setPhase('idle'), 2500);
      }
    };
    window.addEventListener('tb:extensions-status', onStatus);
    return () => {
      window.removeEventListener('tb:extensions-status', onStatus);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  if (phase === 'idle' || dismissed) return null;

  const total = results.length;
  const ok = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  if (phase === 'loading') {
    return (
      <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-border-primary bg-background-secondary px-3 py-1.5 text-xs text-text-secondary">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-text-secondary border-t-transparent" />
        Erweiterungen werden verbunden - beim ersten Start kann das einige Sekunden dauern.
      </div>
    );
  }

  // phase === 'done'
  if (failed.length === 0) {
    return (
      <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-xs text-text-secondary">
        <span className="text-green-600 dark:text-green-400">✓</span>
        Alle Erweiterungen verbunden{total > 0 ? ` (${ok}/${total})` : ''}.
      </div>
    );
  }

  return (
    <div className="mx-4 mt-2 flex items-start justify-between gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-xs">
      <div className="min-w-0 text-text-primary">
        <div className="font-medium flex items-center gap-1">
          <Info className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-500" />
          {ok} von {total} Erweiterungen verbunden - {failed.length} nicht erreichbar
        </div>
        <div className="text-text-secondary mt-1 break-words">
          Nicht verbunden: {failed.map((f) => f.name).join(', ')}. Pruefen unter Einstellungen -
          Erweiterungen (z. B. Computer-Steuerung braucht einen laufenden TBRD-Client; LenaX-DB laedt
          beim ersten Start sein Modell).
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-text-secondary hover:text-text-primary shrink-0"
        aria-label="Hinweis ausblenden"
        title="Ausblenden"
      >
        ✕
      </button>
    </div>
  );
}
