// TB-Software: Setzt den Fenstertitel (native Titelleiste) auf
//   "TB-Goose — <Chat-Titel> · <Status>[ · <n> wartend]"
// So sieht man auf einen Blick, welcher Chat offen ist, ob er arbeitet und wie
// viele andere Chats gerade im Hintergrund noch laufen/warten.
import { useEffect } from 'react';
import { ChatState } from '../types/chatState';
import { tbListChats } from '../acp/chatSessionStore';

const APP_NAME = 'TB-Goose';

// Chats, die aktiv arbeiten bzw. auf eine (Nutzer-)Antwort warten -> zaehlen als "wartend".
const BUSY_STATES = new Set<ChatState>([
  ChatState.Streaming,
  ChatState.Thinking,
  ChatState.Compacting,
  ChatState.WaitingForUserInput,
]);

function statusLabel(state: ChatState): string {
  switch (state) {
    case ChatState.Streaming:
    case ChatState.Thinking:
      return 'arbeitet …';
    case ChatState.Compacting:
      return 'verdichtet …';
    case ChatState.WaitingForUserInput:
      return 'wartet auf Eingabe';
    case ChatState.LoadingConversation:
    case ChatState.RestartingAgent:
      return 'lädt …';
    default:
      return 'bereit';
  }
}

export function useTbWindowTitle(
  chatTitle: string | undefined,
  chatState: ChatState,
  sessionId: string | undefined
): void {
  useEffect(() => {
    const apply = () => {
      const title = (chatTitle && chatTitle.trim()) || 'Neuer Chat';
      let text = `${APP_NAME} — ${title} · ${statusLabel(chatState)}`;
      // Andere Chats, die gerade arbeiten/warten (den aktuellen ausklammern).
      const busyOthers = tbListChats().filter(
        (c) => c.sessionId !== sessionId && c.hasSession && BUSY_STATES.has(c.chatState)
      ).length;
      if (busyOthers > 0) {
        text += ` · ${busyOthers} wartend`;
      }
      document.title = text;
    };
    apply();
    // Der Status anderer Chats hat keinen eigenen Event-Kanal hier -> in kleinem
    // Intervall aktualisieren (guenstig, nur ein Titel-String).
    const timer = window.setInterval(apply, 1200);
    return () => {
      window.clearInterval(timer);
      document.title = APP_NAME;
    };
  }, [chatTitle, chatState, sessionId]);
}
