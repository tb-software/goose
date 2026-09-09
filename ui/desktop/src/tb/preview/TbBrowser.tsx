// TB-Software: eingebetteter Browser im Vorschau-Panel (rechts).
// Nutzt Electrons <webview>-Tag (in main.ts via webPreferences.webviewTag aktiviert).
// Das Gast-Webview laeuft isoliert (eigene persistente Partition, kein nodeIntegration).
// Der Agent kann dieses Webview zusaetzlich per CDP fernsteuern (Dev: ENABLE_PLAYWRIGHT).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink } from 'lucide-react';

// Minimaler Ausschnitt der Electron-WebviewTag-API, den wir hier verwenden.
interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
}

/** "example.com" -> "https://example.com"; laesst http(s)/about: unveraendert. */
function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s) || s.startsWith('about:')) return s;
  // Sieht wie eine Suche aus (Leerzeichen, kein Punkt) -> DuckDuckGo-Suche.
  if (/\s/.test(s) || !s.includes('.')) {
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
  }
  return 'https://' + s;
}

export const TbBrowser: React.FC<{ initialUrl: string }> = ({ initialUrl }) => {
  const ref = useRef<WebviewEl | null>(null);
  const [address, setAddress] = useState(initialUrl);
  const [current, setCurrent] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

  // Navigations-Events des Webviews abonnieren.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const syncNav = () => {
      try {
        const url = el.getURL();
        if (url) {
          setCurrent(url);
          setAddress(url);
        }
        setCanBack(el.canGoBack());
        setCanFwd(el.canGoForward());
      } catch {
        /* Webview evtl. noch nicht bereit */
      }
    };
    const onStart = () => setLoading(true);
    const onStop = () => {
      setLoading(false);
      syncNav();
    };

    el.addEventListener('did-start-loading', onStart);
    el.addEventListener('did-stop-loading', onStop);
    el.addEventListener('did-navigate', syncNav);
    el.addEventListener('did-navigate-in-page', syncNav);
    return () => {
      el.removeEventListener('did-start-loading', onStart);
      el.removeEventListener('did-stop-loading', onStop);
      el.removeEventListener('did-navigate', syncNav);
      el.removeEventListener('did-navigate-in-page', syncNav);
    };
  }, []);

  const go = useCallback((raw: string) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    setCurrent(url);
    setAddress(url);
    const el = ref.current;
    if (el) void el.loadURL(url).catch(() => {});
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      go(address);
    },
    [address, go]
  );

  const btn = 'p-1.5 rounded text-text-secondary enabled:hover:bg-background-tertiary disabled:opacity-30';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Navigationsleiste */}
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-1 px-2 py-1.5 border-b border-border-primary no-drag"
      >
        <button
          type="button"
          className={btn}
          disabled={!canBack}
          title="Zurück"
          onClick={() => ref.current?.goBack()}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          className={btn}
          disabled={!canFwd}
          title="Vor"
          onClick={() => ref.current?.goForward()}
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          className={btn}
          title={loading ? 'Stopp' : 'Neu laden'}
          onClick={() => (loading ? ref.current?.stop() : ref.current?.reload())}
        >
          <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          spellCheck={false}
          placeholder="Adresse oder Suche eingeben"
          className="flex-1 min-w-0 px-2 py-1 text-xs rounded bg-background-tertiary text-text-primary outline-none"
        />
        <button
          type="button"
          className={btn}
          title="Im Standard-Browser öffnen"
          onClick={() => void window.electron.openExternal(current)}
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </form>

      {/* Das eigentliche Webview (isolierte Partition). */}
      {React.createElement('webview', {
        ref: ref as unknown as React.Ref<HTMLElement>,
        src: initialUrl,
        partition: 'persist:tbbrowser',
        allowpopups: undefined,
        // Fuellt den restlichen Panelbereich.
        style: { flex: '1 1 auto', width: '100%', border: '0', background: '#fff' },
      })}
    </div>
  );
};
