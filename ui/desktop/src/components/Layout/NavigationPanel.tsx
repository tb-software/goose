import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  Check,
  Settings2,
  Tags as TagsIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigationContext } from './NavigationContext';
import { useConfig } from '../ConfigContext';
import { useNavigationSessions } from '../../hooks/useNavigationSessions';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { useTbTags } from '../../tb/tags/TagContext';
import TagManagerDialog from '../../tb/tags/TagManagerDialog';
import {
  NAV_ITEMS,
  SETTINGS_NAV_ITEM,
  getNavItemLabel,
  type NavItem,
} from '../../hooks/useNavigationItems';
import { AppEvents } from '../../constants/events';
import { InlineEditText } from '../common/InlineEditText';
import { SessionIndicators } from '../SessionIndicators';
import {
  acpRenameSession,
  acpForkSession,
  acpDeleteSession,
  type SessionListItem,
} from '../../acp/sessions';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip';
import { formatMessageTimestamp } from '../../utils/timeUtils';
import { cn } from '../../utils';
import type { ProjectGroup } from '../../utils/projectSessions';
import { defineMessages, useIntl } from '../../i18n';
import { TB_BRANDING } from '../../tb/branding';

type StreamState = 'idle' | 'loading' | 'streaming' | 'error';

interface SessionStatus {
  streamState: StreamState;
  hasUnreadActivity: boolean;
}

const i18n = defineMessages({
  chats: {
    id: 'navigationPanel.chats',
    defaultMessage: 'Chats',
  },
  noChats: {
    id: 'navigationPanel.noChats',
    defaultMessage: 'No recent chats',
  },
  untitledSession: {
    id: 'navigationPanel.untitledSession',
    defaultMessage: 'Untitled session',
  },
  metaModel: {
    id: 'navigationPanel.metaModel',
    defaultMessage: 'Model',
  },
  metaDirectory: {
    id: 'navigationPanel.metaDirectory',
    defaultMessage: 'Directory',
  },
  metaStatus: {
    id: 'navigationPanel.metaStatus',
    defaultMessage: 'Status',
  },
  metaCreated: {
    id: 'navigationPanel.metaCreated',
    defaultMessage: 'Created',
  },
  metaUpdated: {
    id: 'navigationPanel.metaUpdated',
    defaultMessage: 'Updated',
  },
  statusStreaming: {
    id: 'navigationPanel.statusStreaming',
    defaultMessage: 'Streaming',
  },
  statusError: {
    id: 'navigationPanel.statusError',
    defaultMessage: 'Error',
  },
  statusUnread: {
    id: 'navigationPanel.statusUnread',
    defaultMessage: 'Unread activity',
  },
  statusIdle: {
    id: 'navigationPanel.statusIdle',
    defaultMessage: 'Idle',
  },
});

const navItemClass = (active: boolean) =>
  cn(
    'flex flex-row items-center gap-3 outline-none no-drag w-full',
    'rounded-full px-3 py-2 text-sm font-medium transition-colors',
    active
      ? 'bg-background-tertiary text-text-primary'
      : 'text-text-primary hover:bg-background-tertiary/60'
  );

interface NavRowProps {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}

const NavRow: React.FC<NavRowProps> = ({ item, active, onClick }) => {
  const intl = useIntl();
  const Icon = item.icon;
  return (
    <button onClick={onClick} className={navItemClass(active)}>
      <Icon className="w-5 h-5 flex-shrink-0 text-text-secondary" />
      <span className="text-left flex-1 truncate">{getNavItemLabel(item, intl)}</span>
      {item.getTag && (
        <span className="text-xs font-mono text-text-secondary">{item.getTag()}</span>
      )}
    </button>
  );
};

interface SessionRowProps {
  session: SessionListItem;
  active: boolean;
  status: SessionStatus | undefined;
  onClick: () => void;
  onRenamed: () => void;
  onChanged: () => void; // nach Löschen/Duplizieren neu laden
  onManageTags: () => void; // öffnet den Tag-Manager-Dialog
}

const formatTimestamp = (value?: string): string | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return formatMessageTimestamp(parsed / 1000);
};

const MetaRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex gap-2">
    <span className="text-text-inverse/60 flex-shrink-0">{label}</span>
    <span className="text-right ml-auto break-all">{value}</span>
  </div>
);

interface SessionTooltipContentProps {
  session: SessionListItem;
  statusLabel: string;
}

