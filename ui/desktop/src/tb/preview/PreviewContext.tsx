// TB-Software: Auswahl-Zuständigkeit — welche Datei zeigt das Vorschau-Panel? (SRP)
// Kein Rendering, kein Dateizugriff — nur der gewählte Pfad + open/close.
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface PreviewApi {
  path: string | null;
  open: (path: string) => void;
  close: () => void;
}

const PreviewCtx = createContext<PreviewApi | null>(null);

export const PreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = useState<string | null>(null);
  const open = useCallback((p: string) => setPath(p), []);
  const close = useCallback(() => setPath(null), []);
  const value = useMemo<PreviewApi>(() => ({ path, open, close }), [path, open, close]);
  return <PreviewCtx.Provider value={value}>{children}</PreviewCtx.Provider>;
};

/** Gibt null zurück, wenn ausserhalb des Providers verwendet (Aufrufer soll dann fallbacken). */
export function usePreview(): PreviewApi | null {
  return useContext(PreviewCtx);
}
