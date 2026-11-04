// TB-Software: Entdopplung der Erweiterungs-Fehlermeldungen. Eine Erweiterung (z. B. LenaX-DB,
// wenn der Cockpit-Dienst nicht laeuft) scheitert sonst JEDE Session und nagt jedes Mal oben
// rechts ("immer irgendwas nicht in Ordnung"). Wir merken uns den Fehler-Satz (sortierte Namen
// der nicht geladenen Erweiterungen) und zeigen ihn nur, wenn er NEU ist - aendert sich der Satz
// oder verbinden alle wieder, wird neu informiert.
const KEY = 'tb.extFailuresSeen.v1';

export function extFailureSignature(failedNames: string[]): string {
  return [...failedNames].map((n) => n.trim()).sort().join('|');
}

export function isExtFailureSeen(signature: string): boolean {
  if (!signature) return true;
  try {
    return localStorage.getItem(KEY) === signature;
  } catch {
    return false;
  }
}

export function markExtFailureSeen(signature: string): void {
  if (!signature) return;
  try {
    localStorage.setItem(KEY, signature);
  } catch {
    /* localStorage nicht verfuegbar - dann wird halt jede Session informiert */
  }
}

export function clearExtFailuresSeen(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignorieren */
  }
}
