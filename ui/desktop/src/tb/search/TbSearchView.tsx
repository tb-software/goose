// TB-Software: Projekt-Suche (Dateinamen). UI + Such-Zustand (SRP); der Walk
// läuft im Main-Prozess (IPC tb-search). Treffer öffnen im Vorschau-Panel.
import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { usePreview } from '../preview/PreviewContext';
import { getInitialWorkingDir } from '../../utils/workingDir';
import { baseName } from '../preview/previewKind';
import { cn } from '../../utils';

type Scope = 'current' | 'all';
interface Hit {
  path: string;
  name: string;
  rel: string;
  root: string;
}

export const TbSearchView: React.FC = () => {
  const preview = usePreview();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [allRoots, setAllRoots] = useState<string[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const current = useMemo(() => getInitialWorkingDir(), []);

  useEffect(() => {
    window.electron
      .listRecentDirs()
      .then((d) => setAllRoots(d ?? []))
      .catch(() => setAllRoots([]));
  }, []);

  const roots = scope === 'current' ? (current ? [current] : []) : allRoots;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setTruncated(false);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      window.electron
        .tbSearch(roots, q)
        .then((r) => {
          if (!alive) return;
          setHits(r.results);
          setTruncated(r.truncated);
        })
        .catch(() => alive && setHits([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // roots ist aus scope/allRoots/current abgeleitet:
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, allRoots, current]);

  const scopeBtn = (value: Scope, label: string) => (
    <button
      onClick={() => setScope(value)}
      className={cn(
        'px-3 py-1 rounded-full text-xs font-medium transition-colors',
        scope === value
          ? 'bg-background-tertiary text-text-primary'
          : 'text-text-secondary hover:bg-background-tertiary/60'
      )}
    >
      {label}
    </button>
  );

  const q = query.trim();

  return (
    <div className="flex flex-col h-full p-4 pt-12 gap-3 overflow-hidden">
      <div className="flex items-center gap-2 rounded-full border border-border-primary px-3 py-2">
        <Search className="w-4 h-4 text-text-secondary flex-shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Dateien suchen …"
          className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-secondary"
        />
      </div>

      <div className="flex items-center gap-2">
        {scopeBtn('current', 'Dieses Projekt')}
        {scopeBtn('all', 'Alle Projekte')}
        <span className="ml-auto text-xs text-text-secondary">
          {loading ? 'Suche …' : q.length >= 2 ? `${hits.length} Treffer${truncated ? '+' : ''}` : ''}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {q.length < 2 ? (
          <div className="p-3 text-sm text-text-secondary">Mindestens 2 Zeichen eingeben.</div>
        ) : !loading && hits.length === 0 ? (
          <div className="p-3 text-sm text-text-secondary">Keine Treffer.</div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {hits.map((h) => (
              <li key={h.path}>
                <button
                  onClick={() => preview?.open(h.path)}
                  title={h.path}
                  className="w-full text-left rounded-lg px-3 py-1.5 hover:bg-background-tertiary/60 transition-colors"
                >
                  <span className="text-sm text-text-primary">{baseName(h.path)}</span>
                  <span className="ml-2 text-xs text-text-secondary truncate">{h.rel}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {truncated && (
          <div className="p-3 text-xs text-text-secondary">
            Ergebnisse gekürzt — Suchbegriff verfeinern.
          </div>
        )}
      </div>
    </div>
  );
};
