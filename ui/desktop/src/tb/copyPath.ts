// TB-Software: absoluten Pfad in die Zwischenablage kopieren (mit Toast + Fallback).
// Wird überall genutzt, wo ein Pfad angezeigt wird (Chat-Pfad-Links, Vorschau-Kopf),
// damit der Nutzer jeden Pfad zuverlässig als ABSOLUTEN Pfad übernehmen kann.
import { toast } from 'react-toastify';
import { matchWindowsPaths } from './windowsPath';

// Generischer Clipboard-Helfer (Pfad ODER Inhalt) mit Toast + execCommand-Fallback.
export async function copyText(
  text: string | null | undefined,
  label = 'Kopiert'
): Promise<void> {
  const value = (text ?? '').trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label, { autoClose: 1200 });
    return;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast.success(label, { autoClose: 1200 });
      return;
    } catch {
      toast.error('Kopieren fehlgeschlagen');
    }
  }
}

// Unix-Pfad (/foo/bar). Windows/UNC laufen ueber matchWindowsPaths (unterstuetzt Leerzeichen).
const UNIX_PATH_RE = /\/[^\s"'<>|)\]]{2,}\/[^\s"'<>|)\]]*/g;

// Pfad-Erkennung (geteilt von Chat- und globalem Kontextmenue): Windows (C:\..., auch mit
// Leerzeichen), UNC (\\server\...), Unix (/foo/bar). Nimmt den laengsten Treffer.
export function extractPath(text: string): string | null {
  const candidates: string[] = [];
  for (const { value } of matchWindowsPaths(text)) candidates.push(value);
  const unix = text.match(UNIX_PATH_RE);
  if (unix) for (const u of unix) candidates.push(u.replace(/[.,;:!?]+$/, ''));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.length - a.length)[0];
}

// TB-Software: Kopiert den AUFGELOESTEN (laengsten existierenden) Pfad. Ein im Chat genannter Pfad
// kann Fliesstext-Ueberhang haben oder am Leerzeichen zu lang gefasst sein; tb-resolve-file schneidet
// ihn serverseitig auf den echten Pfad zurueck. Faellt auf den Rohpfad zurueck, wenn nicht aufloesbar.
export async function copyResolvedPath(raw: string | null | undefined): Promise<void> {
  const value = (raw ?? '').trim();
  if (!value) return;
  let target = value;
  try {
    const api = (
      window as unknown as {
        electron?: { tbResolveFile?: (x: string) => Promise<{ ok?: boolean; path?: string }> };
      }
    ).electron;
    const r = await api?.tbResolveFile?.(value);
    if (r?.ok && r.path) target = r.path;
  } catch {
    /* mit dem Rohpfad kopieren */
  }
  await copyAbsolutePath(target);
}

export async function copyAbsolutePath(path: string | null | undefined): Promise<void> {
  const value = (path ?? '').trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast.success('Pfad kopiert', { autoClose: 1200 });
    return;
  } catch {
    // Fallback, falls die Clipboard-API blockiert ist (Fokus/Berechtigung).
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast.success('Pfad kopiert', { autoClose: 1200 });
      return;
    } catch {
      toast.error('Kopieren fehlgeschlagen');
    }
  }
}
