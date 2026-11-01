// TB-Software: einen lokalen Pfad im Explorer zeigen. Der Main-Handler unterscheidet
// Ordner (hinein oeffnen), Datei (im Elternordner markieren) und fehlend. Fehlt der Pfad,
// versuchen wir ihn (bei bekanntem Arbeitsverzeichnis) per Namenssuche in Unterordnern zu
// finden - das Modell nennt Dateien oft nur mit Namen, die Datei liegt aber tiefer. Erst
// wenn auch das scheitert, kommt eine klare Meldung statt eines stillen Desktop-Sprungs.
import { toast } from 'react-toastify';
import { baseName } from './preview/previewKind';
import { findFileByName } from './findFileByName';

export async function revealLocalPath(
  fullPath: string,
  workingDir?: string | null
): Promise<void> {
  try {
    // TB-Software: zuerst kanonisch aufloesen (Main kennt die Workdir je Fenster) - deckt blosse
    // Dateinamen / relative Pfade / Unterordner ab, egal wie der Basis-Pfad aussieht.
    let target = fullPath;
    try {
      const r = await window.electron.tbResolveFile?.(fullPath);
      if (r?.ok && r.path) target = r.path;
    } catch {
      /* ignorieren - mit dem Rohpfad weiterversuchen */
    }
    const res = await window.electron.showItemInFolder(target);
    if (res?.ok) return;
    if (res?.kind === 'missing') {
      const found = await findFileByName(workingDir, baseName(fullPath));
      if (found) {
        const r2 = await window.electron.showItemInFolder(found);
        if (r2?.ok) return;
      }
      toast.error(`Pfad existiert nicht: ${baseName(fullPath)}`, { autoClose: 2500 });
      return;
    }
    toast.error('Konnte nicht im Explorer öffnen', { autoClose: 2000 });
  } catch {
    toast.error('Konnte nicht im Explorer öffnen', { autoClose: 2000 });
  }
}
