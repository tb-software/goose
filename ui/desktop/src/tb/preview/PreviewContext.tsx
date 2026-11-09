// TB-Software: Auswahl-Zuständigkeit des Vorschau-Panels (SRP).
// Drei Quellen: ein Datei-PFAD (per IPC gelesen), ein INLINE-Item (data:-URL direkt
// aus einer Chat-Nachricht, z. B. base64-Bild/Video) ODER ein eingebetteter BROWSER
// (webview) mit Start-URL. Immer nur eine Quelle aktiv.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface InlineItem {
  name: string;
  dataUrl: string;
  kind: 'image' | 'video';
}

const DEFAULT_BROWSER_URL = 'https://duckduckgo.com/';

interface PreviewApi {
  path: string | null;
  inline: InlineItem | null;
  browserUrl: string | null;
  open: (path: string) => void;
  openInline: (item: InlineItem) => void;
  openBrowser: (url?: string) => void;
  close: () => void;
}

const PreviewCtx = createContext<PreviewApi | null>(null);

export const PreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = useState<string | null>(null);
  const [inline, setInline] = useState<InlineItem | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);

  const open = useCallback((p: string) => {
    setInline(null);
    setBrowserUrl(null);
    setPath(p); // sofort anzeigen (kein Leerzustand)
    // TB-Software: danach kanonisch aufloesen. Der Main-Prozess kennt die Workdir je Fenster und
    // findet so auch einen blossen Dateinamen / relativen Pfad in einem Unterordner - EGAL wie der
    // Basis-Pfad aussieht. Nur ersetzen, wenn der Nutzer zwischenzeitlich nichts anderes geoeffnet hat.
    void window.electron
      .tbResolveFile?.(p)
      .then((r) => {
        if (r?.ok && r.path) {
          const resolved = r.path;
          setPath((cur) => (cur === p ? resolved : cur));
        }
      })
      .catch(() => {
        /* Fallback: PreviewBody zeigt ggf. "nicht gefunden" */
      });
  }, []);
  const openInline = useCallback((item: InlineItem) => {
    setPath(null);
    setBrowserUrl(null);
    setInline(item);
  }, []);
  const openBrowser = useCallback((url?: string) => {
    setPath(null);
    setInline(null);
    setBrowserUrl(url && url.trim() ? url.trim() : DEFAULT_BROWSER_URL);
  }, []);
  const close = useCallback(() => {
    setPath(null);
    setInline(null);
    setBrowserUrl(null);
  }, []);

  // TB-Software: Agenten-Steuerung. Der lenax-browser-MCP (CDP-Modus) oeffnet/navigiert den
  // eingebetteten Browser deterministisch ueber dieses globale Objekt - unabhaengig davon, ob der
  // Globus-Knopf gerade sichtbar ist (z. B. auf der Einstellungen-Route). Nur Oeffnen/Schliessen;
  // navigieren/klicken/lesen laeuft danach direkt per CDP im Webview.
  useEffect(() => {
    const w = window as unknown as { __lenaxBrowser?: unknown };
    w.__lenaxBrowser = { open: (url?: string) => openBrowser(url), close: () => close() };
    return () => {
      delete (window as unknown as { __lenaxBrowser?: unknown }).__lenaxBrowser;
    };
  }, [openBrowser, close]);

  const value = useMemo<PreviewApi>(
    () => ({ path, inline, browserUrl, open, openInline, openBrowser, close }),
    [path, inline, browserUrl, open, openInline, openBrowser, close]
  );
  return <PreviewCtx.Provider value={value}>{children}</PreviewCtx.Provider>;
};

/** Gibt null zurück, wenn ausserhalb des Providers verwendet (Aufrufer soll dann fallbacken). */
export function usePreview(): PreviewApi | null {
  return useContext(PreviewCtx);
}
