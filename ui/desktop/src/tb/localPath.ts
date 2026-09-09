// TB-Software: Erkennung lokaler Datei-Pfade in Chat-Links, damit ein Klick die
// Datei im Explorer MARKIERT (explorer /select) statt sie im Browser zu oeffnen.
// Windows-fokussiert (Zielumgebung); fuer einen spaeteren Upstream-PR muesste
// dies zu einem plattformneutralen "reveal in file manager" verallgemeinert werden.

/**
 * file://-URL oder absoluter Windows-/UNC-Pfad -> normalisierter FS-Pfad.
 * Gibt null zurueck, wenn href KEIN lokaler Dateipfad ist (dann normal im Browser oeffnen).
 */
export function toLocalFsPath(href: string): string | null {
  if (!href) return null;

  // file:// URL
  if (/^file:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      let p = decodeURIComponent(u.pathname);
      if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1); // "/C:/x" -> "C:/x"
      return p.replace(/\//g, '\\');
    } catch {
      return null;
    }
  }

  // Windows-Laufwerkspfad: C:\... oder C:/...
  if (/^[a-zA-Z]:[\\/]/.test(href)) return href.replace(/\//g, '\\');

  // UNC-Pfad: \\server\share\...
  if (/^\\\\[^\\]/.test(href)) return href;

  return null;
}
