// TB-Software: Bottom-Bar-Anzeige + Umschalter für GOOSE_TOOLSHIM.
// Toolshim = Tool-Aufrufe aus TEXT parsen (für Modelle ohne native tool_calls),
// statt sich auf native OpenAI tool_calls zu verlassen.
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
          ? 'Toolshim AN — Tool-Aufrufe werden aus Text geparst (für Modelle ohne native tool_calls). Klick zum Ausschalten.'
          : 'Toolshim AUS — nutzt native tool_calls. Klick zum Einschalten (Text-Tool-Parsing).'
      }
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors no-drag',
        enabled
          ? 'bg-background-tertiary text-text-primary'
          : 'text-text-secondary hover:bg-background-tertiary/60'
      )}
    >
      <Wrench className={cn('w-3.5 h-3.5', enabled && 'text-green-500')} />
      <span>Shim {enabled ? 'an' : 'aus'}</span>
    </button>
  );
};
