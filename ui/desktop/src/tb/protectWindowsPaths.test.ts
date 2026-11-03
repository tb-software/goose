import { describe, it, expect } from 'vitest';
import { protectWindowsPaths } from './protectWindowsPaths';

// Diese Unit-Tests pruefen den String-Transform. Der eigentliche Beweis (Markdown rendert den
// Pfad verbatim) liegt im End-to-End-Test in components/MarkdownContent.test.tsx; hier sichern
// wir die Escape-Logik und das Ueberspringen von Code-Regionen ab.
describe('protectWindowsPaths', () => {
  it('escapet den Unterstrich-Pfad so, dass das Satzzeichen erhalten bleibt', () => {
    // "G:\_AI" -> jedes Satzzeichen (: \ _) escaped
    expect(protectWindowsPaths('G:\\_AI')).toBe('G\\:\\\\\\_AI');
  });

  it('fasst mehrere Segmente an', () => {
    expect(protectWindowsPaths('G:\\_AI\\_Documents')).toBe('G\\:\\\\\\_AI\\\\\\_Documents');
  });

  it('laesst Text ohne Pfad unveraendert', () => {
    expect(protectWindowsPaths('a **bold** and _em_ text')).toBe('a **bold** and _em_ text');
  });

  it('laesst Forward-Slash-Pfade inhaltlich intakt (Escapes aendern die Ausgabe nicht)', () => {
    // G:/_AI enthaelt ein "X:/" -> wird verarbeitet, aber das Rendern ergibt denselben Pfad.
    expect(protectWindowsPaths('G:/_AI')).toBe('G\\:\\/\\_AI');
  });

  it('laesst Pfade in Inline-Code unberuehrt', () => {
    expect(protectWindowsPaths('`G:\\_AI`')).toBe('`G:\\_AI`');
  });

  it('laesst Pfade in Code-Fences unberuehrt', () => {
    const fenced = '```\nG:\\_AI\n```';
    expect(protectWindowsPaths(fenced)).toBe(fenced);
  });

  it('verarbeitet Pfad vor dem Fence, laesst den Fence-Inhalt in Ruhe', () => {
    const input = 'siehe G:\\_AI\n```\nG:\\_AI\n```';
    expect(protectWindowsPaths(input)).toBe('siehe G\\:\\\\\\_AI\n```\nG:\\_AI\n```');
  });

  it('behandelt UNC-Pfade', () => {
    expect(protectWindowsPaths('\\\\server\\_share')).toBe('\\\\\\\\server\\\\\\_share');
  });

  it('early-out ohne Backslash und ohne Laufwerk-Forward-Slash', () => {
    const s = 'kein pfad hier, nur text.';
    expect(protectWindowsPaths(s)).toBe(s);
  });
});
