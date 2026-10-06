import { useSyncExternalStore } from 'react';
import { Volume2, Square } from 'lucide-react';
import { tbSpeech } from './speechOutput';

export function useTbSpeakingId(): string | null {
  return useSyncExternalStore(tbSpeech.subscribe, tbSpeech.getSpeakingId, tbSpeech.getSpeakingId);
}

interface TbSpeakButtonProps {
  messageId: string;
  text: string;
}

/**
 * TB-Software: „Vorlesen"-Knopf an einer Assistenten-Antwort. Liest den Text mit
 * der lokalen OS-Stimme vor; waehrend des Sprechens zeigt er „Stopp".
 */
export function TbSpeakButton({ messageId, text }: TbSpeakButtonProps) {
  const speakingId = useTbSpeakingId();
  const isSpeaking = speakingId === messageId;

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

  return (
    <button
      type="button"
      onClick={() => tbSpeech.toggle(messageId, text)}
      title={isSpeaking ? 'Vorlesen stoppen' : 'Antwort vorlesen'}
      aria-label={isSpeaking ? 'Vorlesen stoppen' : 'Antwort vorlesen'}
      className="flex items-center text-text-secondary hover:text-text-primary transition-colors p-1 rounded-md hover:bg-background-secondary"
    >
      {isSpeaking ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
    </button>
  );
}
