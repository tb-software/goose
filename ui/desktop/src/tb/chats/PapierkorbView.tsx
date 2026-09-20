// TB-Software Milestone [15]: Papierkorb — archivierte Chats verwalten.
// Zeigt archivierte (überall sonst unsichtbare) Chats. Aktionen: wiederherstellen, endgültig löschen,
// Papierkorb leeren. Nur hier passiert physisches Löschen.
import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { acpListArchivedSessions, type SessionListItem } from '../../acp/sessions';
import { useTbArchive, TB_ARCHIVE_CHANGED } from './TbArchiveContext';

function daysLeft(deleteAfter: number): number {
  return Math.max(0, Math.ceil((deleteAfter - Date.now()) / (24 * 60 * 60 * 1000)));
}

export const PapierkorbView: React.FC = () => {
  const { entries, restore, purge, emptyTrash, ready } = useTbArchive();
  const [items, setItems] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const archived = await acpListArchivedSessions();
      setItems(archived);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // Nach Archiv-Änderungen (auch aus anderen Views) neu laden.
  useEffect(() => {
    const h = () => void load();
    window.addEventListener(TB_ARCHIVE_CHANGED, h);
    return () => window.removeEventListener(TB_ARCHIVE_CHANGED, h);
  }, [load]);

  const onRestore = (id: string) => {
    setBusyId(id);
    restore(id);
    setItems((prev) => prev.filter((s) => s.id !== id));
    setBusyId(null);
  };

  const onPurge = async (s: SessionListItem) => {
    setBusyId(s.id);
    await purge({ id: s.id, workingDir: s.workingDir });
    setItems((prev) => prev.filter((x) => x.id !== s.id));
    setBusyId(null);
  };

  const onEmpty = async () => {
    if (!items.length) return;
    setEmptying(true);
    await emptyTrash(items.map((s) => ({ id: s.id, workingDir: s.workingDir })));
    setItems([]);
    setEmptying(false);
  };

  return (
    <div className="flex flex-col h-full p-4 pt-12 gap-3 overflow-hidden">
      <div className="flex items-center gap-3">
        <Trash2 className="w-5 h-5 text-text-primary" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-text-primary">Papierkorb</h1>
          <p className="text-xs text-text-secondary">
            Gelöschte Chats bleiben 60 Tage hier und sind sonst nirgends sichtbar. Endgültiges Löschen entfernt
            sie samt Wissens-Ablage.
          </p>
        </div>
        <button
          onClick={onEmpty}
          disabled={emptying || !items.length}
          className="px-3 py-1.5 rounded-full text-xs font-medium bg-background-tertiary text-text-primary hover:bg-background-tertiary/70 disabled:opacity-40"
        >
          {emptying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Papierkorb leeren'}
        </button>
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-2">
        {loading ? (
          <div className="p-3 text-sm text-text-secondary">Lade …</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-text-secondary text-center">Der Papierkorb ist leer.</div>
        ) : (
          items.map((s) => {
            const entry = entries[s.id];
            const left = entry ? daysLeft(entry.deleteAfter) : 0;
            const busy = busyId === s.id;
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-border-primary px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{s.name || 'Chat'}</div>
                  <div className="text-xs text-text-secondary truncate">
                    {s.workingDir || '—'} · noch {left} Tag{left === 1 ? '' : 'e'}
                  </div>
                </div>
                <button
                  onClick={() => onRestore(s.id)}
                  disabled={busy}
                  title="Wiederherstellen"
                  className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-text-primary hover:bg-background-tertiary/60 disabled:opacity-40"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Wiederherstellen
                </button>
                <button
                  onClick={() => onPurge(s)}
                  disabled={busy}
                  title="Endgültig löschen"
                  className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-40"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Endgültig löschen
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
