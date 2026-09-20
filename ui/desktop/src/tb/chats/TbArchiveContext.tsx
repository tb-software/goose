// TB-Software Milestone [15]: Renderer-Store für Archiv/Papierkorb.
// „Löschen" = archivieren (unsichtbar, aber vorhanden). „Endgültig löschen"/Retention (60 Tage) =
// physisch löschen (ACP-Session + Wissens-Ablage + Tags). Hält den Archiv-Cache in acp/sessions.ts
// synchron, damit ALLE Listen archivierte Chats ausblenden.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { acpDeleteSession, tbSetArchivedIds, type SessionListItem } from '../../acp/sessions';
import { useTbTags } from '../tags/TagContext';

export interface TbArchiveEntry {
  archivedAt: number;
  deleteAfter: number;
  workingDir?: string;
  name?: string;
}
type ArchiveMap = Record<string, TbArchiveEntry>;

// Event, auf das History-Liste und Sidebar hören, um nach Archiv-Änderungen neu zu laden.
export const TB_ARCHIVE_CHANGED = 'tb:archive-changed';

const RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 Tage

interface ArchiveState {
  ready: boolean;
  archivedIds: Set<string>;
  entries: ArchiveMap;
  isArchived: (id: string) => boolean;
  archive: (session: { id: string; name?: string; workingDir?: string }) => void;
  restore: (id: string) => void;
  purge: (session: { id: string; workingDir?: string }) => Promise<void>;
  emptyTrash: (sessions: { id: string; workingDir?: string }[]) => Promise<void>;
}

const Ctx = createContext<ArchiveState | null>(null);

export function TbArchiveProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<ArchiveMap>({});
  const [ready, setReady] = useState(false);
  const { setChatTags } = useTbTags();
  const entriesRef = useRef<ArchiveMap>({});
  const sweptRef = useRef(false);

  // Cache in acp/sessions.ts + lokale Ref bei jeder Änderung synchron halten, dann Listen benachrichtigen.
  const applyMap = useCallback((next: ArchiveMap, persist = true) => {
    entriesRef.current = next;
    setEntries(next);
    tbSetArchivedIds(Object.keys(next));
    if (persist) window.electron.tbArchiveSave?.({ archived: next }).catch(() => {});
    window.dispatchEvent(new CustomEvent(TB_ARCHIVE_CHANGED));
  }, []);

  const archive = useCallback<ArchiveState['archive']>(
    (session) => {
      const now = Date.now();
      const next: ArchiveMap = {
        ...entriesRef.current,
        [session.id]: {
          archivedAt: now,
          deleteAfter: now + RETENTION_MS,
          workingDir: session.workingDir,
          name: session.name,
        },
      };
      applyMap(next);
    },
    [applyMap]
  );

  const restore = useCallback<ArchiveState['restore']>(
    (id) => {
      if (!entriesRef.current[id]) return;
      const next = { ...entriesRef.current };
      delete next[id];
      applyMap(next);
    },
    [applyMap]
  );

  // Physisch löschen: ACP-Session + Wissens-Ablage + Tags + Archiv-Eintrag.
  const purge = useCallback<ArchiveState['purge']>(
    async (session) => {
      const wd = session.workingDir ?? entriesRef.current[session.id]?.workingDir;
      try {
        await acpDeleteSession(session.id);
      } catch (e) {
        console.error('[TB][archive] acpDeleteSession fehlgeschlagen', e);
      }
      try {
        await window.electron.tbArchiveCleanup?.(session.id, wd);
      } catch (e) {
        console.error('[TB][archive] Wissens-Cleanup fehlgeschlagen', e);
      }
      try {
        setChatTags(session.id, []); // Tag-Zuordnung entfernen
      } catch {
        /* ignore */
      }
      const next = { ...entriesRef.current };
      delete next[session.id];
      applyMap(next);
    },
    [applyMap, setChatTags]
  );

  const emptyTrash = useCallback<ArchiveState['emptyTrash']>(
    async (sessions) => {
      for (const s of sessions) {
        // seriell, damit ACP-Löschungen nicht kollidieren
        await purge(s);
      }
    },
    [purge]
  );

  // Laden + Cache initial setzen.
  useEffect(() => {
    let cancelled = false;
    window.electron
      .tbArchiveGet?.()
      .then((d) => {
        if (cancelled) return;
        const map = d?.archived ?? {};
        entriesRef.current = map;
        setEntries(map);
        tbSetArchivedIds(Object.keys(map));
        setReady(true);
        // Falls Listen bereits vor dem Cache geladen haben: einmal neu filtern lassen.
        if (Object.keys(map).length > 0) {
          window.dispatchEvent(new CustomEvent(TB_ARCHIVE_CHANGED));
        }
      })
      .catch(() => setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Retention-Sweep (einmal, nach dem Laden): überfällige Einträge physisch löschen.
  useEffect(() => {
    if (!ready || sweptRef.current) return;
    sweptRef.current = true;
    const now = Date.now();
    const overdue = Object.entries(entriesRef.current)
      .filter(([, e]) => e.deleteAfter <= now)
      .map(([id, e]) => ({ id, workingDir: e.workingDir }));
    if (overdue.length) {
      void emptyTrash(overdue);
    }
  }, [ready, emptyTrash]);

  const value = useMemo<ArchiveState>(
    () => ({
      ready,
      archivedIds: new Set(Object.keys(entries)),
      entries,
      isArchived: (id: string) => !!entries[id],
      archive,
      restore,
      purge,
      emptyTrash,
    }),
    [ready, entries, archive, restore, purge, emptyTrash]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTbArchive(): ArchiveState {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      ready: false,
      archivedIds: new Set(),
      entries: {},
      isArchived: () => false,
      archive: () => {},
      restore: () => {},
      purge: async () => {},
      emptyTrash: async () => {},
    };
  }
  return ctx;
}

export type { SessionListItem };
