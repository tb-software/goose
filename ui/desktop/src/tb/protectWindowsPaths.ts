// TB-Software: Schuetzt Windows-Dateipfade im Chat-Text vor der Markdown-Verarbeitung.
//
// Problem: MarkdownContent rendert Nutzer- UND Assistenten-Text als CommonMark. Dort ist ein
// Backslash vor einem ASCII-Satzzeichen eine Escape-Sequenz ("\_" -> "_"), der Backslash wird
// verschluckt. Windows-Pfade mit Unterstrich-/Punkt-/Klammer-Segmenten zerfallen dadurch:
//   "G:\_AI"            -> "G:_AI"
//   "G:\_AI\_Documents" -> "G:_AI_Documents"
//   "D:\_AI\Models"     -> "D:_AI\Models"
// (Ein Backslash vor einem Buchstaben wie "\t"/"\M" bleibt dagegen erhalten, weil Buchstaben
// keine escapebaren Satzzeichen sind.) Danach erkennt auch remarkLocalPaths den Pfad nicht mehr.
//
// Loesung: In jedem erkannten Windows-Pfad (Laufwerk "X:\"/"X:/" oder UNC "\\server") JEDES
// CommonMark-escapebare Satzzeichen backslash-escapen, damit der Parser den Pfad 1:1 ausgibt.
// Der aufgeloeste Text-Knoten ist wieder der literale Pfad -> remarkLocalPaths verlinkt ihn wie
// bisher (Link-Stil bleibt, kein Monospace). Code-Spans und Code-Fences bleiben unangetastet
// (dort ist der Text ohnehin verbatim; ein Escape wuerde die Backslashes sichtbar machen).
// Echtes Markdown ausserhalb von Pfaden (z. B. **fett**, _kursiv_) bleibt ebenfalls unberuehrt.

// Alle ASCII-Satzzeichen (= die von CommonMark escapebare Menge): 0x21-0x2F, 0x3A-0x40,
// 0x5B-0x60, 0x7B-0x7E. Hex-Notation, damit die Zeichenklasse lint-/lesefreundlich bleibt.
const ESCAPABLE = /[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/g;

// Windows-Pfad-Token (wie remarkLocalPaths): echtes Laufwerk am Wort-/Zeilenanfang (kein
// URL-Schema dank Lookbehind + (?!/)) oder UNC-Pfad. Bis zum ersten Whitespace/Trennzeichen.
const PATH_RE = /(?:(?<![A-Za-z])[a-zA-Z]:[\\/](?!\/)[^\s<>"'\x60)\]]+|\\\\[^\s<>"'\x60)\]]+)/g;

// Code-Region: Fence (``` ... ``` / ~~~ ... ~~~) oder Inline-Code (`...`, ``...``). Wird verbatim
// uebernommen, nicht angefasst. Backreference \1 bindet die genaue Backtick-Laenge des Inline-Spans.
const CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|(`+)[\s\S]*?\1/g;

function escapePathToken(token: string): string {
  return token.replace(ESCAPABLE, (c) => '\\' + c);
}

function protectOutsideCode(text: string): string {
  return text.replace(PATH_RE, (m) => escapePathToken(m));
}

/**
 * Escapet Windows-Pfade ausserhalb von Code so, dass Markdown sie verbatim rendert.
 * Idempotenz ist nicht garantiert (doppelt angewandt wuerden Escapes sichtbar) -> genau einmal
 * direkt vor ReactMarkdown anwenden.
 */
export function protectWindowsPaths(content: string): string {
  if (!content) return content;
  // Schneller Ausstieg: ohne Backslash und ohne "Laufwerk:/" gibt es keinen gefaehrdeten Pfad.
  if (content.indexOf('\\') === -1 && !/[A-Za-z]:\//.test(content)) return content;

  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(content)) !== null) {
    out += protectOutsideCode(content.slice(last, m.index));
    out += m[0]; // Code-Region unveraendert uebernehmen
    last = m.index + m[0].length;
  }
  out += protectOutsideCode(content.slice(last));
  return out;
}
