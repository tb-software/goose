// TB-Software: Kopplung Modell ↔ Werkzeug-Modus.
//
// Hintergrund (verifiziert am Backend crates/goose/src/providers/toolshim.rs):
//   - "Nativ" (GOOSE_TOOLSHIM=false) = native tool_calls. auto:code liefert die über den Proxy
//     ZUVERLÄSSIG. Kein Ollama nötig.
//   - "Kompatibel" (GOOSE_TOOLSHIM=true) = Tool-Aufrufe werden aus TEXT geparst. Greift kein
//     lokaler Parser, geht der Text an einen lokalen Ollama-Interpreter (mistral-nemo,
//     localhost:11434). Ist der nicht installiert (Normalfall am Anwender-PC), bleibt der
//     Tool-Aufruf als roher Text stehen und wird NICHT ausgeführt.
//
// Regel: Nur Modelle OHNE native Werkzeuge brauchen "Kompatibel". Bei uns ist das auto:chat
// (mistral-small-Template kann keine tool-Rolle). Alles andere — insbesondere der Default
// auto:code — läuft nativ. Darum ist die einzige sinnvolle Kopplung:
//   auto:chat  -> Kompatibel (Toolshim an)
//   sonst      -> Nativ (Toolshim aus)

/** Modelle, die KEINE nativen tool_calls können und daher den Toolshim (Kompatibel) brauchen. */
export function modelNeedsToolshim(model: string | null | undefined): boolean {
  if (!model) return false;
  return model.trim().toLowerCase().startsWith('auto:chat');
}

/** Der für dieses Modell empfohlene Toolshim-Zustand (true = Kompatibel, false = Nativ). */
export function recommendedToolshim(model: string | null | undefined): boolean {
  return modelNeedsToolshim(model);
}

/** true, wenn die aktuelle Kombination Modell×Modus bekannt kaputt ist (Tools laufen nicht). */
export function isToolModeMismatch(
  model: string | null | undefined,
  toolshimEnabled: boolean
): boolean {
  return recommendedToolshim(model) !== toolshimEnabled;
}
