// TB-Software: Qualitätsregler in der Bottom-Bar (Mitarbeiter-Symbol).
// Ein simpler 1-bis-10-Regler aussen; dahinter Stufe, Modus (Automatik/Manuell) und die aktiven
// Rollen. Phase A wirkt global über die .goosehints (Main-Prozess). Siehe Konzept-Doku.
//
// Das Popover wird per Portal mit fester Position gerendert, damit es nicht vom overflow der
// Bottom-Leiste abgeschnitten wird (es klappt nach oben auf).
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users } from 'lucide-react';
import { cn } from '../utils';
import type { TbQualityConfig, TbQualityRole } from '../preload';
import { ROLE_ICONS } from './quality/icons';

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
  const [pos, setPos] = useState<{ bottom: number; right: number } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const applyConfig = (c: TbQualityConfig) => {
    setConfig(c);
    setStufe(c.stufe);
  };

  useEffect(() => {
    window.electron
      .tbQualityGet()
      .then((snap) => {
        applyConfig(snap.config);
        setRoleNames(snap.roleNames);
      })
      .catch(() => {});
    window.electron
      .tbQualityRoles()
      .then(setAllRoles)
      .catch(() => {});
  }, []);

  // Debounce-Timer beim Unmount aufraeumen (sonst feuert er nach dem Schliessen/Unmount).
  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
  }, []);

  // Klick ausserhalb von Knopf UND Popover schliesst (Popover liegt per Portal ausserhalb des Knopfes).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      setPos({ bottom: Math.round(window.innerHeight - r.top + 8), right: Math.round(window.innerWidth - r.right) });
    }
    setOpen(true);
  };

  const apply = async (patch: Partial<TbQualityConfig>) => {
    try {
      const snap = await window.electron.tbQualitySet(patch);
      applyConfig(snap.config);
      setRoleNames(snap.roleNames);
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

  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popRef}
            style={{ position: 'fixed', bottom: pos.bottom, right: pos.right }}
            className="w-80 rounded-xl border border-border-primary bg-background-secondary shadow-lg p-3 flex flex-col gap-3 z-[1000]"
          >
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
                    <span className="text-text-primary">{roleNames.length} aktive Rollen:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {roleNames.map((name) => {
                        const role = allRoles.find((r) => r.name === name);
                        const Icon = role ? ROLE_ICONS[role.id] : null;
                        return (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-background-tertiary/50 text-text-primary"
                            title={role ? `ab Stufe ${role.minStufe}` : undefined}
                          >
                            {Icon && <Icon className="w-3 h-3" />}
                            {name}
                          </span>
                        );
                      })}
                    </div>
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
                      {(() => {
                        const Icon = ROLE_ICONS[r.id];
                        return Icon ? <Icon className="w-3.5 h-3.5 text-text-secondary" /> : null;
                      })()}
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
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative no-drag">
      <button
        ref={btnRef}
        onClick={toggleOpen}
        title="Qualität und Mitarbeiter-Rollen"
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors',
          stufe > 3 ? 'bg-background-tertiary text-text-primary' : 'text-text-secondary hover:bg-background-tertiary/60'
        )}
      >
        <Users className={cn('w-3.5 h-3.5', stufe >= 7 && 'text-green-500')} />
        <span>Qualität {stufe}</span>
      </button>
      {popover}
    </div>
  );
};
