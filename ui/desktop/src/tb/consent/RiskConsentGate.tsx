// TB-Software: Blockierender Erst-Start-Warnhinweis mit DREIFACHER Bestätigung.
// Bis alle drei Warnungen aktiv bestätigt sind, ist die App nicht bedienbar. Jede Bestätigung
// wird mit Zeitstempel erfasst und als Audit gespeichert (lokal + Statistik).
import React, { useEffect, useState } from 'react';

// Die drei Warntexte. Genau DIESE Texte werden auch im Audit gespeichert (Beweiskraft).
const STEPS: string[] = [
  'TB-Goose ist ein autonomer KI-Agent. Er kann auf diesem Computer selbstständig Dateien und Ordner ERSTELLEN, VERÄNDERN und UNWIDERRUFLICH LÖSCHEN — ohne einzelne Rückfrage und auch in großem Umfang.',
  'Dieser Zugriff ist NICHT auf diesen Computer begrenzt. Verbundene Netzlaufwerke, Server, freigegebene Ordner und jedes über dieses Gerät erreichbare System können ebenso verändert, beschädigt oder zerstört werden.',
  'Es gibt KEIN garantiertes Rückgängigmachen und KEIN automatisches Backup durch TB-Goose. Ich nutze TB-Goose auf eigenes Risiko und übernehme die VOLLE VERANTWORTUNG für alle Aktionen, die der Agent in meinem Namen ausführt.',
];

interface Ack {
  step: number;
  text: string;
  acceptedAt: string;
}

export default function RiskConsentGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'blocked' | 'accepted'>('loading');
  const [step, setStep] = useState(0); // 0..2 aktueller Schritt
  const [checked, setChecked] = useState(false);
  const [acks, setAcks] = useState<Ack[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const p = window.electron.tbGetRiskConsent?.();
    if (!p) {
      // Preload kennt die API nicht (alter Build) -> sicherheitshalber blockieren.
      setState('blocked');
      return;
    }
    p.then((r) => {
      if (cancelled) return;
      setState(r?.accepted ? 'accepted' : 'blocked');
    }).catch(() => !cancelled && setState('blocked'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') return null;
  if (state === 'accepted') return <>{children}</>;

  const confirmStep = async () => {
    if (!checked) return;
    const ack: Ack = { step: step + 1, text: STEPS[step], acceptedAt: new Date().toISOString() };
    const nextAcks = [...acks, ack];
    setAcks(nextAcks);
    setChecked(false);
    setError(null);

    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    // Letzter Schritt -> Audit schreiben.
    setSubmitting(true);
    try {
      const res = await window.electron.tbAcceptRiskConsent?.(nextAcks);
      if (res?.ok) {
        setState('accepted');
      } else {
        setError(res?.error || 'Speichern der Zustimmung fehlgeschlagen.');
        setSubmitting(false);
      }
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  const decline = () => {
    // Ohne Zustimmung keine Nutzung -> Fenster schließen (App beenden).
    window.electron.closeWindow?.();
  };

  const isLast = step === STEPS.length - 1;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,10,12,0.92)',
        backdropFilter: 'blur(2px)',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 640,
          width: '100%',
          background: 'var(--background-primary, #16161a)',
          color: 'var(--text-primary, #f2f2f4)',
          border: '1px solid #7f1d1d',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(90deg,#7f1d1d,#b91c1c)',
            color: '#fff',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 26, lineHeight: 1 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              Wichtige Sicherheitswarnung — bitte sorgfältig lesen
            </div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              Bestätigung {step + 1} von {STEPS.length}
            </div>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0 }}>{STEPS[step]}</p>

          <label
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              marginTop: 20,
              cursor: 'pointer',
              padding: 12,
              border: '1px solid #7f1d1d',
              borderRadius: 8,
              background: 'rgba(185,28,28,0.08)',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              style={{ marginTop: 3, width: 18, height: 18, accentColor: '#b91c1c' }}
            />
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              Ich habe diese Warnung gelesen und verstanden und stimme ihr ausdrücklich zu.
            </span>
          </label>

          {error && (
            <p style={{ color: '#f87171', fontSize: 13, marginTop: 12 }}>{error}</p>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 24,
              gap: 12,
            }}
          >
            <button
              onClick={decline}
              disabled={submitting}
              style={{
                background: 'transparent',
                color: 'var(--text-secondary,#a1a1aa)',
                border: '1px solid #3f3f46',
                borderRadius: 8,
                padding: '10px 16px',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Ablehnen & App beenden
            </button>
            <button
              onClick={confirmStep}
              disabled={!checked || submitting}
              style={{
                background: !checked || submitting ? '#4b1113' : '#b91c1c',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 20px',
                cursor: !checked || submitting ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 700,
                opacity: !checked || submitting ? 0.6 : 1,
              }}
            >
              {submitting
                ? 'Wird gespeichert…'
                : isLast
                  ? 'Endgültig zustimmen & starten'
                  : `Bestätigen (${step + 1}/${STEPS.length}) — weiter`}
            </button>
          </div>

          <p
            style={{
              fontSize: 11,
              color: 'var(--text-secondary,#71717a)',
              marginTop: 16,
              marginBottom: 0,
            }}
          >
            Ihre Zustimmung wird mit Zeitstempel als Nachweis gespeichert (lokal im Benutzerprofil
            und in der Statistik). Ohne vollständige Zustimmung ist TB-Goose nicht nutzbar.
          </p>
        </div>
      </div>
    </div>
  );
}
