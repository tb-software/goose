// TB-Software: Fallback, wenn ein im Chat genannter BLOSSER Dateiname nicht direkt am
// Arbeitsverzeichnis liegt (das Modell nennt oft nur "flash_backup.py", die Datei liegt
// aber in einem Unterordner). Sucht den exakten Dateinamen (gebuendelt, ueberspringt
// node_modules/.git/target usw.) unter dem Arbeitsverzeichnis und liefert den besten Treffer.
// Bevorzugt den exakten Namen und davon den kuerzesten relativen Pfad (am naechsten an der Wurzel).
export async function findFileByName(
  workingDir: string | undefined | null,
  basename: string
): Promise<string | null> {
  const dir = (workingDir ?? '').trim();
  const name = (basename ?? '').trim();
  if (!dir || !name) return null;
  try {
    const r = await window.electron.tbSearch([dir], name);
    if (!r?.ok || !Array.isArray(r.results) || r.results.length === 0) return null;
    const target = name.toLowerCase();
    const exact = r.results.filter((m) => m.name.toLowerCase() === target);
    const pool = exact.length > 0 ? exact : r.results;
    pool.sort((a, b) => (a.rel?.length ?? Infinity) - (b.rel?.length ?? Infinity));
    return pool[0]?.path ?? null;
  } catch {
    return null;
  }
}
