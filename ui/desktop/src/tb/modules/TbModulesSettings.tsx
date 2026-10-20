// TB-Software: Einstellungen -> Zusatzmodule verwalten. Zeigt je Modul den Installationsstatus und
// erlaubt Installieren / Neu installieren (einzeln oder alle). Nach dem Installieren muss TB-Goose
// einmal neu starten, damit das Backend die MCPs seedet/laedt.
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

interface ModuleStatus {
  key: string;
  name: string;
  description: string;
  note?: string;
  available: boolean;
  installed: boolean;
  target: string;
}

export default function TbModulesSettings() {
  const [mods, setMods] = useState<ModuleStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // key oder '__all__'
  const [progress, setProgress] = useState('');
  const [needsRestart, setNeedsRestart] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await window.electron.tbModulesStatus?.();
      if (Array.isArray(s)) setMods(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = useCallback(
    async (key?: string) => {
      setBusy(key ?? '__all__');
      setProgress('');
      const off = window.electron.onTbModulesProgress?.((p) => {
        if (p.phase === 'start') setProgress(`Lade ${p.name} …`);
        else if (p.result) setProgress(`${p.result.ok ? '✓' : '✗'} ${p.name}`);
      });
      try {
        const res = await window.electron.tbInstallModules?.(key);
        if (res?.results?.some((r) => r.ok)) setNeedsRestart(true);
      } finally {
        off?.();
        setBusy(null);
        setProgress('');
        await refresh();
      }
    },
    [refresh]
  );

  const anyInstallable = mods.some((m) => m.available && !m.installed);

  return (
    <Card className="pb-4">
      <CardHeader className="pb-0">
        <CardTitle>Zusatzmodule</CardTitle>
        <CardDescription>
          Optionale Module (Suche/RAG, Browser-Steuerung, Computer-Steuerung, Tunnel). Nach dem
          Installieren einmal neu starten, damit TB-Goose sie verbindet.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="default"
            size="sm"
            disabled={busy !== null || !anyInstallable}
            onClick={() => install()}
          >
            {busy === '__all__' ? 'Installiere …' : 'Fehlende installieren / aktualisieren'}
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refresh()}>
            Status aktualisieren
          </Button>
          {progress && <span className="text-xs text-text-secondary">{progress}</span>}
        </div>

        <div className="flex flex-col gap-2">
          {mods.map((m) => (
            <div
              key={m.key}
              className="flex items-start justify-between gap-3 border border-border-primary rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary flex items-center gap-2">
                  {m.name}
                  {m.installed ? (
                    <span className="text-[11px] text-green-600 dark:text-green-400">✓ installiert</span>
                  ) : m.available ? (
                    <span className="text-[11px] text-text-secondary">nicht installiert</span>
                  ) : (
                    <span className="text-[11px] text-text-secondary">nicht verfügbar</span>
                  )}
                </div>
                <div className="text-xs text-text-secondary mt-[2px]">{m.description}</div>
                {m.note && <div className="text-[11px] text-yellow-600 dark:text-yellow-500 mt-1">Hinweis: {m.note}</div>}
                {m.installed && (
                  <div className="text-[11px] text-text-secondary mt-1 truncate" title={m.target}>
                    {m.target}
                  </div>
                )}
              </div>
              {m.available && (
                <Button
                  variant={m.installed ? 'outline' : 'default'}
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => install(m.key)}
                >
                  {busy === m.key ? '…' : m.installed ? 'Neu installieren' : 'Installieren'}
                </Button>
              )}
            </div>
          ))}
        </div>

        {needsRestart && (
          <div className="mt-4 flex items-center justify-between gap-3 border border-blue-500/50 bg-blue-500/10 rounded-lg px-3 py-2">
            <span className="text-sm text-text-primary">
              Module installiert - zur Aktivierung muss TB-Goose neu starten.
            </span>
            <Button variant="default" size="sm" onClick={() => window.electron.tbRelaunch?.()}>
              Jetzt neu starten
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
