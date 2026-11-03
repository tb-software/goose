import { describe, it, expect } from 'vitest';
import { clampWindowsPath, matchWindowsPaths } from './windowsPath';

describe('clampWindowsPath', () => {
  it('behaelt einen Pfad mit Leerzeichen bis zur Datei-Endung (Screenshot-Fall)', () => {
    expect(clampWindowsPath('C:\\Temp\\screenshot - 2026_11_02 11-25-19.jpg')).toBe(
      'C:\\Temp\\screenshot - 2026_11_02 11-25-19.jpg'
    );
  });

  it('schneidet nachfolgenden Fliesstext nach der Endung ab', () => {
    expect(clampWindowsPath('C:\\Temp\\mein bild.jpg ist gross')).toBe('C:\\Temp\\mein bild.jpg');
  });

  it('behaelt den vollen tiefen Pfad mit Leerzeichen (T:-Fall)', () => {
    const p =
      'T:\\Tasks\\20240103 - Knowledgebase AI\\KOBAI_Konzept_2026B\\KI_Praesentation_VE_2026\\belege\\00_Quellenindex.md';
    expect(clampWindowsPath(p)).toBe(p);
  });

  it('schneidet NICHT in doppelte Endungen (.tar.gz bleibt ganz)', () => {
    expect(clampWindowsPath('C:\\a\\archiv.tar.gz')).toBe('C:\\a\\archiv.tar.gz');
  });

  it('entfernt abschliessende Satzzeichen / Klammern nach der Endung', () => {
    expect(clampWindowsPath('C:\\a\\x.md).')).toBe('C:\\a\\x.md');
  });

  it('Ordner ohne Endung: konservativ bis zum ersten Leerzeichen', () => {
    // bekannte Grenze - Ordnernamen mit Leerzeichen besser in Backticks referenzieren
    expect(clampWindowsPath('C:\\Program Files')).toBe('C:\\Program');
  });

  it('Pfad ohne Leerzeichen und ohne Endung bleibt unveraendert', () => {
    expect(clampWindowsPath('G:\\_AI')).toBe('G:\\_AI');
    expect(clampWindowsPath('C:\\Users\\timob\\Downloads')).toBe('C:\\Users\\timob\\Downloads');
  });
});

describe('matchWindowsPaths', () => {
  it('findet den vollen Pfad mit Leerzeichen als EINEN Treffer', () => {
    const r = matchWindowsPaths('Siehe C:\\Temp\\screenshot - 2026_11_02 11-25-19.jpg bitte.');
    expect(r).toHaveLength(1);
    expect(r[0].value).toBe('C:\\Temp\\screenshot - 2026_11_02 11-25-19.jpg');
    expect(r[0].index).toBe('Siehe '.length);
  });

  it('trennt zwei Pfade in derselben Zeile', () => {
    const r = matchWindowsPaths('siehe C:\\a\\x.md und D:\\b\\y.md');
    expect(r.map((m) => m.value)).toEqual(['C:\\a\\x.md', 'D:\\b\\y.md']);
  });

  it('erkennt UNC-Pfade mit Leerzeichen', () => {
    const r = matchWindowsPaths('\\\\server\\share\\Mein Report.pdf');
    expect(r).toHaveLength(1);
    expect(r[0].value).toBe('\\\\server\\share\\Mein Report.pdf');
  });

  it('erkennt Forward-Slash-Laufwerke', () => {
    const r = matchWindowsPaths('open G:/_AI/notes.txt now');
    expect(r.map((m) => m.value)).toEqual(['G:/_AI/notes.txt']);
  });

  it('ignoriert URL-Schemata (kein falsches Laufwerk)', () => {
    expect(matchWindowsPaths('http://example.com/x')).toHaveLength(0);
    expect(matchWindowsPaths('ftp://host/file')).toHaveLength(0);
  });

  it('kein Treffer in reinem Fliesstext', () => {
    expect(matchWindowsPaths('version 1.2.3 kostet 5.00 pro Stueck')).toHaveLength(0);
  });
});
