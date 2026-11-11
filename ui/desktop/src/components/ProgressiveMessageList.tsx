import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isEqual } from 'lodash';
import { defineMessages, useIntl } from '../i18n';
import GooseMessage from './GooseMessage';
import UserMessage from './UserMessage';
import {
  SystemNotificationInline,
  getInlineSystemNotification,
} from './context_management/SystemNotificationInline';
import {
  CreditsExhaustedNotification,
  getCreditsExhaustedNotification,
} from './context_management/CreditsExhaustedNotification';
import type {
  ImageData,
  Message,
  NotificationEvent,
  SystemNotificationContent,
} from '../types/message';
import LoadingGoose from './LoadingGoose';
import { getModelDisplayName } from './settings/models/predefinedModelsUtils';
import { deriveMessageRowContexts, type MessageRowContext } from './messageRowContext';
import { identifyConsecutiveToolCalls } from '../utils/toolCallChaining';
import { getToolRequests, getToolResponses, getTextAndImageContent } from '../types/message';
import ActivityTree from './ActivityTree';
import {
  collectProgressBoxes,
  type TbProgressBox as TbProgressBoxData,
} from '../tb/progress/collectProgressBoxes';
import TbProgressBox from '../tb/progress/TbProgressBox';

// TB-Software: Titel für eine Aktivitäts-Gruppe billig aus den Werkzeugnamen ableiten
// (kein LLM-Call). Bsp: "shell×8, text_editor×2".
function toolNameOf(req: unknown): string {
  const tc = (req as { toolCall?: { value?: { name?: string }; name?: string } })?.toolCall;
  const raw = tc?.value?.name ?? tc?.name ?? 'tool';
  // "extension__tool" -> "tool"; "developer__shell" -> "shell".
  const parts = String(raw).split('__');
  return parts[parts.length - 1];
}
function buildActivityTitle(chainIndices: number[], messages: Message[]): string {
  const counts = new Map<string, number>();
  for (const i of chainIndices) {
    for (const req of getToolRequests(messages[i])) {
      const name = toolNameOf(req);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, c]) => (c > 1 ? `${n}×${c}` : n));
  return parts.join(', ') || 'Werkzeuge';
}

const i18n = defineMessages({
  loadingMessages: {
    id: 'progressiveMessageList.loadingMessages',
    defaultMessage: 'Loading messages... ({renderedCount}/{totalCount})',
  },
  searchHint: {
    id: 'progressiveMessageList.searchHint',
    defaultMessage: 'Press Cmd/Ctrl+F to load all messages immediately for search',
  },
  modelChanged: {
    id: 'progressiveMessageList.modelChanged',
    defaultMessage: 'Model changed: {previousModel} → {currentModel}',
  },
});

const emptyToolCallNotifications = new Map<string, NotificationEvent[]>();
const emptyAppend = () => {};

function getResolvedModel(message: Message): string | null {
  if (message.role !== 'assistant' || !message.metadata.userVisible) return null;
  return message.metadata.inference?.resolvedModel ?? null;
}

function getSystemNotification(message: Message): SystemNotificationContent | undefined {
  return getCreditsExhaustedNotification(message) ?? getInlineSystemNotification(message);
}

function renderSystemNotification(notification: SystemNotificationContent) {
  switch (notification.notificationType) {
    case 'creditsExhausted':
      return <CreditsExhaustedNotification notification={notification} />;
    case 'inlineMessage':
      return <SystemNotificationInline notification={notification} />;
    default:
      return null;
  }
}

interface MessageRowProps {
  append: (value: string) => void;
  index: number;
  isStreaming: boolean;
  isUser: boolean;
  message: Message;
  modelChangeMessage: string | null;
  onMessageUpdate?: (
    messageId: string,
    newContent: string,
    editType: 'fork' | 'edit',
    retainedImages: ImageData[]
  ) => void;
  regenerateText?: string;
  rowContext: MessageRowContext;
  sessionId: string;
  submitElicitationResponse?: (
    elicitationId: string,
    userData: Record<string, unknown>
  ) => Promise<boolean>;
  toolNotifications: readonly (NotificationEvent[] | undefined)[];
}

