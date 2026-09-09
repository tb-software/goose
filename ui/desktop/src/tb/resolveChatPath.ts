// TB-Software: Die KI nennt Dateien im Chat meist als BLOSSEN Dateinamen bzw.
// relativen Pfad (in Backticks), z. B. `zahlen_worte.txt` oder `unterordner/report.md`
// — ohne Laufwerk/Verzeichnis. toLocalFsPath erkennt nur ABSOLUTE Pfade, daher waren
// solche Dateinamen nicht klickbar (keine Vorschau). Dieser Resolver loest einen
// bloßen Dateinamen / relativen Pfad gegen das Arbeitsverzeichnis des Chats auf und
// liefert einen absoluten lokalen FS-Pfad zurueck — sonst null.
//
// Bewusst konservativ (nur eindeutige Datei-Referenzen), damit normaler Fliesstext
// mit Punkten ("z. B.", Versionsnummern) NICHT faelschlich zu Links wird:
//   - muss auf eine Datei-Endung MIT Buchstaben enden (.pdf/.md/.7z, aber nicht .3/.00)
//     -> Dateinamen mit Leerzeichen ("Mein Report.pdf") bleiben klickbar
//   - keine URL (kein "://"), keine Zeilenumbrueche, keine illegalen Windows-Zeichen
//   - kein ".." (Ausbruch aus dem Arbeitsverzeichnis wird verhindert)
import { toLocalFsPath } from './localPath';

const ILLEGAL = /[<>:"|?*\r\n]/; // ':' ist in relativen Namen unzulaessig (Laufwerk faengt toLocalFsPath ab)
// Muss auf eine Datei-Endung enden, die MINDESTENS EINEN Buchstaben enthaelt. So bleiben
// Dateinamen mit Leerzeichen ("Mein Report.pdf") klickbar, waehrend Prosa mit Versionsnummern
// ("version 1.2.3", "Preis 5.00") NICHT faelschlich als Datei erkannt wird.
const HAS_EXT = /\.(?=[A-Za-z0-9]{1,12}$)[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/;

export function resolveChatPath(raw: string, workingDir?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Bereits ein absoluter lokaler Pfad? -> direkt uebernehmen.
  const abs = toLocalFsPath(s);
  if (abs) return abs;

  if (!workingDir) return null;
  if (/:\/\//.test(s)) return null; // URL (http://, file://, ...)
  if (ILLEGAL.test(s)) return null; // '<>:"|?*' oder Zeilenumbruch -> kein Dateiname

  // Fuehrendes ./ oder .\ entfernen; Vorwaerts-Slashes zu Backslashes.
  const rel = s.replace(/^\.[\\/]/, '').replace(/\//g, '\\');
  if (!rel || rel.startsWith('\\')) return null; // absolute UNC/Root faengt toLocalFsPath ab
  if (rel.split('\\').some((seg) => seg === '..' || seg === '')) return null; // kein Ausbruch, keine Leersegmente
  if (!HAS_EXT.test(rel)) return null; // muss auf eine Datei-Endung enden

  // Arbeitsverzeichnis ebenfalls auf Backslashes normalisieren (kann mit Vorwaerts-
  // Slashes kommen), sonst entstehen gemischte Separatoren (C:/work\datei.txt).
  const dir = workingDir.replace(/\//g, '\\').replace(/\\+$/, '');
  return `${dir}\\${rel}`;
}
