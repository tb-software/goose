// TB-Software: Reiner, testbarer Kern fuer "Datei im Explorer markieren" (explorer.exe /select).
// Bewusst OHNE Electron/spawn-Abhaengigkeit, damit das Quoting VOR jedem Deploy mit vitest gegen
// Pfade mit/ohne Leerzeichen geprueft werden kann.
//
// Hintergrund (Bug, der "im falschen Pfad landen" verursacht hat): explorer.exe erwartet
//   explorer.exe /select,"C:\Ordner Mit Leerzeichen\datei.html"
// also NUR den Pfad in Anfuehrungszeichen, das Token "/select," davor OHNE. Node setzt beim
// normalen (nicht-verbatim) spawn automatisch Quotes um JEDES Argument, das ein Leerzeichen
// enthaelt - dabei wird das GANZE Token "/select,C:\... Mit Leerzeichen\datei.html" geklammert.
// Diese Form ignoriert explorer und oeffnet stattdessen den Standardordner (Dokumente/Desktop).
// Loesung: windowsVerbatimArguments = true (Node quotet NICHTS selbst) und nur den Pfad quoten.

import nodePath from 'node:path';

type PathApi = typeof nodePath.win32;

export interface ExplorerSelectSpec {
  file: 'explorer.exe';
  args: string[];
  windowsVerbatimArguments: true;
}

// Baut die Spawn-Argumente fuer "explorer.exe /select,<pfad>". Trailing-Separatoren werden
// entfernt (ausser direkt nach dem Laufwerk, "C:\"), der Pfad wird auf Windows-Form normalisiert
// und in eigene Anfuehrungszeichen gesetzt. Windows-Pfade enthalten nie ein '"' -> sicher.
export function explorerSelectSpec(rawPath: string, pathApi: PathApi = nodePath.win32): ExplorerSelectSpec {
  const trimmed = (rawPath ?? '').replace(/[\\/]+$/, (m: string, off: number) => (off <= 2 ? m : ''));
  const native = pathApi.normalize(trimmed);
  return {
    file: 'explorer.exe',
    args: ['/select,"' + native + '"'],
    windowsVerbatimArguments: true,
  };
}
