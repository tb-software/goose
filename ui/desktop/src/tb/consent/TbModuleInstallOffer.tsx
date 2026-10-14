// TB-Software: Angebot "Vollstaendige Installation" direkt NACH dem Consent-Gate. Wer ablehnt,
// startet TB-Goose normal. Wer zustimmt, laedt die Zusatzmodule (LenaX-DB, IP-Forwarder,
// Computer-Steuerung, LenaX-Browser) aus ihren Feeds; TB-Goose verdrahtet sie beim Neustart.
import React, { useEffect, useState } from 'react';

interface CatalogEntry {
  key: string;
  name: string;
  description: string;
  note?: string;
  available: boolean;
}
interface ModuleResult {
  key: string;
  name: string;
  ok: boolean;
  detail: string;
}

export default function TbModuleInstallOffer({ onDone }: { onDone: () => void }) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [phase, setPhase] = useState<'ask' | 'installing' | 'summary'>('ask');
  const [progress, setProgress] = useState<string>('');
  const [results, setResults] = useState<ModuleResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.electron.tbModulesCatalog?.().then((c) => {
      if (!cancelled && Array.isArray(c)) setCatalog(c);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const startInstall = async () => {
    setPhase('installing');
    const off = window.electron.onTbModulesProgress?.((p) => {
      if (p.phase === 'start') setProgress(`Lade ${p.name} (${p.index + 1}/${p.total}) …`);
      else if (p.result) setProgress(`${p.result.ok ? '✓' : '✗'} ${p.name}`);
    });
    try {
      const res = await window.electron.tbInstallModules?.();
      setResults(res?.results ?? []);
    } catch (e) {
      setResults([{ key: 'error', name: 'Installation', ok: false, detail: String(e) }]);
    } finally {
      off?.();
      setPhase('summary');
    }
  };

  const box: React.CSSProperties = {
    maxWidth: 640,
    width: '100%',
    background: 'var(--background-primary, #16161a)',
    color: 'var(--text-primary, #f2f2f4)',
    border: '1px solid #3f3f46',
    borderRadius: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    overflow: 'hidden',
  };
  const btnPrimary: React.CSSProperties = {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
  };
  const btnGhost: React.CSSProperties = {
    background: 'transparent',
    color: 'var(--text-secondary,#a1a1aa)',
    border: '1px solid #3f3f46',
    borderRadius: 8,
    padding: '10px 16px',
    cursor: 'pointer',
    fontSize: 13,
  };

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
      <div style={box}>
        <div
          style={{
            background: 'linear-gradient(90deg,#1e3a8a,#2563eb)',
            color: '#fff',
            padding: '16px 24px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>Vollständige Installation?</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            Optionale Zusatzmodule jetzt mitinstallieren
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {phase === 'ask' && (
            <>
              <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
                TB-Goose läuft auch ohne Zusatzmodule. Für den vollen Funktionsumfang können jetzt
                diese Module heruntergeladen werden (jedes aktualisiert sich später selbst):
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {catalog.map((m) => (
                  <li
                    key={m.key}
                    style={{
                      border: '1px solid #3f3f46',
                      borderRadius: 8,
                      padding: '10px 12px',
                      opacity: m.available ? 1 : 0.55,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {m.name}
                      {!m.available && (
                        <span style={{ fontSize: 11, color: '#a1a1aa', marginLeft: 8 }}>
                          (noch nicht verfügbar)
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary,#a1a1aa)', marginTop: 2 }}>
                      {m.description}
                    </div>
                    {m.note && (
                      <div style={{ fontSize: 11, color: '#d4a72c', marginTop: 4 }}>Hinweis: {m.note}</div>
                    )}
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 20 }}>
                <button onClick={onDone} style={btnGhost}>
                  Nein, jetzt starten
                </button>
                <button onClick={startInstall} style={btnPrimary}>
                  Ja, vollständig installieren
                </button>
              </div>
            </>
          )}

          {phase === 'installing' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  margin: '0 auto 16px',
                  border: '3px solid #3f3f46',
                  borderTopColor: '#2563eb',
                  borderRadius: '50%',
                  animation: 'tbspin 1s linear infinite',
                }}
              />
              <style>{'@keyframes tbspin{to{transform:rotate(360deg)}}'}</style>
              <p style={{ fontSize: 14 }}>Module werden installiert …</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary,#a1a1aa)' }}>{progress}</p>
              <p style={{ fontSize: 11, color: '#71717a' }}>
                Das kann je nach Modul einige Minuten dauern (LenaX-DB bringt grosse Modelle mit).
              </p>
            </div>
          )}

          {phase === 'summary' && (
            <>
              <p style={{ fontSize: 14, marginTop: 0 }}>Ergebnis der Installation:</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.map((r) => (
                  <li key={r.key} style={{ fontSize: 13 }}>
                    <span style={{ color: r.ok ? '#22c55e' : '#f59e0b' }}>{r.ok ? '✓' : '○'}</span>{' '}
                    <b>{r.name}</b>
                    <span style={{ color: 'var(--text-secondary,#a1a1aa)' }}> — {r.detail}</span>
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: 12, color: 'var(--text-secondary,#a1a1aa)' }}>
                Für die Aktivierung der Module muss TB-Goose einmal neu starten.
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
                <button onClick={onDone} style={btnGhost}>
                  Später (jetzt nur starten)
                </button>
                <button onClick={() => window.electron.tbRelaunch?.()} style={btnPrimary}>
                  Jetzt neu starten
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
