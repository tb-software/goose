// TB-Software: Regressionstest fuer customUrlTransform.
// Hintergrund: react-markdown v10 prozent-kodiert Backslashes in URLs (C:%5C...),
// und der WHATWG-URL-Parser normalisiert C:\... zu protocol "file:". Beides zusammen
// fuehrte dazu, dass die BLOCKED_PROTOCOLS-Sperre bare Windows-Pfade auf "" setzte ->
// href leer -> Klick tot -> Vorschau-Panel oeffnete nie. Diese Tests fixieren, dass
// lokale Pfade (auch prozent-kodiert) erhalten bleiben und echte boese Protokolle
// weiterhin geblockt werden.
import { describe, it, expect } from 'vitest';
import { customUrlTransform } from './MarkdownContent';

describe('customUrlTransform', () => {
  it('behaelt prozent-kodierte Windows-Pfade (C:%5C...) als dekodierten Pfad', () => {
    expect(customUrlTransform('C:%5CTemp%5Ctbe2e%5Cpreview.html')).toBe('C:\\Temp\\tbe2e\\preview.html');
  });

  it('behaelt rohe Windows-Pfade mit Backslash', () => {
    expect(customUrlTransform('C:\\Temp\\x.md')).toBe('C:\\Temp\\x.md');
  });

  it('behaelt Windows-Pfade mit Forward-Slash', () => {
    expect(customUrlTransform('C:/Temp/x.txt')).toBe('C:/Temp/x.txt');
  });

  it('behaelt UNC-Pfade', () => {
    expect(customUrlTransform('\\\\server\\share\\datei.txt')).toBe('\\\\server\\share\\datei.txt');
  });

  it('blockt javascript: weiterhin', () => {
    expect(customUrlTransform('javascript:alert(1)')).toBe('');
  });

  it('blockt vbscript: weiterhin', () => {
    expect(customUrlTransform('vbscript:msgbox(1)')).toBe('');
  });

  it('laesst normale http(s)-URLs unveraendert', () => {
    expect(customUrlTransform('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });
});
