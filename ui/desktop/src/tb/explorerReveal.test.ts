import { describe, expect, it } from 'vitest';
import nodePath from 'node:path';
import { explorerSelectSpec } from './explorerReveal';

// Alle Tests fahren die win32-Pfad-API, damit sie plattformunabhaengig (auch auf dem CI-Linux)
// das Windows-Verhalten pruefen.
const win32 = nodePath.win32;

describe('explorerSelectSpec', () => {
  it('quotet NUR den Pfad und setzt verbatim (Pfad MIT Leerzeichen)', () => {
    const spec = explorerSelectSpec('C:\\Users\\timob\\My Project\\index.html', win32);
    expect(spec.file).toBe('explorer.exe');
    expect(spec.windowsVerbatimArguments).toBe(true);
    // Genau ein Argument: /select, davor OHNE Quotes, Pfad in eigenen Quotes.
    expect(spec.args).toEqual(['/select,"C:\\Users\\timob\\My Project\\index.html"']);
  });

  it('funktioniert auch ohne Leerzeichen', () => {
    const spec = explorerSelectSpec('C:\\Tools\\build\\app.exe', win32);
    expect(spec.args).toEqual(['/select,"C:\\Tools\\build\\app.exe"']);
  });

  it('wandelt Forward-Slashes in Windows-Backslashes um', () => {
    const spec = explorerSelectSpec('C:/Users/timob/My Project/index.html', win32);
    expect(spec.args).toEqual(['/select,"C:\\Users\\timob\\My Project\\index.html"']);
  });

  it('entfernt einen Trailing-Separator (aber nicht den nach dem Laufwerk)', () => {
    expect(explorerSelectSpec('C:\\Daten\\Ordner\\', win32).args).toEqual([
      '/select,"C:\\Daten\\Ordner"',
    ]);
    // "C:\" bleibt erhalten (Laufwerkswurzel).
    expect(explorerSelectSpec('C:\\', win32).args).toEqual(['/select,"C:\\"']);
  });

  it('behaelt UNC-Pfade', () => {
    const spec = explorerSelectSpec('\\\\server\\share\\Mit Leerzeichen\\d.txt', win32);
    expect(spec.args).toEqual(['/select,"\\\\server\\share\\Mit Leerzeichen\\d.txt"']);
  });

  it('das Quoting klammert NIE das ganze /select-Token (Regression)', () => {
    const arg = explorerSelectSpec('C:\\A B\\c.html', win32).args[0];
    // Falsch waere: "/select,C:\A B\c.html"  (fuehrendes Quote direkt vor /select)
    expect(arg.startsWith('/select,"')).toBe(true);
    expect(arg.startsWith('"/select')).toBe(false);
    expect(arg.endsWith('"')).toBe(true);
  });
});
