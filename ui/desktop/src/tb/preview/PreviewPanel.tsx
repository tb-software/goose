// TB-Software: Layout- + Render-Zuständigkeit des Vorschau-Panels (SRP).
// Datenzugriff läuft über window.electron.tbReadFile (kein direkter FS-Zugriff hier).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, FolderOpen, FileWarning } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import MarkdownContent from '../../components/MarkdownContent';
import { usePreview } from './PreviewContext';
import { previewKindFor, baseName, type PreviewKind } from './previewKind';
import { TbBrowser } from './TbBrowser';

interface ReadResult {
  ok: boolean;
  encoding?: 'utf8' | 'base64';
  data?: string;
  mime?: string;
  truncated?: boolean;
  error?: string;
}

const WIDTH_KEY = 'tb.preview.width';
const MIN_W = 320;
const MAX_W = 900;
const DEFAULT_W = 520;

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', py: 'python', rs: 'rust',
  c: 'c', cpp: 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp', java: 'java', go: 'go',
  rb: 'ruby', php: 'php', sh: 'bash', ps1: 'powershell', bat: 'batch', sql: 'sql', css: 'css',
  json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
};

function langFor(path: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(path);
  return (m && LANG[m[1].toLowerCase()]) || 'text';
}

function clampWidth(w: number): number {
  return Math.min(MAX_W, Math.max(MIN_W, w));
}

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex-1 flex items-center justify-center p-6 text-sm text-text-secondary text-center">
    {children}
  </div>
);

const PreviewBody: React.FC<{ path: string }> = ({ path }) => {
  const [res, setRes] = useState<ReadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const kind: PreviewKind = previewKindFor(path);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRes(null);
    if (kind === 'unknown') {
      setLoading(false);
      return;
    }
    window.electron
      .tbReadFile(path)
      .then((r: ReadResult) => {
        if (alive) setRes(r);
      })
      .catch((e: Error) => {
        if (alive) setRes({ ok: false, error: e.message });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, kind]);

  if (kind === 'unknown') {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-2">
          <FileWarning className="w-6 h-6" />
          <div>Keine Vorschau für diesen Dateityp.</div>
          <button className="underline" onClick={() => void window.electron.showItemInFolder(path)}>
            Im Explorer öffnen
          </button>
        </div>
      </Centered>
    );
  }
  if (loading) return <Centered>Lädt …</Centered>;
  if (!res || !res.ok) return <Centered>Fehler: {res?.error ?? 'unbekannt'}</Centered>;

  const dataUrl = `data:${res.mime};base64,${res.data}`;
  const truncatedNote = res.truncated ? (
    <div className="px-4 py-1 text-xs text-text-secondary border-b border-border-primary">
      Gekürzt (Datei &gt; 40 MB)
    </div>
  ) : null;

  switch (kind) {
    case 'markdown':
      return (
        <div className="flex-1 overflow-auto p-4">
          {truncatedNote}
          <MarkdownContent content={res.data ?? ''} />
        </div>
      );
    case 'text':
      return (
        <div className="flex-1 overflow-auto text-xs">
          {truncatedNote}
          <SyntaxHighlighter
            language={langFor(path)}
            style={oneDark}
            customStyle={{ margin: 0, background: 'transparent', fontSize: '0.75rem' }}
            wrapLongLines
          >
            {res.data ?? ''}
          </SyntaxHighlighter>
        </div>
      );
    case 'html':
      return (
        <iframe
          title={baseName(path)}
          sandbox=""
          srcDoc={res.data}
          className="flex-1 w-full border-0 bg-white"
        />
      );
    case 'image':
      return (
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
          <img
            src={dataUrl}
            alt={baseName(path)}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      );
    case 'video':
      return (
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
          <video src={dataUrl} controls className="max-w-full max-h-full" />
        </div>
      );
    default:
      return <Centered>Keine Vorschau.</Centered>;
  }
};

export const PreviewPanel: React.FC = () => {
  const preview = usePreview();

  const [width, setWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(WIDTH_KEY));
      return Number.isFinite(v) && v > 0 ? clampWidth(v) : DEFAULT_W;
    } catch {
      return DEFAULT_W;
    }
  });

  const resizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onResizeDown = useCallback(
    (e: React.MouseEvent) => {
      resizing.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      e.preventDefault();
    },
    [width]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      // Panel liegt rechts: nach links ziehen (kleineres clientX) = breiter.
      setWidth(clampWidth(startWidth.current + (startX.current - e.clientX)));
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      try {
        localStorage.setItem(WIDTH_KEY, String(startWidth.current));
      } catch {
        /* localStorage optional */
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Endbreite persistieren, wenn sich width nach dem Ziehen geändert hat.
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* localStorage optional */
    }
  }, [width]);

  if (!preview || (!preview.path && !preview.inline && !preview.browserUrl)) return null;
  const path = preview.path;
  const inline = preview.inline;
  const browserUrl = preview.browserUrl;
  const title = browserUrl ? 'Browser' : inline ? inline.name : path ? baseName(path) : '';

  return (
    <div
      className="h-full flex-shrink-0 border-l border-border-primary flex flex-row bg-background-primary"
      style={{ width }}
    >
      <div
        className="w-1.5 cursor-col-resize hover:bg-border-primary/40 transition-colors flex-shrink-0"
        onMouseDown={onResizeDown}
        title="Breite ziehen"
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-[48px] flex items-center gap-2 px-3 border-b border-border-primary no-drag">
          <span
            className="flex-1 truncate text-sm font-medium text-text-primary"
            title={path ?? title}
          >
            {title}
          </span>
          {path && (
            <button
              className="p-1.5 rounded hover:bg-background-tertiary text-text-secondary"
              title="Im Explorer anzeigen"
              onClick={() => void window.electron.showItemInFolder(path)}
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          )}
          <button
            className="p-1.5 rounded hover:bg-background-tertiary text-text-secondary"
            title="Schließen"
            onClick={() => preview.close()}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {browserUrl ? (
          <TbBrowser key={browserUrl} initialUrl={browserUrl} />
        ) : inline ? (
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
            {inline.kind === 'video' ? (
              <video src={inline.dataUrl} controls className="max-w-full max-h-full" />
            ) : (
              <img
                src={inline.dataUrl}
                alt={inline.name}
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>
        ) : (
          <PreviewBody key={path!} path={path!} />
        )}
      </div>
    </div>
  );
};
