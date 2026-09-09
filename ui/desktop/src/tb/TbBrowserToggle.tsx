// TB-Software: Bottom-Bar-Button, der den eingebetteten Browser im rechten
// Vorschau-Panel oeffnet (bzw. schliesst, wenn er bereits offen ist).
import React from 'react';
import { Globe } from 'lucide-react';
import { usePreview } from './preview/PreviewContext';
import { cn } from '../utils';

export const TbBrowserToggle: React.FC = () => {
  const preview = usePreview();
  if (!preview) return null;

  const open = preview.browserUrl != null;

  return (
    <button
      onClick={() => (open ? preview.close() : preview.openBrowser())}
      title={
        open
          ? 'Browser-Panel schließen'
          : 'Browser im rechten Panel öffnen (surfen; vom Agenten steuerbar)'
      }
      className={cn(
        'flex items-center gap-1 text-xs rounded px-1.5 py-1 transition-colors',
        open
          ? 'text-text-accent bg-background-tertiary'
          : 'text-text-secondary hover:bg-background-tertiary'
      )}
    >
      <Globe className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Browser</span>
    </button>
  );
};
