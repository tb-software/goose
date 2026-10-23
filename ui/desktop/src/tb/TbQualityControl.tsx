// TB-Software: Qualitätsregler in der Bottom-Bar (Mitarbeiter-Symbol).
// Ein simpler 1-bis-10-Regler aussen; dahinter Stufe, Modus (Automatik/Manuell) und die aktiven
// Rollen. Phase A wirkt global über die .goosehints (Main-Prozess). Siehe Konzept-Doku.
import React, { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { cn } from '../utils';
import type { TbQualityConfig, TbQualityRole } from '../preload';

function stufeLabel(stufe: number): string {
  if (stufe <= 1) return 'Einfacher Chat';
  if (stufe <= 3) return 'Leichte Prüfung';
  if (stufe <= 6) return 'Rollen + Prüfrunden';
  if (stufe <= 8) return 'Rollen mit Schleife';
  return 'Maximale Qualität';
}

export const TbQualityControl: React.FC = () => {
  const [config, setConfig] = useState<TbQualityConfig | null>(null);
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [allRoles, setAllRoles] = useState<TbQualityRole[]>([]);
  const [open, setOpen] = useState(false);
  const [stufe, setStufe] = useState(3);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electron
      .tbQualityGet()
      .then((snap) => {
        setConfig(snap.config);
        setRoleNames(snap.roleNames);
        setStufe(snap.config.stufe);
      })
      .catch(() => {});
    window.electron
      .tbQualityRoles()
      .then(setAllRoles)
      .catch(() => {});
  }, []);

  // Klick ausserhalb schliesst das Popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const apply = async (patch: Partial<TbQualityConfig>) => {
    try {
      const snap = await window.electron.tbQualitySet(patch);
      setConfig(snap.config);
      setRoleNames(snap.roleNames);
      setStufe(snap.config.stufe);
    } catch (e) {
      console.error('tbQualitySet fehlgeschlagen', e);
    }
  };

  // Regler: lokal sofort, Übernahme leicht entprellt (vermeidet Schreiben bei jedem Pixel).
  const onSlide = (val: number) => {
    setStufe(val);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => void apply({ stufe: val }), 250);
  };

  const mode = config?.mode ?? 'auto';
  const manualIds = config?.manualRoleIds ?? [];

  const toggleManualRole = (id: string) => {
    const next = manualIds.includes(id) ? manualIds.filter((x) => x !== id) : [...manualIds, id];
    void apply({ manualRoleIds: next });
  };

  return (
    <div className="relative no-drag" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Qualität und Mitarbeiter-Rollen"
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors',
          stufe > 3 ? 'bg-background-tertiary text-text-primary' : 'text-text-secondary hover:bg-background-tertiary/60'
        )}
      >
        <Users className={cn('w-3.5 h-3.5', stufe >= 7 && 'text-green-500')} />
        <span>Qualität {stufe}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-80 rounded-xl border border-border-primary bg-background-secondary shadow-lg p-3 flex flex-col gap-3 z-50">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-text-primary">Qualität {stufe} / 10</span>
            <span className="text-xs text-text-secondary">{stufeLabel(stufe)}</span>
          </div>

          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={stufe}
            onChange={(e) => onSlide(Number(e.target.value))}
            className="w-full accent-green-600"
          />
          <div className="flex justify-between text-[10px] text-text-secondary -mt-2 px-0.5">
            <span>1 einfach</span>
            <span>10 maximal</span>
          </div>

          {/* Modus */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Rollen:</span>
            <div className="flex rounded-full bg-background-tertiary/50 p-0.5 text-xs">
              <button
                onClick={() => void apply({ mode: 'auto' })}
                className={cn('px-2 py-0.5 rounded-full', mode === 'auto' ? 'bg-background-secondary text-text-primary' : 'text-text-secondary')}
              >
                Automatik
              </button>
              <button
                onClick={() => void apply({ mode: 'manuell' })}
                className={cn('px-2 py-0.5 rounded-full', mode === 'manuell' ? 'bg-background-secondary text-text-primary' : 'text-text-secondary')}
              >
                Manuell
              </button>
            </div>
          </div>

          {/* Aktive Rollen (Automatik) oder Auswahl (Manuell) */}
          {mode === 'auto' ? (
            <div className="text-xs text-text-secondary">
              {roleNames.length > 0 ? (
                <>
                  <span className="text-text-primary">{roleNames.length} aktive Rollen:</span> {roleNames.join(', ')}
                </>
              ) : (
                'Keine Rollen (einfacher Chat).'
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1 max-h-40 overflow-auto">
              {allRoles.map((r) => {
                const eligible = r.minStufe <= stufe;
                const checked = r.always || manualIds.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className={cn('flex items-center gap-2 text-xs', !eligible && 'opacity-40')}
                    title={r.always ? 'Immer aktiv (Sicherheit/Wissen)' : `ab Stufe ${r.minStufe}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={r.always || !eligible}
                      onChange={() => toggleManualRole(r.id)}
                    />
                    <span className="text-text-primary">{r.name}</span>
                    {r.always && <span className="text-text-secondary">(immer)</span>}
                  </label>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-text-secondary">
            Phase A wirkt global über die Prompt-Schicht. Höhere Stufen laufen länger und kosten mehr.
          </p>
        </div>
      )}
    </div>
  );
};
