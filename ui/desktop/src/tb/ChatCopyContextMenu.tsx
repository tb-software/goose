import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { copyText, extractPath } from './copyPath';

type ElectronApi = {
  showItemInFolder?: (x: string) => void;
  openDirectoryInExplorer?: (dir: string) => void;
  showSaveDialog?: (o: unknown) => Promise<{ canceled?: boolean; filePath?: string }>;
  writeFile?: (filePath: string, content: string) => Promise<boolean>;
};
function electronApi(): ElectronApi | undefined {
  try {
    return (window as unknown as { electron?: ElectronApi }).electron;
  } catch {
    return undefined;
  }
}

function showInExplorer(p: string) {
  try {
    electronApi()?.showItemInFolder?.(p);
  } catch {
    /* Electron-API nicht verfuegbar */
  }
}

function openProjectFolder(dir: string) {
  try {
    electronApi()?.openDirectoryInExplorer?.(dir);
  } catch {
    /* Electron-API nicht verfuegbar */
  }
}

async function saveChatToFile(text: string) {
  const api = electronApi();
  if (!api?.showSaveDialog || !api?.writeFile) {
    void copyText(text, 'Chat kopiert (Speichern nicht verfuegbar)');
    return;
  }
  try {
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const res = await api.showSaveDialog({
      defaultPath: `TB-Goose-Chat_${ts}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    });
    if (res?.canceled || !res?.filePath) return;
    const ok = await api.writeFile(res.filePath, text);
    if (ok) toast.success('Chat gespeichert', { autoClose: 1500 });
    else toast.error('Speichern fehlgeschlagen');
  } catch {
    toast.error('Speichern fehlgeschlagen');
  }
}

// TB-Software: durchgaengiges Rechtsklick-Kontextmenue im Chat. Egal ob Tool-Call-Kopf
// ("Read Image source: D:\..."), Tabellenzelle mit Pfad, oder beliebiger Textblock - der Nutzer
// kann immer den erkannten PFAD, die AUSWAHL oder den INHALT des Blocks kopieren. Einmal um die
// Nachrichtenliste gelegt, deckt es alle Chat-Inhalte ab (kein Eingriff in jede Einzelkomponente).

interface MenuState {
  x: number;
  y: number;
  path: string | null;
  selection: string;
  blockText: string;
}

export const ChatCopyContextMenu: React.FC<{ children: React.ReactNode; workingDir?: string | null }> = ({
  children,
  workingDir,
}) => {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Hat eine innere Komponente den Rechtsklick schon behandelt (z. B. Pfad-Link in MarkdownContent)?
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // In echten Eingabefeldern das native Menue lassen.
    if (target.closest('input, textarea, [contenteditable="true"]')) return;

    const selection = (window.getSelection?.()?.toString() ?? '').trim();
    const block = target.closest('p, li, td, th, pre, code, a, span, div') as HTMLElement | null;
    const blockText = (block?.innerText ?? target.innerText ?? '').trim();
    const path = extractPath(selection || blockText);

    if (!path && !selection && !blockText) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, path, selection, blockText });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close);
    window.addEventListener('contextmenu', close); // naechster Rechtsklick schliesst das alte Menue
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [menu]);

  const item = (label: string, value: string, toastLabel: string) => (
    <button
      type="button"
      className="w-full text-left px-3 py-1.5 hover:bg-muted/50 text-text-primary cursor-pointer"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void copyText(value, toastLabel);
        setMenu(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <div ref={containerRef} onContextMenu={onContextMenu} style={{ display: 'contents' }}>
        {children}
      </div>
      {menu && (
        <div
          className="fixed z-[1000] min-w-[190px] rounded-md border border-border-primary bg-background-primary shadow-lg py-1 text-sm"
          style={{
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - 150),
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.path && item('Pfad kopieren', menu.path, 'Pfad kopiert')}
          {menu.path && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-muted/50 text-text-primary cursor-pointer"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                showInExplorer(menu.path as string);
                setMenu(null);
              }}
            >
              Im Explorer zeigen
            </button>
          )}
          {menu.selection && item('Auswahl kopieren', menu.selection, 'Auswahl kopiert')}
          {menu.blockText && menu.blockText !== menu.selection &&
            item('Inhalt kopieren', menu.blockText, 'Inhalt kopiert')}
          <div className="my-1 border-t border-border-primary" />
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-muted/50 text-text-primary cursor-pointer"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void copyText(containerRef.current?.innerText ?? '', 'Ganzer Chat kopiert');
              setMenu(null);
            }}
          >
            Ganzen Chat kopieren
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-muted/50 text-text-primary cursor-pointer"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void saveChatToFile(containerRef.current?.innerText ?? '');
              setMenu(null);
            }}
          >
            Chat als Datei speichern
          </button>
          {workingDir && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-muted/50 text-text-primary cursor-pointer"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openProjectFolder(workingDir);
                setMenu(null);
              }}
            >
              Projektordner oeffnen
            </button>
          )}
        </div>
      )}
    </>
  );
};
