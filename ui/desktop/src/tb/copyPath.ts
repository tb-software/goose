// TB-Software: absoluten Pfad in die Zwischenablage kopieren (mit Toast + Fallback).
// Wird überall genutzt, wo ein Pfad angezeigt wird (Chat-Pfad-Links, Vorschau-Kopf),
// damit der Nutzer jeden Pfad zuverlässig als ABSOLUTEN Pfad übernehmen kann.
import { toast } from 'react-toastify';

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
