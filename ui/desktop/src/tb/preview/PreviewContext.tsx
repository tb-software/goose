// TB-Software: Auswahl-Zuständigkeit des Vorschau-Panels (SRP).
// Drei Quellen: ein Datei-PFAD (per IPC gelesen), ein INLINE-Item (data:-URL direkt
// aus einer Chat-Nachricht, z. B. base64-Bild/Video) ODER ein eingebetteter BROWSER
// (webview) mit Start-URL. Immer nur eine Quelle aktiv.
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
    setPath(p);
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
