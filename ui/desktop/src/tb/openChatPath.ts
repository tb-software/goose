// TB-Software: Oeffnet einen im Chat genannten Pfad in der Vorschau - aber VERIFIZIERT den Pfad
// zuerst ueber den Main-Prozess (tb-resolve-file). Fruher gab der synchrone resolveChatPath nur
// eine VERMUTUNG (Arbeitsverzeichnis + relativer Name); stimmte die nicht (Datei liegt tiefer, der
// Basis-Pfad weicht ab, Fliesstext-Ueberhang), oeffnete die Vorschau einen nicht existierenden Pfad
// und meldete "Datei nicht gefunden". Der Main-Resolver prueft existiert -> relativ aufgeloest ->
// exakter Basisname unter der Wurzel und liefert den echten absoluten Pfad.
import { previewKindFor } from './preview/previewKind';
import { resolveChatPath } from './resolveChatPath';
import { revealLocalPath } from './revealPath';

type PreviewLike = { open: (p: string) => void } | null | undefined;

// Verifizierter absoluter Pfad fuer eine im Chat genannte Datei. Erst der Main-Prozess-Resolver
// (kennt die kanonische Workdir je Fenster, prueft das Dateisystem), sonst die synchrone Vermutung.
export async function resolveChatPathVerified(
  raw: string,
  workingDir?: string | null
): Promise<string | null> {
  try {
    const r = await window.electron.tbResolveFile?.(raw);
    if (r?.ok && r.path) return r.path;
  } catch {
    /* offline / kein IPC -> synchrone Vermutung unten */
  }
  return resolveChatPath(raw, workingDir);
}

// Oeffnet den Pfad: vorschaubar -> rechtes Panel, sonst im Explorer markieren.
export async function openChatPath(
  preview: PreviewLike,
  raw: string,
  workingDir?: string | null
): Promise<void> {
  const target = await resolveChatPathVerified(raw, workingDir);
  if (!target) return;
  if (preview && previewKindFor(target) !== 'unknown') {
    preview.open(target);
  } else {
    void revealLocalPath(target, workingDir);
  }
}

// true, wenn der Nutzer gerade Text markiert. Dann darf ein Klick auf einen Pfad-/URL-Link NICHT
// navigieren/die Vorschau oeffnen - sonst laesst sich Text, der einen Link enthaelt, nie markieren
// und kopieren (haeufige Klage: "markieren geht oft nicht").
export function hasActiveSelection(): boolean {
  try {
    const s = window.getSelection?.();
    return !!s && !s.isCollapsed && s.toString().trim().length > 0;
  } catch {
    return false;
  }
}
