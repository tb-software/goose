// TB-Software: Kopplung Modell ↔ Werkzeug-Modus.
//
// Hintergrund (verifiziert am Backend crates/goose/src/providers/toolshim.rs + Proxy-Tests 2026-09-24):
//   - "Nativ" (GOOSE_TOOLSHIM=false) = native tool_calls. Der gericom-Proxy liefert diese für ALLE
//     auto:*-Routen ZUVERLÄSSIG (auto:code UND auto:chat = Qwen3.6, beide tool-fähig). Kein Ollama nötig.
//   - "Kompatibel" (GOOSE_TOOLSHIM=true) = Tool-Aufrufe werden aus TEXT geparst; greift kein lokaler
//     Parser, geht der Text an einen lokalen Ollama-Interpreter (localhost:11434). Fehlt der (Normalfall
//     am Anwender-PC), bleibt der Tool-Aufruf als roher Text stehen und wird NICHT ausgeführt.
//
// STAND 2026-09-24: Früher war auto:chat = Mistral-24B OHNE tool-Rolle und brauchte darum "Kompatibel".
// NEU ist auto:chat = Qwen3.6 MIT nativen Werkzeugen. Damit braucht KEIN Modell mehr den Toolshim — die
// alte Zwangskopplung (auto:chat -> Kompatibel) war der Auslöser für „Tool-Call als Text, führt nichts
// aus". Deshalb: Empfehlung immer "Nativ". "Kompatibel" bleibt manuell wählbar (für lokale Ollama-Setups),
// wird aber nie mehr automatisch erzwungen und als Fehl-Kombi gewarnt.

/** Modelle, die KEINE nativen tool_calls können und daher den Toolshim (Kompatibel) bräuchten.
 *  Bei der aktuellen gericom-Routung trifft das auf KEIN Modell mehr zu (auto:chat = Qwen3.6, tool-fähig). */
export function modelNeedsToolshim(_model: string | null | undefined): boolean {
  return false;
}

/** Der für dieses Modell empfohlene Toolshim-Zustand (true = Kompatibel, false = Nativ). Immer Nativ. */
export function recommendedToolshim(model: string | null | undefined): boolean {
  return modelNeedsToolshim(model);
}

/** true, wenn die aktuelle Kombination Modell×Modus bekannt kaputt ist (Tools laufen nicht).
 *  Da Nativ immer empfohlen ist, ist jede aktivierte „Kompatibel"-Einstellung eine Fehl-Kombi. */
export function isToolModeMismatch(
  model: string | null | undefined,
  toolshimEnabled: boolean
): boolean {
  return recommendedToolshim(model) !== toolshimEnabled;
}
