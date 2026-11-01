// TB-Software: Umlaut-Gate. Prueft die frontend-sichtbaren deutschen Strings auf ASCII-
// Transliterationen (ae/oe/ue statt ä/ö/ü) und auf Eszett (ß). Vor jedem Ausliefern laufen lassen:
//   node tools/tb-umlaut-gate.mjs
// Exit 0 = sauber, 1 = Verstoss gefunden. Geprueft werden String-Literale in src/tb/**/*.{ts,tsx}
// (ohne *.test.*) und die gebuendelte goosehints-Datei. Kommentarzeilen werden uebersprungen
// (eigener Aufraeum-Punkt). Scope bewusst eng gehalten, um Fehlalarme gering zu halten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..'); // ui/desktop

// Legitime Nicht-Umlaut-Woerter mit ae/oe/ue (bleiben erlaubt). Kleingeschrieben verglichen.
const ALLOW = new Set([
  'neue', 'neuer', 'neues', 'neuem', 'neuen', 'quelle', 'quellen', 'zuerst', 'steuer', 'steuert',
  'steuern', 'steuerung', 'steuerbar', 'dauer', 'dauern', 'dauerhaft', 'dauerhafte', 'dauerhaften',
  'manuell', 'manueller', 'manuelle', 'aktuell', 'aktuelle', 'aktuelles', 'aktuellen', 'aktueller',
  'individuell', 'individuelle', 'feuer', 'feuern', 'frauen', 'bequem', 'bequeme', 'bequemen',
  'koexistieren', 'treue', 'scheue', 'neugier', 'abenteuer', 'dauert', 'dauernd',
  // englische/Code-Begriffe, die in deutschen UI-Texten vorkommen duerfen
  'queue', 'queued', 'value', 'values', 'issue', 'issues', 'true', 'false', 'blue', 'due', 'continue',
  'argue', 'unique', 'league', 'rescue', 'cue', 'dequeue', 'overdue', 'query', 'request', 'requests',
  'silentlycontinue', 'quellcode', 'quellcodes',
  // bewusste Code-Bezeichner/Werte (kein user-facing Text): Transliterations-Funktion,
  // Rollen-IDs (ASCII-Identifier), Stimmen-Heuristik (matcht OS-Namen).
  'ae', 'oe', 'ue', 'vollstaendigkeit', 'faktenpruefer', 'maennlich',
]);

// Ein Wort, das ae/oe/ue enthaelt und NICHT in der Allowlist steht, gilt als verdaechtig.
const WORD = /[A-Za-zÄÖÜäöü]*(?:ue|oe|ae)[A-Za-zÄÖÜäöü]*/g;
// String-Literale grob: '...', "...", `...` (ohne perfekte Escape-Behandlung - fuer die Pruefung genuegt es).
const STRINGS = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function checkContent(file, text, opts = {}) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    const segments = opts.wholeLine ? [line] : (line.match(STRINGS) || []);
    for (const seg of segments) {
      if (!opts.wholeLine && isComment) continue; // Kommentarzeilen ueberspringen (eigener Aufraeum-Punkt)
      // Eszett ist nie legitim -> immer melden.
      if (/ß/.test(seg)) findings.push({ line: i + 1, word: 'ß (Eszett)', text: line.trim().slice(0, 100) });
      // Em-/En-Dash (Gedankenstrich) ist nie erlaubt -> immer melden.
      if (/[–—]/.test(seg)) findings.push({ line: i + 1, word: '— / – (Gedankenstrich)', text: line.trim().slice(0, 100) });
      // Template-Interpolationen ${...} sind Code -> entfernen, damit Variablennamen nicht anschlagen.
      let inner = opts.wholeLine ? seg : seg.slice(1, -1);
      inner = inner.replace(/\$\{[^}]*\}/g, ' ');
      if (!opts.wholeLine) {
        const hasSpace = /\s/.test(inner);
        // Einzel-Token nur pruefen, wenn es ein schlichtes Wort ist (keine Ziffern/-/_ und kein
        // camelCase) -> faengt Label-Woerter wie "Groesse"/"Laeuft", ueberspringt Bezeichner.
        const plainWord = /^[A-Za-zÄÖÜäöü]+$/.test(inner.trim()) && !/[a-z][A-Z]/.test(inner.trim());
        if (!hasSpace && !plainWord) continue;
      }
      const words = inner.match(WORD) || [];
      for (const w of words) {
        if (!ALLOW.has(w.toLowerCase())) {
          findings.push({ line: i + 1, word: w, text: line.trim().slice(0, 100) });
        }
      }
    }
  }
  return findings.map((f) => ({ file, ...f }));
}

const targets = [];
const tbDir = path.join(DESKTOP, 'src', 'tb');
if (fs.existsSync(tbDir)) for (const f of listFiles(tbDir)) targets.push({ file: f, wholeLine: false });
const hints = path.join(DESKTOP, 'src', 'tb-defaults', 'goosehints');
if (fs.existsSync(hints)) targets.push({ file: hints, wholeLine: true });

let all = [];
for (const t of targets) {
  const text = fs.readFileSync(t.file, 'utf8');
  all.push(...checkContent(t.file, text, { wholeLine: t.wholeLine }));
}

if (all.length === 0) {
  console.log('[umlaut-gate] OK - keine Transliterationen/Eszett in frontend-sichtbaren Strings.');
  process.exit(0);
}
console.error(`[umlaut-gate] ${all.length} Verstoss/Verstoesse gefunden:`);
for (const f of all) {
  console.error(`  ${path.relative(DESKTOP, f.file)}:${f.line}  "${f.word}"  -> ${f.text}`);
}
console.error('Bitte echte Umlaute (ä ö ü) bzw. ss statt Eszett verwenden. Legitime Woerter in die ALLOW-Liste aufnehmen.');
process.exit(1);
