// TB-Software: Auswahl-Zuständigkeit des Vorschau-Panels (SRP).
// Zwei Quellen: ein Datei-PFAD (per IPC gelesen) ODER ein INLINE-Item
// (data:-URL direkt aus einer Chat-Nachricht, z. B. base64-Bild/Video).
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface InlineItem {
  name: string;
  dataUrl: string;
  kind: 'image' | 'video';
}

interface PreviewApi {
  path: string | null;
  inline: InlineItem | null;
  open: (path: string) => void;
  openInline: (item: InlineItem) => void;
  close: () => void;
}

const PreviewCtx = createContext<PreviewApi | null>(null);

export const PreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = useState<string | null>(null);
  const [inline, setInline] = useState<InlineItem | null>(null);

  const open = useCallback((p: string) => {
    setInline(null);
    setPath(p);
  }, []);
  const openInline = useCallback((item: InlineItem) => {
    setPath(null);
    setInline(item);
  }, []);
  const close = useCallback(() => {
    setPath(null);
    setInline(null);
  }, []);

  const value = useMemo<PreviewApi>(
    () => ({ path, inline, open, openInline, close }),
    [path, inline, open, openInline, close]
  );
  return <PreviewCtx.Provider value={value}>{children}</PreviewCtx.Provider>;
};

/** Gibt null zurück, wenn ausserhalb des Providers verwendet (Aufrufer soll dann fallbacken). */
export function usePreview(): PreviewApi | null {
  return useContext(PreviewCtx);
}
