// TB-Software: Kern der Datei-Aufloesung fuer im Chat genannte Pfade. Bewusst REIN und testbar
// (keine Electron-/window-Abhaengigkeit), damit die Pfad-Logik VOR jedem Deploy mit vitest gegen
// alle Basis-Pfad-Formen geprueft werden kann (Vorgabe Timo 30.10.: "egal wie der Basis-Pfad
// aussieht, muss das funktional werden").
//
// Reihenfolge der Aufloesung:
//   1. Absoluter, existierender Pfad          -> 'exists'
//   2. Relativ/Name gegen die Arbeitsverzeichnis-Wurzel -> 'resolved'
//   3. Exakter Basisname irgendwo unter der Wurzel      -> 'found'
//   4. sonst -> 'missing' (bzw. 'empty' / 'no-working-dir')
// Slash-Richtung ist egal; ein fuehrendes "./" oder "/" am relativen Teil wird entfernt.

import nodePath from 'node:path';
import fsp from 'node:fs/promises';

// Typ der plattformspezifischen Pfad-API (node:path exportiert PlatformPath nicht als benannten Typ).
type PathApi = typeof nodePath.win32;

// Ordner, die die gebuendelte Dateisuche ueberspringt (Build-/Abhaengigkeitsmuell). Geteilt zwischen
// der Volltext-Suche (tb-search) und der exakten Basisnamen-Suche (findExactBasenameUnder).
export const WORKSPACE_SEARCH_IGNORE_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'dist', 'build', 'out', '.next',
  'target', '.cache', '__pycache__', '.idea', '.vs', 'bin', 'obj',
]);

export type ResolveReason =
  | 'empty'
  | 'no-working-dir'
  | 'exists'
  | 'resolved'
  | 'found'
  | 'missing';

export interface ResolveResult {
  ok: boolean;
  path: string | null;
  reason: ResolveReason;
}

export interface ResolveDeps {
  /** true, wenn an diesem absoluten Pfad eine Datei ODER ein Ordner existiert. */
  exists: (absPath: string) => Promise<boolean>;
  /** exakter Basisname (case-insensitiv) unter root; kuerzester rel. Pfad gewinnt; sonst null. */
  findByBasename: (root: string, basename: string) => Promise<string | null>;
  /** Pfad-Variante (Default: node:path der Plattform); fuer Tests path.win32 / path.posix. */
  pathApi?: PathApi;
}

// Fuehrende "./", ".\", "/", "\" (auch mehrfach) am relativen Teil entfernen, damit ein vom
// Modell genanntes "/datei.md" oder "./unterordner/datei.md" relativ zur Wurzel aufgeloest wird.
function stripLeadingRel(s: string): string {
  return s.replace(/^(?:\.?[\\/]+)+/, '');
}

// true, wenn child innerhalb von parent liegt (gleicher Ordner oder darunter). Verhindert, dass ein
// relativer Pfad mit ".." aus dem Arbeitsverzeichnis ausbricht (Defense-in-Depth, analog resolveChatPath).
function isWithin(p: PathApi, parent: string, child: string): boolean {
  const rel = p.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

export async function resolveWorkspaceFile(
  raw: string,
  workingDir: string | null | undefined,
  deps: ResolveDeps
): Promise<ResolveResult> {
  const p = deps.pathApi ?? nodePath;
  const s = (raw ?? '').trim();
  if (!s) return { ok: false, path: null, reason: 'empty' };

  const wd = (workingDir ?? '').trim() || null;

  // Auf win32 gilt ein fuehrender EINZELNER Slash ohne Laufwerk/UNC als wurzel-relativ (der Nutzer
  // meint das Arbeitsverzeichnis), NICHT als absolut. Nur "C:\..." und "\\server\..." sind absolut.
  // Auf posix ist ein fuehrender "/" absolut.
  const isPosix = p.sep === '/';
  const absolute = isPosix
    ? p.isAbsolute(s)
    : /^[a-zA-Z]:[\\/]/.test(s) || /^[\\/]{2}/.test(s);

  if (absolute) {
    if (await deps.exists(s)) {
      return { ok: true, path: p.normalize(s), reason: 'exists' };
    }
    // Existiert nicht: evtl. liegt der Basisname trotzdem unter der Wurzel -> Schritt 3.
  } else {
    if (!wd) return { ok: false, path: null, reason: 'no-working-dir' };
    const candidate = p.resolve(wd, stripLeadingRel(s));
    // Nur innerhalb des Arbeitsverzeichnisses aufloesen (kein ".."-Ausbruch); sonst faellt es auf die
    // Basisnamen-Suche unten zurueck, die ohnehin nur unter der Wurzel sucht.
    if (isWithin(p, wd, candidate) && (await deps.exists(candidate))) {
      return { ok: true, path: candidate, reason: 'resolved' };
    }
  }

  if (!wd) return { ok: false, path: null, reason: 'missing' };

  const basename = p.basename(s.replace(/[\\/]+$/, ''));
  if (basename) {
    const hit = await deps.findByBasename(wd, basename);
    if (hit) return { ok: true, path: hit, reason: 'found' };
  }

  return { ok: false, path: null, reason: 'missing' };
}

// TB-Software: begrenzte Tiefensuche nach einem EXAKTEN Basisnamen (case-insensitiv) unter root.
// Bevorzugt den kuerzesten relativen Pfad (am naechsten an der Wurzel). Gedeckelt auf Eintraege/Zeit,
// damit ein grosses Arbeitsverzeichnis die Aufloesung nicht haengen laesst. Reale fs-Umsetzung der
// `findByBasename`-Abhaengigkeit oben.
export async function findExactBasenameUnder(
  root: string,
  basename: string,
  opts?: { maxEntries?: number; timeoutMs?: number }
): Promise<string | null> {
  const target = basename.toLowerCase();
  const maxEntries = opts?.maxEntries ?? 200000;
  const deadline = Date.now() + (opts?.timeoutMs ?? 8000);
  let entries = 0;
  let best: string | null = null;
  let bestRelLen = Infinity;

  const walk = async (dir: string): Promise<void> => {
    if (entries >= maxEntries || Date.now() > deadline) return;
    let dh: import('node:fs').Dirent[];
    try {
      dh = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dh) {
      if (entries >= maxEntries || Date.now() > deadline) return;
      entries++;
      if (d.isDirectory()) {
        if (WORKSPACE_SEARCH_IGNORE_DIRS.has(d.name) || d.name.startsWith('.')) continue;
        await walk(nodePath.join(dir, d.name));
      } else if (d.isFile() && d.name.toLowerCase() === target) {
        const full = nodePath.join(dir, d.name);
        const relLen = nodePath.relative(root, full).length;
        if (relLen < bestRelLen) {
          bestRelLen = relLen;
          best = full;
        }
      }
    }
  };

  try {
    await walk(root);
  } catch {
    /* defensiv: Teilergebnis liefern */
  }
  return best;
}
