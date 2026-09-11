// TB-Software: Renderer-Store für den Chat-Tag-Manager. Lädt tb-tags.json, bietet CRUD +
// Zuweisung + Persistenz. Der Renderer ist Master der Logik; der Hauptprozess speichert nur.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface TbTag {
  id: string;
  name: string;
  color: string;
  note?: string;
}

interface TagState {
  tags: TbTag[];
  chatTags: Record<string, string[]>;
  ready: boolean;
  createTag: (name: string, color: string, note?: string) => TbTag;
  updateTag: (id: string, patch: Partial<Omit<TbTag, 'id'>>) => void;
  deleteTag: (id: string) => void;
  setChatTags: (sessionId: string, tagIds: string[]) => void;
  toggleChatTag: (sessionId: string, tagId: string) => void;
  tagsForChat: (sessionId: string) => TbTag[];
}

const Ctx = createContext<TagState | null>(null);

const PALETTE = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#64748b'];
export const TAG_PALETTE = PALETTE;

function uid(): string {
  return 't' + Math.random().toString(36).slice(2, 9);
}

export function TbTagProvider({ children }: { children: React.ReactNode }) {
  const [tags, setTags] = useState<TbTag[]>([]);
  const [chatTags, setChatTagsState] = useState<Record<string, string[]>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electron.tbGetTags?.().then((d) => {
      if (cancelled) return;
      setTags(d?.tags ?? []);
      setChatTagsState(d?.chatTags ?? {});
      setReady(true);
    }).catch(() => setReady(true));
    return () => { cancelled = true; };
  }, []);

  // Persistenz (debounced) bei jeder Änderung, sobald geladen.
  const persist = useCallback((nextTags: TbTag[], nextChatTags: Record<string, string[]>) => {
    window.electron.tbSaveTags?.({ tags: nextTags, chatTags: nextChatTags }).catch(() => {});
  }, []);

  const createTag = useCallback<TagState['createTag']>(
    (name, color, note) => {
      const tag: TbTag = { id: uid(), name: name.trim() || 'Neu', color, note: note?.trim() || undefined };
      setTags((prev) => {
        const next = [...prev, tag];
        persist(next, chatTags);
        return next;
      });
      return tag;
    },
    [chatTags, persist]
  );

  const updateTag = useCallback<TagState['updateTag']>(
    (id, patch) => {
      setTags((prev) => {
        const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
        persist(next, chatTags);
        return next;
      });
    },
    [chatTags, persist]
  );

  const deleteTag = useCallback<TagState['deleteTag']>(
    (id) => {
      setTags((prevTags) => {
        const nextTags = prevTags.filter((t) => t.id !== id);
        setChatTagsState((prevCt) => {
          const nextCt: Record<string, string[]> = {};
          for (const [sid, ids] of Object.entries(prevCt)) {
            const filtered = ids.filter((x) => x !== id);
            if (filtered.length) nextCt[sid] = filtered;
          }
          persist(nextTags, nextCt);
          return nextCt;
        });
        return nextTags;
      });
    },
    [persist]
  );

  const setChatTags = useCallback<TagState['setChatTags']>(
    (sessionId, tagIds) => {
      setChatTagsState((prev) => {
        const next = { ...prev };
        if (tagIds.length) next[sessionId] = tagIds;
        else delete next[sessionId];
        persist(tags, next);
        return next;
      });
    },
    [tags, persist]
  );

  const toggleChatTag = useCallback<TagState['toggleChatTag']>(
    (sessionId, tagId) => {
      setChatTagsState((prev) => {
        const current = prev[sessionId] ?? [];
        const has = current.includes(tagId);
        const nextIds = has ? current.filter((x) => x !== tagId) : [...current, tagId];
        const next = { ...prev };
        if (nextIds.length) next[sessionId] = nextIds;
        else delete next[sessionId];
        persist(tags, next);
        return next;
      });
    },
    [tags, persist]
  );

  const tagsForChat = useCallback<TagState['tagsForChat']>(
    (sessionId) => {
      const ids = chatTags[sessionId] ?? [];
      return ids.map((id) => tags.find((t) => t.id === id)).filter((t): t is TbTag => !!t);
    },
    [chatTags, tags]
  );

  const value = useMemo<TagState>(
    () => ({
      tags,
      chatTags,
      ready,
      createTag,
      updateTag,
      deleteTag,
      setChatTags,
      toggleChatTag,
      tagsForChat,
    }),
    [tags, chatTags, ready, createTag, updateTag, deleteTag, setChatTags, toggleChatTag, tagsForChat]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTbTags(): TagState {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback (kein Provider) — leere, no-op-Implementierung, damit Komponenten nicht crashen.
    return {
      tags: [],
      chatTags: {},
      ready: false,
      createTag: () => ({ id: '', name: '', color: '#64748b' }),
      updateTag: () => {},
      deleteTag: () => {},
      setChatTags: () => {},
      toggleChatTag: () => {},
      tagsForChat: () => [],
    };
  }
  return ctx;
}
