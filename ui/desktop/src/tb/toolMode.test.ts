import { describe, expect, it } from 'vitest';
import { isToolModeMismatch, modelNeedsToolshim, recommendedToolshim } from './toolMode';

describe('toolMode coupling (2026-09-24: auto:chat ist Qwen3.6, tool-fähig)', () => {
  it('kein Modell braucht mehr den Toolshim -> immer Nativ', () => {
    for (const m of ['auto:code', 'auto:chat', 'AUTO:CHAT', '  auto:code  ', 'qwen3-coder', '', null, undefined]) {
      expect(modelNeedsToolshim(m)).toBe(false);
      expect(recommendedToolshim(m)).toBe(false);
    }
  });

  it('jede aktivierte "Kompatibel"-Einstellung gilt als Fehl-Kombi (Nativ ist empfohlen)', () => {
    // Toolshim AN -> mismatch (egal welches Modell), Klick heilt auf Nativ.
    expect(isToolModeMismatch('auto:code', true)).toBe(true);
    expect(isToolModeMismatch('auto:chat', true)).toBe(true);
    // Toolshim AUS (Nativ) -> passt für beide.
    expect(isToolModeMismatch('auto:code', false)).toBe(false);
    expect(isToolModeMismatch('auto:chat', false)).toBe(false);
  });
});
