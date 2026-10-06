import { describe, it, expect } from 'vitest';
import { stripMarkdownForSpeech, tbSpeech } from './speechOutput';

describe('stripMarkdownForSpeech', () => {
  it('entfernt Auszeichnungszeichen und behaelt den Text', () => {
    const out = stripMarkdownForSpeech('**fett** und _kursiv_ und `code`');
    expect(out).toContain('fett');
    expect(out).toContain('kursiv');
    expect(out).toContain('code');
    expect(out).not.toContain('**');
    expect(out).not.toContain('`');
  });

  it('liest Codebloecke nicht vor, sondern kuendigt sie an', () => {
    const out = stripMarkdownForSpeech('Text\n```js\nconst x = 1;\n```\nEnde');
    expect(out).toContain('Codeblock');
    expect(out).not.toContain('const x = 1');
  });

  it('behaelt bei Links nur den Text', () => {
    const out = stripMarkdownForSpeech('Siehe [die Doku](https://example.com/x) hier');
    expect(out).toContain('die Doku');
    expect(out).not.toContain('example.com');
  });

  it('entfernt Ueberschriften- und Listenzeichen', () => {
    const out = stripMarkdownForSpeech('# Titel\n- Punkt eins\n- Punkt zwei');
    expect(out).toContain('Titel');
    expect(out).toContain('Punkt eins');
    expect(out.startsWith('#')).toBe(false);
    expect(out).not.toContain('- Punkt');
  });

  it('liefert leeren String fuer leere Eingabe', () => {
    expect(stripMarkdownForSpeech('')).toBe('');
  });
});

describe('tbSpeech.claimAutoSpeak', () => {
  it('gibt pro id nur einmal true zurueck', () => {
    const id = `test-${Math.random()}`;
    expect(tbSpeech.claimAutoSpeak(id)).toBe(true);
    expect(tbSpeech.claimAutoSpeak(id)).toBe(false);
  });
});

describe('tbSpeech.configure', () => {
  it('schaltet den Gespraechsmodus um', () => {
    tbSpeech.configure({ conversation: true });
    expect(tbSpeech.isConversation()).toBe(true);
    tbSpeech.configure({ conversation: false });
    expect(tbSpeech.isConversation()).toBe(false);
  });
});
