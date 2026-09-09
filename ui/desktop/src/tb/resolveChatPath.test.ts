// TB-Software: Tests fuer resolveChatPath — die (sicherheitsrelevante) Aufloesung
// bloßer Dateinamen/relativer Pfade gegen das Arbeitsverzeichnis des Chats.
import { describe, it, expect } from 'vitest';
import { resolveChatPath } from './resolveChatPath';

const WD = 'C:\\work';

describe('resolveChatPath', () => {
  it('loest einen bloßen Dateinamen gegen das Arbeitsverzeichnis auf', () => {
    expect(resolveChatPath('bericht.txt', WD)).toBe('C:\\work\\bericht.txt');
  });

  it('loest relative Unterpfade auf und normalisiert Vorwaerts-Slashes', () => {
    expect(resolveChatPath('unterordner/report.md', WD)).toBe('C:\\work\\unterordner\\report.md');
    expect(resolveChatPath('./a/b.txt', WD)).toBe('C:\\work\\a\\b.txt');
  });

  it('behaelt Dateinamen mit Leerzeichen (haeufig bei Laien)', () => {
    expect(resolveChatPath('Mein Report.pdf', WD)).toBe('C:\\work\\Mein Report.pdf');
    expect(resolveChatPath('Quartals Bericht.xlsx', WD)).toBe('C:\\work\\Quartals Bericht.xlsx');
  });

  it('gibt absolute lokale Pfade unveraendert (normalisiert) zurueck', () => {
    expect(resolveChatPath('D:\\daten\\x.txt', WD)).toBe('D:\\daten\\x.txt');
    expect(resolveChatPath('D:/daten/x.txt', WD)).toBe('D:\\daten\\x.txt');
  });

  it('verhindert Directory-Traversal (kein Ausbruch aus dem Arbeitsverzeichnis)', () => {
    expect(resolveChatPath('..\\secret.txt', WD)).toBeNull();
    expect(resolveChatPath('../../etc/passwd.txt', WD)).toBeNull();
    expect(resolveChatPath('a/../../b.txt', WD)).toBeNull();
  });

  it('weist URLs und Nicht-Datei-Prosa ab', () => {
    expect(resolveChatPath('http://example.com/x.txt', WD)).toBeNull();
    expect(resolveChatPath('file:///C:/x.txt', WD)).not.toBeNull(); // file:// ist ein lokaler Pfad
    expect(resolveChatPath('version 1.2.3', WD)).toBeNull(); // rein numerische "Endung"
    expect(resolveChatPath('Preis 5.00', WD)).toBeNull();
    expect(resolveChatPath('einfach nur text', WD)).toBeNull(); // keine Endung
  });

  it('weist illegale Windows-Zeichen und Zeilenumbrueche ab', () => {
    expect(resolveChatPath('a:b.txt', WD)).toBeNull(); // ':' (ADS/Laufwerk)
    expect(resolveChatPath('a|b.txt', WD)).toBeNull();
    expect(resolveChatPath('a\nb.txt', WD)).toBeNull();
  });

  it('gibt null zurueck, wenn kein Arbeitsverzeichnis vorhanden ist (fuer relative Pfade)', () => {
    expect(resolveChatPath('bericht.txt', '')).toBeNull();
    expect(resolveChatPath('bericht.txt', null)).toBeNull();
    expect(resolveChatPath('bericht.txt', undefined)).toBeNull();
    // absolute Pfade brauchen kein Arbeitsverzeichnis
    expect(resolveChatPath('C:\\a\\b.txt', undefined)).toBe('C:\\a\\b.txt');
  });

  it('akzeptiert Endungen mit Buchstaben (auch ziffern-fuehrend wie .7z), lehnt rein-numerische ab', () => {
    expect(resolveChatPath('archiv.7z', WD)).toBe('C:\\work\\archiv.7z');
    expect(resolveChatPath('clip.mp4', WD)).toBe('C:\\work\\clip.mp4');
    expect(resolveChatPath('build.123', WD)).toBeNull();
  });

  it('trimmt Whitespace am Rand und behandelt Leerstrings', () => {
    expect(resolveChatPath('  bericht.txt  ', WD)).toBe('C:\\work\\bericht.txt');
    expect(resolveChatPath('', WD)).toBeNull();
    expect(resolveChatPath('   ', WD)).toBeNull();
  });

  it('normalisiert einen abschliessenden Separator im Arbeitsverzeichnis', () => {
    expect(resolveChatPath('x.txt', 'C:\\work\\')).toBe('C:\\work\\x.txt');
    expect(resolveChatPath('x.txt', 'C:/work/')).toBe('C:\\work\\x.txt');
  });
});
