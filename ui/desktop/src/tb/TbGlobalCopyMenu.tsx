// TB-Software: App-WEITES Rechtsklick-Kopiermenue. Das reichere Chat-Menue (ChatCopyContextMenu)
// deckt nur die Nachrichtenliste ab; ueberall sonst (Seitenleiste, Vorschau-Panel, Tool-Panels,
// Kopfzeilen) gab es gar nichts. Dieses Menue haengt EINMAL am window und springt nur ein, wenn der
// Rechtsklick noch NICHT behandelt wurde (defaultPrevented) - so bleibt das Chat-Menue in der Liste
// vorrangig, und ueberall sonst kann man Pfad/Auswahl/Inhalt kopieren bzw. im Explorer zeigen.
import React, { useCallback, useEffect, useState } from 'react';
import { copyText, extractPath } from './copyPath';

function showInExplorer(p: string) {
  try {
    void (window as unknown as { electron?: { showItemInFolder?: (x: string) => void } }).electron
      ?.showItemInFolder?.(p);
  } catch {
    /* Electron-API nicht verfuegbar */
  }
}

interface MenuState {
  x: number;
  y: number;
  path: string | null;
  selection: string;
  blockText: string;
}

export const TbGlobalCopyMenu: React.FC = () => {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const onContextMenu = useCallback((e: MouseEvent) => {
    // Schon behandelt (z. B. vom reicheren Chat-Menue oder einem Eingabefeld) -> nichts tun.
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // In echten Eingabefeldern das native Menue lassen.
    if (target.closest('input, textarea, [contenteditable="true"]')) return;

    const selection = (window.getSelection?.()?.toString() ?? '').trim();
    const block = target.closest('p, li, td, th, pre, code, a, span, div, button') as HTMLElement | null;
    const blockText = (block?.innerText ?? target.innerText ?? '').trim();
    const path = extractPath(selection || blockText);

    if (!path && !selection && !blockText) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, path, selection, blockText: blockText.slice(0, 20000) });
  }, []);

  useEffect(() => {
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [onContextMenu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [menu]);

  if (!menu) return null;

  const item = (label: string, onPick: () => void) => (
    <button
      type="button"
      className="w-full text-left px-3 py-1.5 hover:bg-muted/50 text-text-primary cursor-pointer"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPick();
        setMenu(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed z-[1000] min-w-[180px] rounded-md border border-border-primary bg-background-primary shadow-lg py-1 text-sm"
      style={{
        left: Math.min(menu.x, window.innerWidth - 200),
        top: Math.min(menu.y, window.innerHeight - 140),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.path && item('Pfad kopieren', () => void copyText(menu.path as string, 'Pfad kopiert'))}
      {menu.path && item('Im Explorer zeigen', () => showInExplorer(menu.path as string))}
      {menu.selection && item('Auswahl kopieren', () => void copyText(menu.selection, 'Auswahl kopiert'))}
      {menu.blockText && menu.blockText !== menu.selection &&
        item('Inhalt kopieren', () => void copyText(menu.blockText, 'Inhalt kopiert'))}
    </div>
  );
};

export default TbGlobalCopyMenu;
