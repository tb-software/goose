// TB-Software: Gemeinsame Erkennung von Windows-/UNC-Dateipfaden im Chat-Fliesstext.
//
// Problem: Dateipfade enthalten oft LEERZEICHEN ("C:\Temp\screenshot - 2026_11_02 11-25-19.jpg",
// "T:\Tasks\20240103 - Knowledgebase AI\...\datei.md"). Die bisherige Erkennung brach beim ersten
// Leerzeichen ab -> der Link zeigte auf einen abgeschnittenen Pfad ("C:\Temp\screenshot") und die
// Datei wurde "nicht gefunden". Dieser Matcher nimmt den Pfad GREEDY auf (Leerzeichen erlaubt) und
// klemmt ihn dann am echten Ende ab: an der Datei-Endung, sonst (Ordner ohne Endung) am ersten
// Leerzeichen wie bisher. Genutzt von remarkLocalPaths (klickbare Links) und copyPath (Kontextmenue),
// damit beide denselben, vollstaendigen Pfad liefern.

// GREEDY-Anker: echtes Laufwerk am Wort-/Zeilenanfang (kein URL-Schema dank Lookbehind + (?!/))
// ODER UNC "\\host...". Danach so viel wie moeglich - inklusive Leerzeichen -, gestoppt nur an
// Zeichen, die in Windows-Pfaden unzulaessig sind (" < > |, Zeilenumbruch) bzw. Markdown/Code
// begrenzen (] und Backtick). Schliessende ')' / Satzzeichen bleiben drin und werden beim Klemmen
// wieder entfernt.
const WIN_PATH_GREEDY =
  /(?:(?<![A-Za-z])[a-zA-Z]:[\\/](?!\/)|\\\\[^\s\\<>"|\r\n])[^<>"|\r\n\]`]*/g;

// Datei-Endung als Pfad-Ende: ein Punkt, dann MINDESTENS ein Buchstabe (so zaehlen "1.2.3"/"5.00"
// nicht als Endung), bis zu 12 alphanumerische Zeichen, gefolgt von Pfad-Ende oder einem Trenner.
// Der Trenner-Lookahead enthaelt bewusst KEIN "." (sonst wuerde "archiv.tar.gz" schon bei ".tar"
// abgeschnitten).
const EXT_END = /\.[A-Za-z][A-Za-z0-9]{0,11}(?=$|[\s)\],;:!?'"<>|])/;

/**
 * Klemmt einen greedy aufgenommenen Pfad-Lauf auf den echten Pfad ab:
 * - endet der Lauf auf eine Datei (Endung vorhanden), bis unmittelbar nach der Endung;
 * - sonst (Ordner ohne Endung) bis zum ersten Leerzeichen (konservativ, wie zuvor);
 * - abschliessende Satzzeichen / schliessende Klammern werden entfernt.
 */
export function clampWindowsPath(raw: string): string {
  const ext = EXT_END.exec(raw);
  const out = ext ? raw.slice(0, ext.index + ext[0].length) : raw.split(/\s/)[0];
  return out.replace(/[.,;:!?)\]]+$/, '');
}

export interface WindowsPathMatch {
  index: number;
  value: string;
}

/**
 * Findet alle Windows-/UNC-Pfade in einem Text. Leerzeichen innerhalb des Pfades werden
 * unterstuetzt; nach jedem Treffer wird direkt hinter dem ECHTEN Pfad-Ende weitergesucht, damit
 * mehrere Pfade in einer Zeile (und nachfolgender Fliesstext) korrekt getrennt werden.
 */
export function matchWindowsPaths(text: string): WindowsPathMatch[] {
  const res: WindowsPathMatch[] = [];
  WIN_PATH_GREEDY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIN_PATH_GREEDY.exec(text)) !== null) {
    const value = clampWindowsPath(m[0]);
    if (value) {
      res.push({ index: m.index, value });
    }
    // Hinter dem geklemmten (echten) Pfad-Ende weitersuchen, nicht hinter dem greedy Lauf -
    // value.length >= Anker-Laenge (>=3), daher ist Fortschritt garantiert (keine Endlosschleife).
    WIN_PATH_GREEDY.lastIndex = m.index + Math.max(value.length, 1);
  }
  return res;
}
