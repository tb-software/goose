// TB-Software: zeigt in den Einstellungen den Audit-Nachweis der Risiko-Zustimmung
// (wer, wann, welche Textversion, wie bestätigt). Rein lesend.
import { useEffect, useState } from 'react';

interface Ack {
  step: number;
  text: string;
  acceptedAt: string;
}
interface Record {
  disclaimerVersion: string;
  acceptedAt: string;
  appVersion: string;
  osUser: string;
  hostname: string;
  platform: string;
  arch: string;
  method: string;
  acknowledgements: Ack[];
}

export default function RiskConsentAudit() {
  const [rec, setRec] = useState<Record | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    window.electron
      .tbGetRiskConsent?.()
      .then((r) => setRec((r?.record as Record) ?? null))
      .catch(() => setRec(null));
  }, []);

  const fmt = (iso?: string) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('de-CH');
    } catch {
      return iso;
    }
  };

  return (
    <div className="text-sm text-text-secondary">
      {!rec ? (
        <p>Noch keine Risiko-Zustimmung erfasst.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-text-primary">
            ✔ Zugestimmt am <span className="font-mono">{fmt(rec.acceptedAt)}</span>
          </p>
          <p>
            Benutzer <span className="font-mono">{rec.osUser}</span> · Gerät{' '}
            <span className="font-mono">{rec.hostname}</span> · Version{' '}
            <span className="font-mono">{rec.appVersion}</span> · Textversion{' '}
            <span className="font-mono">{rec.disclaimerVersion}</span>
          </p>
          <button
            className="text-xs underline text-text-secondary hover:text-text-primary"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Details verbergen' : `Details anzeigen (${rec.acknowledgements?.length ?? 0} Bestätigungen)`}
          </button>
          {open && (
            <ol className="mt-2 space-y-2 list-decimal pl-5">
              {rec.acknowledgements?.map((a) => (
                <li key={a.step} className="text-xs">
                  <span className="font-mono text-text-secondary">{fmt(a.acceptedAt)}</span>
                  <br />
                  {a.text}
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-text-secondary pt-1">
            Methode: {rec.method}. Nachweis lokal gespeichert (Benutzerprofil) und an die Statistik
            gemeldet.
          </p>
        </div>
      )}
    </div>
  );
}