function MessageRowComponent({
  append,
  index,
  isStreaming,
  isUser,
  message,
  modelChangeMessage,
  onMessageUpdate,
  regenerateText,
  rowContext,
  sessionId,
  submitElicitationResponse,
  toolNotifications,
}: MessageRowProps) {
  const notification = getSystemNotification(message);

  if (notification) {
    return (
      <div
        className={`relative ${index === 0 ? 'mt-0' : 'mt-4'} assistant`}
        data-testid="message-container"
      >
        {renderSystemNotification(notification)}
      </div>
    );
  }

  const hasOnlyToolResponses = message.content.every((content) => content.type === 'toolResponse');

  return (
    <Fragment>
      {modelChangeMessage && (
        <SystemNotificationInline
          notification={{
            msg: modelChangeMessage,
            notificationType: 'inlineMessage',
          }}
        />
      )}
      <div
        className={`relative ${index === 0 ? 'mt-0' : 'mt-4'} ${isUser ? 'user' : 'assistant'} ${rowContext.isInToolCallChain ? 'in-chain' : ''}`}
        data-testid="message-container"
      >
        {isUser ? (
          !hasOnlyToolResponses && (
            <UserMessage message={message} onMessageUpdate={onMessageUpdate} />
          )
        ) : (
          <GooseMessage
            sessionId={sessionId}
            message={message}
            hideTimestamp={rowContext.hideTimestamp}
            toolStates={rowContext.toolStates}
            toolNotifications={toolNotifications}
            toolConfirmationShownInline={rowContext.toolConfirmationShownInline}
            append={append}
            isStreaming={isStreaming}
            regenerateText={regenerateText}
            submitElicitationResponse={submitElicitationResponse}
          />
        )}
      </div>
    </Fragment>
  );
}

const MessageRow = memo(MessageRowComponent, isEqual);

interface ProgressiveMessageListProps {
  messages: Message[];
  sessionId: string;
  toolCallNotifications?: Map<string, NotificationEvent[]>;
  append?: (value: string) => void;
  isUserMessage: (message: Message) => boolean;
  batchSize?: number;
  batchDelay?: number;
  showLoadingThreshold?: number;
  renderMessage?: (message: Message, index: number) => React.ReactNode | null;
  isStreamingMessage?: boolean;
  onMessageUpdate?: (
    messageId: string,
    newContent: string,
    editType: 'fork' | 'edit',
    retainedImages: ImageData[]
  ) => void;
  onRenderingComplete?: () => void;
  submitElicitationResponse?: (
    elicitationId: string,
    userData: Record<string, unknown>
  ) => Promise<boolean>;
}

// TB-Software: Eine Render-Einheit des Chats, in Nachrichten-Reihenfolge. Wird EINMAL ueber ALLE
// Nachrichten berechnet (nicht pro Lade-Batch), damit das Gruppieren nicht quadratisch wird und
// sich beim Nachladen nicht mehr umgruppiert (kein Springen). Fenster-/Reihenfolge-Logik arbeitet
// danach nur noch auf diesen Einheiten.
type RenderUnit =
  | { kind: 'progress'; anchorIndex: number; box: TbProgressBoxData }
  | { kind: 'chain'; anchorIndex: number; indices: number[] }
  | { kind: 'single'; index: number };