const SessionTooltipContent: React.FC<SessionTooltipContentProps> = ({ session, statusLabel }) => {
  const intl = useIntl();
  const model = session.modelId
    ? session.providerId
      ? `${session.modelId} (${session.providerId})`
      : session.modelId
    : session.providerId;
  const created = formatTimestamp(session.createdAt);
  const updated = formatTimestamp(session.lastMessageAt ?? session.updatedAt);

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="font-medium break-words">
        {session.name || intl.formatMessage(i18n.untitledSession)}
      </div>
      <div className="flex flex-col gap-0.5">
        {model && <MetaRow label={intl.formatMessage(i18n.metaModel)} value={model} />}
        {session.workingDir && (
          <MetaRow label={intl.formatMessage(i18n.metaDirectory)} value={session.workingDir} />
        )}
        <MetaRow label={intl.formatMessage(i18n.metaStatus)} value={statusLabel} />
        {created && <MetaRow label={intl.formatMessage(i18n.metaCreated)} value={created} />}
        {updated && <MetaRow label={intl.formatMessage(i18n.metaUpdated)} value={updated} />}
      </div>
    </div>
  );
};

const SessionRow: React.FC<SessionRowProps> = ({
  session,
  active,
  status,
  onClick,
  onRenamed,
  onChanged,
  onManageTags,
}) => {
  const intl = useIntl();
  const [isEditing, setIsEditing] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { tags, tagsForChat, toggleChatTag } = useTbTags();
  const chatTags = tagsForChat(session.id);
  const isStreaming = status?.streamState === 'streaming';
  const hasError = status?.streamState === 'error';
  const hasUnread = status?.hasUnreadActivity ?? false;

  const statusLabel = isStreaming
    ? intl.formatMessage(i18n.statusStreaming)
    : hasError
      ? intl.formatMessage(i18n.statusError)
      : hasUnread
        ? intl.formatMessage(i18n.statusUnread)
        : intl.formatMessage(i18n.statusIdle);

  const handleDuplicate = async () => {
    setMenuOpen(false);
    try {
      await acpForkSession(session.id);
      onChanged();
    } catch (e) {
      console.error('Duplizieren fehlgeschlagen', e);
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    const ok = window.confirm(
      `Chat „${session.name || intl.formatMessage(i18n.untitledSession)}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`
    );
    if (!ok) return;
    try {
      await acpDeleteSession(session.id);
      onChanged();
    } catch (e) {
      console.error('Löschen fehlgeschlagen', e);
    }
  };

  return (
    <Tooltip open={tooltipOpen && !isEditing && !menuOpen} onOpenChange={setTooltipOpen} delayDuration={400}>
      <TooltipTrigger asChild>
        <div
          onClick={() => !isEditing && onClick()}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
          className={cn(
            'group/row flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer text-sm',
            'hover:bg-background-tertiary/60 transition-colors',
            active && 'bg-background-tertiary'
          )}
        >
          {chatTags.length > 0 && (
            <span className="flex items-center gap-0.5 flex-shrink-0">
              {chatTags.slice(0, 3).map((t) => (
                <span
                  key={t.id}
                  title={t.note ? `${t.name} — ${t.note}` : t.name}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
              ))}
            </span>
          )}
          <InlineEditText
            value={session.name}
            onSave={async (newName) => {
              await acpRenameSession(session.id, newName);
              window.dispatchEvent(
                new CustomEvent(AppEvents.SESSION_RENAMED, {
                  detail: { sessionId: session.id, newName, userInitiated: true },
                })
              );
              onRenamed();
            }}
            placeholder={intl.formatMessage(i18n.untitledSession)}
            disabled={isStreaming}
            singleClickEdit={false}
            className="truncate text-text-primary flex-1 !px-0 !py-0 hover:bg-transparent"
            editClassName="!text-sm"
            onEditStart={() => setIsEditing(true)}
            onEditEnd={() => setIsEditing(false)}
          />
          <SessionIndicators isStreaming={isStreaming} hasUnread={hasUnread} hasError={hasError} />
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="flex-shrink-0 p-0.5 rounded text-text-tertiary hover:text-text-primary opacity-60 hover:opacity-100"
                title="Aktionen"
                aria-label="Chat-Aktionen"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                onSelect={() => {
                  setMenuOpen(false);
                  setTimeout(() => setIsEditing(true), 0);
                }}
              >
                <Pencil className="w-4 h-4 mr-2" /> Umbenennen
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleDuplicate}>
                <Copy className="w-4 h-4 mr-2" /> Duplizieren
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-text-tertiary">
                Tags
              </DropdownMenuLabel>
              {tags.length === 0 ? (
                <div className="px-2 py-1 text-xs text-text-tertiary">Noch keine Tags</div>
              ) : (
                tags.map((t) => {
                  const assigned = chatTags.some((c) => c.id === t.id);
                  return (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleChatTag(session.id, t.id);
                      }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="flex-1 truncate">{t.name}</span>
                      {assigned && <Check className="w-3.5 h-3.5 ml-2 flex-shrink-0" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              <DropdownMenuItem
                onSelect={() => {
                  setMenuOpen(false);
                  onManageTags();
                }}
              >
                <Settings2 className="w-4 h-4 mr-2" /> Tags verwalten…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleDelete}
                className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20"
              >
                <Trash2 className="w-4 h-4 mr-2" /> Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-xs text-left">
        <SessionTooltipContent session={session} statusLabel={statusLabel} />
      </TooltipContent>
    </Tooltip>
  );
};

export const Navigation: React.FC<{ className?: string }> = ({ className }) => {
  const intl = useIntl();
  const { isNavExpanded } = useNavigationContext();
  const location = useLocation();
  const { extensionsList } = useConfig();

  const appsExtensionEnabled = !!extensionsList?.find((ext) => ext.name === 'apps')?.enabled;

  const visibleItems = useMemo<NavItem[]>(() => {
    return NAV_ITEMS.filter((item) => {
      if (TB_BRANDING.hiddenNavItems.includes(item.id)) return false;
      if (item.path === '/apps') return appsExtensionEnabled;
      return true;
    });
  }, [appsExtensionEnabled]);

  const isActive = useCallback((path: string) => location.pathname === path, [location.pathname]);

  const {
    recentSessions,
    recentSessionsByProject,
    activeSessionId,
    fetchSessions,
    handleNavClick,
    handleSessionClick,
  } = useNavigationSessions();

  const [sessionStatuses, setSessionStatuses] = useState<Map<string, SessionStatus>>(new Map());

  useEffect(() => {
    const handleStatusUpdate = (event: Event) => {
      const { sessionId, streamState } = (event as CustomEvent).detail;
      setSessionStatuses((prev) => {
        const existing = prev.get(sessionId);
        const shouldMarkUnread = existing?.streamState === 'streaming' && streamState === 'idle';
        const next = new Map(prev);
        next.set(sessionId, {
          streamState,
          hasUnreadActivity: existing?.hasUnreadActivity || shouldMarkUnread,
        });
        return next;
      });
    };

    window.addEventListener(AppEvents.SESSION_STATUS_UPDATE, handleStatusUpdate);
    return () => window.removeEventListener(AppEvents.SESSION_STATUS_UPDATE, handleStatusUpdate);
  }, []);

  const clearUnread = useCallback((sessionId: string) => {
    setSessionStatuses((prev) => {
      const status = prev.get(sessionId);
      if (status?.hasUnreadActivity) {
        const next = new Map(prev);
        next.set(sessionId, { ...status, hasUnreadActivity: false });
        return next;
      }
      return prev;
    });
  }, []);

  const navFocusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isNavExpanded) {
      fetchSessions();
      requestAnimationFrame(() => navFocusRef.current?.focus());
    }
  }, [isNavExpanded, fetchSessions]);

  const [isChatsExpanded, setIsChatsExpanded] = useState(true);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  const toggleProjectCollapsed = useCallback((path: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // TB-Software: Tag-Ansicht (Chats nach Tags gruppiert), Tag-Manager, Recency-Sortierung.
  const { tags: allTags, chatTags: allChatTags } = useTbTags();
  const [tagView, setTagView] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set());
  const toggleTagCollapsed = useCallback((id: string) => {
    setCollapsedTags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sessionTime = useCallback(
    (s: SessionListItem) =>
      Date.parse(s.lastMessageAt ?? s.updatedAt ?? s.createdAt ?? '') || 0,
    []
  );

  // Gruppen: je Tag (nur mit Chats) + „Ohne Tag". Innerhalb: zuletzt bearbeitet oben.
  // Gruppen selbst nach jüngstem Chat sortiert (aktive Tags wandern nach oben).
  const tagGroups = useMemo(() => {
    const groups: {
      id: string;
      label: string;
      color?: string;
      note?: string;
      sessions: SessionListItem[];
    }[] = [];
    for (const tag of allTags) {
      const list = recentSessions.filter((s) => (allChatTags[s.id] ?? []).includes(tag.id));
      if (list.length) {
        list.sort((a, b) => sessionTime(b) - sessionTime(a));
        groups.push({ id: tag.id, label: tag.name, color: tag.color, note: tag.note, sessions: list });
      }
    }
    const untagged = recentSessions.filter((s) => !(allChatTags[s.id]?.length));
    if (untagged.length) {
      untagged.sort((a, b) => sessionTime(b) - sessionTime(a));
      groups.push({ id: '__untagged__', label: 'Ohne Tag', sessions: untagged });
    }
    groups.sort((a, b) => sessionTime(b.sessions[0]) - sessionTime(a.sessions[0]));
    return groups;
  }, [allTags, allChatTags, recentSessions, sessionTime]);

  const renderSessionRow = useCallback(
    (session: SessionListItem) => (
      <SessionRow
        key={session.id}
        session={session}
        active={session.id === activeSessionId}
        status={sessionStatuses.get(session.id)}
        onClick={() => {
          clearUnread(session.id);
          handleSessionClick(session.id);
        }}
        onRenamed={fetchSessions}
        onChanged={fetchSessions}
        onManageTags={() => setTagManagerOpen(true)}
      />
    ),
    [activeSessionId, sessionStatuses, clearUnread, handleSessionClick, fetchSessions]
  );

  if (!isNavExpanded) return null;

  return (
    <motion.div
      ref={navFocusRef}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={cn('bg-background-primary outline-none flex flex-col h-full', className)}
    >
      <div className="h-[48px] no-drag" />

      <div className="px-2 flex flex-col gap-0.5">
        {visibleItems.map((item) => (
          <NavRow
            key={item.id}
            item={item}
            active={isActive(item.path)}
            onClick={() => handleNavClick(item.path)}
          />
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col mt-3">
        <div className="flex items-center pr-2">
          <button
            onClick={() => setIsChatsExpanded((v) => !v)}
            className="flex items-center gap-1 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-text-secondary hover:text-text-primary transition-colors self-start flex-1"
          >
            {isChatsExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>{intl.formatMessage(i18n.chats)}</span>
          </button>
          {/* TB-Software: Umschalter Projekt/Tags + Tag-Manager. */}
          <button
            onClick={() => setTagView((v) => !v)}
            className={cn(
              'p-1 rounded text-text-tertiary hover:text-text-primary transition-colors',
              tagView && 'text-text-primary bg-background-tertiary'
            )}
            title={tagView ? 'Nach Projekt gruppieren' : 'Nach Tags gruppieren'}
            aria-label="Gruppierung umschalten"
          >
            <TagsIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTagManagerOpen(true)}
            className="p-1 rounded text-text-tertiary hover:text-text-primary transition-colors"
            title="Tags verwalten"
            aria-label="Tags verwalten"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {isChatsExpanded && (
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 mt-1">
            {recentSessions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-secondary">
                {intl.formatMessage(i18n.noChats)}
              </div>
            ) : tagView ? (
              tagGroups.map((group) => {
                const isCollapsed = collapsedTags.has(group.id);
                return (
                  <React.Fragment key={group.id}>
                    <button
                      onClick={() => toggleTagCollapsed(group.id)}
                      aria-expanded={!isCollapsed}
                      className="flex items-center gap-1 w-full px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
                      title={group.note || group.label}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-3 h-3 flex-shrink-0" />
                      )}
                      {group.color && (
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: group.color }}
                        />
                      )}
                      <span className="truncate">{group.label}</span>
                      <span className="ml-1 text-text-tertiary/70">{group.sessions.length}</span>
                    </button>
                    {!isCollapsed && group.sessions.map((session) => renderSessionRow(session))}
                  </React.Fragment>
                );
              })
            ) : recentSessionsByProject.length > 1 ? (
              recentSessionsByProject.map((group: ProjectGroup) => {
                const isCollapsed = collapsedProjects.has(group.path);
                return (
                  <React.Fragment key={group.path}>
                    <button
                      onClick={() => toggleProjectCollapsed(group.path)}
                      aria-expanded={!isCollapsed}
                      className="flex items-center gap-1 w-full px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
                      title={group.path}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-3 h-3 flex-shrink-0" />
                      )}
                      <span className="truncate">{group.label}</span>
                    </button>
                    {!isCollapsed && group.sessions.map((session) => renderSessionRow(session))}
                  </React.Fragment>
                );
              })
            ) : (
              recentSessions.map((session) => renderSessionRow(session))
            )}
          </div>
        )}
      </div>
      <TagManagerDialog open={tagManagerOpen} onOpenChange={setTagManagerOpen} />

      <div className="px-2 pt-2 pb-2 border-t border-border-secondary">
        <NavRow
          item={SETTINGS_NAV_ITEM}
          active={isActive(SETTINGS_NAV_ITEM.path)}
          onClick={() => handleNavClick(SETTINGS_NAV_ITEM.path)}
        />
      </div>
    </motion.div>
  );
};
