// TB-Software: Bottom-Bar-Anzeige + Umschalter für den Werkzeug-Modus (GOOSE_TOOLSHIM).
// "Kompatibel" (Toolshim AN) = Werkzeug-Aufrufe werden aus TEXT geparst — nötig für
// Modelle OHNE native Werkzeuge (z. B. auto:chat). "Nativ" (Toolshim AUS) = native
// tool_calls, zuverlässiger, für tool-fähige Modelle (z. B. auto:code).
//
// Milestone [11]/Guard: Der Umschalter ist jetzt MODELL-BEWUSST. Die Kombination
// auto:code + Kompatibel ist bekannt kaputt (Tool-Aufrufe bleiben als roher Text stehen,
// weil der Toolshim einen lokalen Ollama-Interpreter bräuchte, der am Anwender-PC fehlt).
// Deshalb: (1) beim Modellwechsel wird der passende Modus automatisch gesetzt, (2) eine
// falsche Kombi wird rot gewarnt und per Klick sofort korrigiert.
import React, { useEffect, useRef } from 'react';
import { Wrench, AlertTriangle } from 'lucide-react';
import { useConfig } from '../components/ConfigContext';
import { cn } from '../utils';
import { isToolModeMismatch, recommendedToolshim } from './toolMode';

export const TbToolshimToggle: React.FC<{ model?: string | null }> = ({ model }) => {
  const { config, upsert } = useConfig();
  const raw = config?.GOOSE_TOOLSHIM;
  const enabled = raw === true || String(raw).toLowerCase() === 'true';
  const mismatch = isToolModeMismatch(model, enabled);

  // Passenden Modus automatisch setzen: beim ersten bekannten Modell (heilt eine gespeicherte
  // kaputte Kombi, z. B. auto:code + Kompatibel) UND bei jedem echten Modellwechsel. Ein reines
  // Umschalten von Hand (enabled ändert sich, Modell bleibt) korrigiert NICHT automatisch — es
  // bleibt (rot gewarnt) bestehen, damit ein bewusster Override möglich ist.
  const lastModel = useRef<string | null | undefined>(undefined);
  const initialized = useRef(false);
  useEffect(() => {
    if (!model) return; // Modell noch nicht geladen — warten.
    const modelChanged = lastModel.current !== model;
    if (!initialized.current || modelChanged) {
      initialized.current = true;
      lastModel.current = model;
      const rec = recommendedToolshim(model);
      if (rec !== enabled) {
        void upsert('GOOSE_TOOLSHIM', rec, false).catch((e) =>
          console.error('Auto-Kopplung GOOSE_TOOLSHIM fehlgeschlagen', e)
        );
      }
    }
  }, [model, enabled, upsert]);

  const onClick = async () => {
    // Bei falscher Kombi korrigiert der Klick auf den empfohlenen Modus; sonst normal umschalten.
    const next = mismatch ? recommendedToolshim(model) : !enabled;
    try {
      await upsert('GOOSE_TOOLSHIM', next, false);
    } catch (e) {
      console.error('Failed to toggle GOOSE_TOOLSHIM', e);
    }
  };

  const title = mismatch
    ? recommendedToolshim(model)
      ? `⚠ ${model} braucht „Kompatibel" — im Modus „Nativ" führt es keine Werkzeuge aus. Klick zum Beheben.`
      : `⚠ ${model} braucht „Nativ" — im Modus „Kompatibel" bleiben Werkzeug-Aufrufe als Text stehen (kein lokaler Ollama-Interpreter). Klick zum Beheben.`
    : enabled
      ? 'Werkzeug-Modus: KOMPATIBEL — Werkzeuge laufen über Text-Parsing, für Modelle ohne native Werkzeuge (z. B. auto:chat). Klick für Nativ.'
      : 'Werkzeug-Modus: NATIV — schnelle native Werkzeug-Aufrufe (z. B. auto:code). Klick für Kompatibel.';

  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors no-drag',
        mismatch
          ? 'bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25'
          : enabled
            ? 'bg-background-tertiary text-text-primary'
            : 'text-text-secondary hover:bg-background-tertiary/60'
      )}
    >
      {mismatch ? (
        <AlertTriangle className="w-3.5 h-3.5" />
      ) : (
        <Wrench className={cn('w-3.5 h-3.5', enabled && 'text-green-500')} />
      )}
      <span>Tools: {enabled ? 'Kompatibel' : 'Nativ'}</span>
    </button>
  );
};
