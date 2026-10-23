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

// Bild auf max. 256 x 256 px verkleinern und als data:image/png;base64 zurückgeben.
async function fileToScaledDataUrl(file: File, max = 256): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round((img.width || max) * scale));
  const h = Math.max(1, Math.round((img.height || max) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

export const WolkeView: React.FC = () => {
  const [config, setConfig] = useState<TbWolkeConfig | null>(null);
  const [status, setStatus] = useState<TbWolkeStatus | null>(null);
  const [queueBase, setQueueBase] = useState('');
  const [clientName, setClientName] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Profil-Felder
  const [profTitle, setProfTitle] = useState('');
  const [profSubtitle, setProfSubtitle] = useState('');
  const [profDescription, setProfDescription] = useState('');
  const [profTags, setProfTags] = useState('');
  const [profIcon, setProfIcon] = useState<string | undefined>(undefined);

  const applyConfig = (c: TbWolkeConfig) => {
    setConfig(c);
    setQueueBase(c.queueBase);
    setClientName(c.clientName);
    const p = c.profile ?? {};
    setProfTitle(p.title ?? '');
    setProfSubtitle(p.subtitle ?? '');
    setProfDescription(p.description ?? '');
    setProfTags((p.tags ?? []).join(', '));
    setProfIcon(p.icon);
  };

  useEffect(() => {
    window.electron
      .tbWolkeGet()
      .then(({ config: c, status: s }) => {
        applyConfig(c);
        setStatus(s);
      })
      .catch(() => {});
    const off = window.electron.onTbWolkeStatus((s) => setStatus(s));
    return off;
  }, []);

  const running = status?.phase === 'running' || status?.phase === 'starting';

  // Profil aus den Feldern bauen (nur gesetzte Felder; leere Schlagworte entfernt).
  const buildProfilePatch = () => {
    const tags = profTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((t) => t.slice(0, 40));
    return {
      ...(profTitle.trim() ? { title: profTitle.trim() } : {}),
      ...(profSubtitle.trim() ? { subtitle: profSubtitle.trim() } : {}),
      ...(profDescription.trim() ? { description: profDescription.trim() } : {}),
      ...(tags.length ? { tags } : {}),
      ...(profIcon ? { icon: profIcon } : {}),
    };
  };

  const saveConfig = async () => {
    setBusy(true);
    try {
      const { config: c, status: s } = await window.electron.tbWolkeSetConfig({
        queueBase,
        clientName,
        profile: buildProfilePatch(),
      });
      applyConfig(c);
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
        await window.electron.tbWolkeSetConfig({ queueBase, clientName, profile: buildProfilePatch() });
        setDirty(false);
      }
      const s = running ? await window.electron.tbWolkeStop() : await window.electron.tbWolkeStart();
      setStatus(s);
    } finally {
      setBusy(false);
    }
  };

  const onPickIcon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const url = await fileToScaledDataUrl(file);
      setProfIcon(url);
      setDirty(true);
    } catch {
      /* ungültiges Bild -> ignorieren */
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

      {/* Profil */}
      <div className="rounded-xl border border-border-primary p-4 flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Profil</h2>
          <p className="text-xs text-text-secondary">
            So erscheint diese Wolke im Info-Dialog von LenaX Chat. Keine Pfade, Benutzernamen oder Schlüssel
            eintragen - das Profil ist für alle Nutzer sichtbar.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1">
            <div className="w-16 h-16 rounded-xl overflow-hidden border border-border-primary bg-background-tertiary/40 flex items-center justify-center">
              {profIcon ? (
                <img src={profIcon} alt="Profilbild" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl">🪿</span>
              )}
            </div>
            <label className="text-xs text-text-secondary cursor-pointer hover:text-text-primary">
              Bild wählen
              <input type="file" accept="image/*" className="hidden" onChange={onPickIcon} />
            </label>
            {profIcon && (
              <button
                type="button"
                onClick={() => {
                  setProfIcon(undefined);
                  setDirty(true);
                }}
                className="text-xs text-text-secondary hover:text-red-500"
              >
                Entfernen
              </button>
            )}
          </div>

          <div className="flex-1 flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">Titel</span>
              <input
                value={profTitle}
                onChange={(e) => {
                  setProfTitle(e.target.value);
                  setDirty(true);
                }}
                placeholder={clientName}
                className="bg-transparent border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">Untertitel</span>
              <input
                value={profSubtitle}
                onChange={(e) => {
                  setProfSubtitle(e.target.value);
                  setDirty(true);
                }}
                placeholder="TB-Goose-PC"
                className="bg-transparent border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary"
              />
            </label>
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">Beschreibung</span>
          <textarea
            value={profDescription}
            onChange={(e) => {
              setProfDescription(e.target.value);
              setDirty(true);
            }}
            rows={3}
            className="bg-transparent border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary resize-y"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">Schlagworte (Komma-getrennt)</span>
          <input
            value={profTags}
            onChange={(e) => {
              setProfTags(e.target.value);
              setDirty(true);
            }}
            placeholder="z. B. Buchhaltung, Schweiz, Recht"
            className="bg-transparent border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-text-secondary"
          />
        </label>

        <div className="flex items-center">
          <span className="text-xs text-text-secondary">
            Betreiber, Agent-Version und aktive Werkzeuge werden automatisch ergänzt.
          </span>
          <button
            onClick={saveConfig}
            disabled={busy || !dirty}
            className="ml-auto px-3 py-1 rounded-full text-xs font-medium bg-background-tertiary text-text-primary hover:bg-background-tertiary/70 disabled:opacity-40"
          >
            Speichern
          </button>
        </div>
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