// Baut den vollstaendigen Einheiten-Plan (rein, nur index-basiert). Entspricht exakt der frueheren
// Vorrang-Logik: Fortschritts-Boxen > Werkzeug-Ketten (>=2) > Einzelnachricht.
function buildRenderPlan(messages: Message[]): RenderUnit[] {
  const { boxes, claimedKeys } = collectProgressBoxes(messages);
  const progressAnchorToBox = new Map<number, TbProgressBoxData>();
  for (const box of boxes.values()) progressAnchorToBox.set(box.anchorIndex, box);

  const progressClaimedIndices = new Set<number>();
  messages.forEach((message, index) => {
    const ids = [
      ...getToolRequests(message).map((r) => r.id),
      ...getToolResponses(message).map((r) => r.id),
    ];
    if (ids.length > 0 && ids.every((id) => claimedKeys.has(id))) {
      progressClaimedIndices.add(index);
    }
  });

  const chainByIndex = new Map<number, number[]>();
  for (const chain of identifyConsecutiveToolCalls(messages)) {
    if (chain.length >= 2 && !chain.some((i) => progressClaimedIndices.has(i))) {
      for (const i of chain) chainByIndex.set(i, chain);
    }
  }

  const plan: RenderUnit[] = [];
  const renderedChains = new Set<number>();
  messages.forEach((_message, index) => {
    if (progressClaimedIndices.has(index)) {
      const box = progressAnchorToBox.get(index);
      if (box) plan.push({ kind: 'progress', anchorIndex: index, box });
      return;
    }
    const chain = chainByIndex.get(index);
    if (chain) {
      const anchor = chain[0];
      if (renderedChains.has(anchor)) return;
      renderedChains.add(anchor);
      plan.push({ kind: 'chain', anchorIndex: anchor, indices: chain });
      return;
    }
    plan.push({ kind: 'single', index });
  });
  return plan;
}

