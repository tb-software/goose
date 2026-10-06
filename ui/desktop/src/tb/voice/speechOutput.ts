/**
 * TB-Software: Sprachausgabe (Text-to-Speech) ueber die lokale Web-Speech-API.
 *
 * Laeuft auf dem Geraet mit den echten OS-Stimmen (Windows SAPI), offline und
 * kostenlos. Waehlt - wie Metrux (G:\Development\Metrux\src\voice\SpeechOutput.ts) -
 * per Namens-Heuristik eine deutsche, standardmaessig weibliche Stimme, oder die
 * vom Nutzer gewaehlte Stimme. Ein einzelner Controller (Singleton) sorgt dafuer,
 * dass immer nur eine Antwort gleichzeitig gesprochen wird; React abonniert ihn
 * ueber useSyncExternalStore.
 */

/* global SpeechSynthesisVoice, SpeechSynthesisUtterance */

export type VoiceGender = 'female' | 'male';

// OS-Stimmen melden kein Geschlecht - deshalb Heuristik auf den Namen (lowercase).
const MALE_HINTS = [
  'male',
  'mann',
  'männlich',
  'maennlich',
  'markus',
  'conrad',
  'hans',
  'stefan',
  'yannick',
  'daniel',
];
const FEMALE_HINTS = [
  'female',
  'frau',
  'weiblich',
  'anna',
  'petra',
  'katja',
  'marlene',
  'vicki',
  'helena',
  'hedda',
];

function hasHint(name: string, hints: string[]): boolean {
  return hints.some((h) => name.includes(h));
}

/**
 * Wandelt Markdown grob in vorlesbaren Klartext: Codebloecke werden nicht
 * vorgelesen (das klingt kauderwelsch), Links behalten nur ihren Text, und
 * Auszeichnungszeichen fallen weg.
 */
export function stripMarkdownForSpeech(md: string): string {
  if (!md) return '';
  let t = md;
  // Fenced code blocks -> kurzer Hinweis statt Vorlesen des Codes.
  t = t.replace(/```[\s\S]*?```/g, ' . Codeblock. ');
  t = t.replace(/~~~[\s\S]*?~~~/g, ' . Codeblock. ');
  // Inline-Code: Backticks entfernen, Inhalt behalten.
  t = t.replace(/`([^`]+)`/g, '$1');
  // Bilder ![alt](url) -> alt.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links [text](url) -> text.
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Ueberschriften-/Zitat-/Listenzeichen am Zeilenanfang.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  t = t.replace(/^\s{0,3}([-*+])\s+/gm, '');
  t = t.replace(/^\s{0,3}\d+\.\s+/gm, '');
  // Fett/Kursiv/Durchstreichen.
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/(\*|_)(.*?)\1/g, '$2');
  t = t.replace(/~~(.*?)~~/g, '$1');
  // Resttabellen-/HTML-Reste.
  t = t.replace(/\|/g, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  // Mehrfach-Leerraum zusammenfassen.
  t = t.replace(/\r/g, '');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{2,}/g, '. ');
  t = t.replace(/\n/g, '. ');
  t = t.replace(/\s+\./g, '.');
  return t.trim();
}

interface VoiceSettings {
  conversation: boolean;
  voiceURI: string; // '' = Auto (per Heuristik)
  rate: number; // 0.5 .. 2.0
  gender: VoiceGender;
}

class TbSpeechController {
  static get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  private settings: VoiceSettings = {
    conversation: false,
    voiceURI: '',
    rate: 1.15,
    gender: 'female',
  };

  private speakingId: string | null = null;
  private listeners = new Set<() => void>();
  // Welche Nachrichten wurden im Gespraechsmodus bereits automatisch vorgelesen.
  private autoSpoken = new Set<string>();

  constructor() {
    if (TbSpeechController.supported) {
      // Stimmen laden oft asynchron - einmal antriggern.
      try {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => this.notify();
      } catch {
        /* ignore */
      }
    }
    this.subscribe = this.subscribe.bind(this);
    this.getSpeakingId = this.getSpeakingId.bind(this);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSpeakingId(): string | null {
    return this.speakingId;
  }

  private notify(): void {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  }

  configure(partial: Partial<VoiceSettings>): void {
    this.settings = { ...this.settings, ...partial };
  }

  isConversation(): boolean {
    return this.settings.conversation;
  }

  listVoices(): SpeechSynthesisVoice[] {
    if (!TbSpeechController.supported) return [];
    try {
      const all = window.speechSynthesis.getVoices();
      const de = all.filter((v) => v.lang?.toLowerCase().startsWith('de'));
      return de.length ? de : all;
    } catch {
      return [];
    }
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    if (!TbSpeechController.supported) return null;
    const pool = this.listVoices();
    if (!pool.length) return null;
    if (this.settings.voiceURI) {
      const chosen = pool.find((v) => v.voiceURI === this.settings.voiceURI);
      if (chosen) return chosen;
    }
    const want = this.settings.gender === 'male' ? MALE_HINTS : FEMALE_HINTS;
    const avoid = this.settings.gender === 'male' ? FEMALE_HINTS : MALE_HINTS;
    const match = pool.find((v) => {
      const n = (v.name || '').toLowerCase();
      return hasHint(n, want) && !hasHint(n, avoid);
    });
    return match ?? pool[0] ?? null;
  }

  /** Liest die Nachricht mit der id vor. onEnd feuert bei Ende/Abbruch/Fehler. */
  speak(id: string, text: string, onEnd?: () => void): void {
    const plain = stripMarkdownForSpeech(text);
    if (!TbSpeechController.supported || !plain) {
      onEnd?.();
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = 'de-DE';
    const voice = this.pickVoice();
    if (voice) u.voice = voice;
    u.rate = Math.max(0.5, Math.min(2, this.settings.rate || 1.15));
    u.pitch = this.settings.gender === 'male' ? 0.8 : 1.05;
    u.volume = 1;
    const finish = () => {
      if (this.speakingId === id) {
        this.speakingId = null;
        this.notify();
      }
      onEnd?.();
    };
    u.onend = finish;
    u.onerror = finish;
    this.speakingId = id;
    this.notify();
    try {
      window.speechSynthesis.speak(u);
    } catch {
      finish();
    }
  }

  stop(): void {
    if (TbSpeechController.supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    if (this.speakingId !== null) {
      this.speakingId = null;
      this.notify();
    }
  }

  /** Umschalten: spricht die id gerade, wird gestoppt; sonst wird vorgelesen. */
  toggle(id: string, text: string, onEnd?: () => void): void {
    if (this.speakingId === id) {
      this.stop();
    } else {
      this.speak(id, text, onEnd);
    }
  }

  /** true, wenn diese Nachricht im Gespraechsmodus noch nicht vorgelesen wurde (markiert sie dann). */
  claimAutoSpeak(id: string): boolean {
    if (this.autoSpoken.has(id)) return false;
    this.autoSpoken.add(id);
    return true;
  }
}

export const tbSpeech = new TbSpeechController();
