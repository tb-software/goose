// TB-Software: Bottom-Bar-Anzeige + Umschalter für den Werkzeug-Modus (GOOSE_TOOLSHIM).
// "Kompatibel" (Toolshim AN) = Werkzeug-Aufrufe werden aus TEXT geparst — nötig für
// Modelle OHNE native Werkzeuge (z. B. auto:chat). "Nativ" (Toolshim AUS) = native
// tool_calls, zuverlässiger, für tool-fähige Modelle (z. B. auto:code).
import React from 'react';
import { Wrench } from 'lucide-react';
import { useConfig } from '../components/ConfigContext';
import { cn } from '../utils';

export const TbToolshimToggle: React.FC = () => {
  const { config, upsert } = useConfig();
  const raw = config?.GOOSE_TOOLSHIM;
  const enabled = raw === true || String(raw).toLowerCase() === 'true';

  const toggle = async () => {
    try {
      await upsert('GOOSE_TOOLSHIM', !enabled, false);
    } catch (e) {
      console.error('Failed to toggle GOOSE_TOOLSHIM', e);
    }
  };

  return (
    <button
      onClick={toggle}
      title={
        enabled
          ? 'Werkzeug-Modus: KOMPATIBEL — Werkzeuge laufen über Text-Parsing, für Modelle ohne native Werkzeuge (z. B. auto:chat). Klick für Nativ.'
          : 'Werkzeug-Modus: NATIV — schnelle native Werkzeug-Aufrufe (z. B. auto:code). Wenn ein Modell Werkzeuge nicht ausführt (z. B. auto:chat), hier auf Kompatibel schalten.'
      }
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors no-drag',
        enabled
          ? 'bg-background-tertiary text-text-primary'
          : 'text-text-secondary hover:bg-background-tertiary/60'
      )}
    >
      <Wrench className={cn('w-3.5 h-3.5', enabled && 'text-green-500')} />
      <span>Tools: {enabled ? 'Kompatibel' : 'Nativ'}</span>
    </button>
  );
};