export default function ProgressiveMessageList({
  messages,
  sessionId,
  toolCallNotifications = emptyToolCallNotifications,
  append = emptyAppend,
  isUserMessage,
  batchSize = 12,
  batchDelay = 16,
  showLoadingThreshold = 40,
  renderMessage,
  isStreamingMessage = false,
  onMessageUpdate,
  onRenderingComplete,
  submitElicitationResponse,
}: ProgressiveMessageListProps) {
  const intl = useIntl();

  const rowContexts = useMemo(() => deriveMessageRowContexts(messages), [messages]);
  // Einmalige, nachrichtenweite Gruppierung (siehe buildRenderPlan). Memoisiert auf messages.
  const plan = useMemo(() => buildRenderPlan(messages), [messages]);
  const totalUnits = plan.length;

  // TB-Software: Progressiv vom ENDE her laden (neueste Eintraege zuerst sichtbar), aeltere wachsen
  // im Hintergrund nach OBEN. renderedUnits zaehlt die bereits sichtbaren Einheiten vom Ende.
  const [renderedUnits, setRenderedUnits] = useState(() =>
    messages.length <= showLoadingThreshold ? totalUnits : Math.min(batchSize, totalUnits)
  );
  const completedMessageKeyRef = useRef<string | null>(null);
  const isLoading = renderedUnits < totalUnits;

  useEffect(() => {
    if (messages.length <= showLoadingThreshold) {
      setRenderedUnits(totalUnits);
      return;
    }
    if (renderedUnits >= totalUnits) return;

    const timeout = window.setTimeout(() => {
      setRenderedUnits((current) => Math.min(current + batchSize, totalUnits));
    }, batchDelay);

    return () => window.clearTimeout(timeout);
  }, [batchDelay, batchSize, renderedUnits, totalUnits, messages.length, showLoadingThreshold]);

  useEffect(() => {
    if (isLoading) return;

    const completedMessageKey = `${sessionId}:${messages.length}`;
    if (completedMessageKeyRef.current === completedMessageKey) return;

    const timeout = window.setTimeout(() => {
      completedMessageKeyRef.current = completedMessageKey;
      onRenderingComplete?.();
    }, 50);

    return () => window.clearTimeout(timeout);
  }, [isLoading, messages.length, onRenderingComplete, sessionId]);

  useEffect(() => {
    if (!isLoading) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = window.electron.platform === 'darwin';
      const isSearchShortcut = (isMac ? event.metaKey : event.ctrlKey) && event.key === 'f';

      if (isSearchShortcut) {
        setRenderedUnits(totalUnits);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, totalUnits]);

  const lastIndex = messages.length - 1;

  const buildRow = (message: Message, index: number): ReactNode => {
      if (!message.metadata.userVisible) return null;
      if (renderMessage) return renderMessage(message, index);

      const isUser = isUserMessage(message);
      const messageIdentifier = message.id ?? `msg-${index}-${message.created}`;
      const messageKey = getSystemNotification(message)
        ? `notification-${messageIdentifier}`
        : messageIdentifier;
      const rowContext = rowContexts[index];
      const currentResolvedModel = getResolvedModel(message);
      const modelChangeMessage =
        currentResolvedModel &&
        rowContext.previousResolvedModel &&
        currentResolvedModel !== rowContext.previousResolvedModel
          ? intl.formatMessage(i18n.modelChanged, {
              previousModel: getModelDisplayName(rowContext.previousResolvedModel),
              currentModel: getModelDisplayName(currentResolvedModel),
            })
          : null;
      const toolNotifications = rowContext.toolStates.map((toolState) =>
        toolCallNotifications.get(toolState.requestId)
      );

      // TB-Software: „Nochmals" nur an der letzten Antwort - stellt die vorausgehende User-Frage erneut.
      let regenerateText: string | undefined;
      if (index === lastIndex && !isUser && message.role === 'assistant') {
        for (let i = index - 1; i >= 0; i--) {
          const prev = messages[i];
          if (prev.role === 'user') {
            const t = getTextAndImageContent(prev).textContent.trim();
            if (t) regenerateText = t;
            break;
          }
        }
      }

      return (
        <MessageRow
          key={messageKey}
          append={append}
          index={index}
          regenerateText={regenerateText}
          isStreaming={
            isStreamingMessage && !isUser && index === lastIndex && message.role === 'assistant'
          }
          isUser={isUser}
          message={message}
          modelChangeMessage={modelChangeMessage}
          onMessageUpdate={onMessageUpdate}
          rowContext={rowContext}
          sessionId={sessionId}
          submitElicitationResponse={submitElicitationResponse}
          toolNotifications={toolNotifications}
        />
      );
  };

  const renderUnit = (unit: RenderUnit): ReactNode => {
    if (unit.kind === 'progress') {
      return <TbProgressBox key={`tb-progress-${unit.box.key}`} box={unit.box} />;
    }
    if (unit.kind === 'chain') {
      const rows = unit.indices
        .map((i) => buildRow(messages[i], i))
        .filter((r): r is ReactNode => r != null && r !== false);
      if (rows.length >= 2) {
        return (
          <ActivityTree
            key={`activity-${unit.anchorIndex}`}
            count={rows.length}
            title={buildActivityTitle(unit.indices, messages)}
          >
            {rows}
          </ActivityTree>
        );
      }
      return <Fragment key={`chain-${unit.anchorIndex}`}>{rows}</Fragment>;
    }
    return buildRow(messages[unit.index], unit.index);
  };

  // Fenster vom Ende her: die juengsten renderedUnits Einheiten, in Nachrichten-Reihenfolge.
  const visibleUnits = plan.slice(Math.max(0, totalUnits - renderedUnits));
  const messageRows = visibleUnits.map(renderUnit).filter((r) => r != null && r !== false);

  return (
    <>
      {/* Ladehinweis OBEN, da aeltere Eintraege nach oben nachwachsen (neueste sind schon da). */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-8">
          <LoadingGoose
            message={intl.formatMessage(i18n.loadingMessages, {
              renderedCount: renderedUnits,
              totalCount: totalUnits,
            })}
          />
          <div className="text-xs text-text-secondary mt-2">
            {intl.formatMessage(i18n.searchHint)}
          </div>
        </div>
      )}

      {messageRows}
    </>
  );
}
