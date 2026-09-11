// TB-Software (Milestone [10]): Bündelt aufeinanderfolgende Werkzeug-/Prompt-Schritte zu EINER
// dezenten, ausklappbaren „Aktivität" im Konsolen-Stil (Consolas, klein). Eingeklappt: 1 Zeile
// mit generiertem Titel + Anzahl. Ausgeklappt: die Einzelschritte als eingerückter Baum.
import React, { useState } from 'react';
import { ChevronRight, ChevronDown, TerminalSquare } from 'lucide-react';

const MONO = "'Consolas','Cascadia Mono','Cascadia Code',ui-monospace,'Courier New',monospace";

export default function ActivityTree({
  count,
  title,
  defaultOpen = false,
  children,
}: {
  count: number;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="my-1 rounded-md border border-borderSubtle bg-background-secondary/40 overflow-hidden"
      style={{ fontFamily: MONO }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary hover:bg-background-tertiary/40 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 flex-shrink-0" />
        )}
        <TerminalSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
        <span className="font-semibold tabular-nums">{count}</span>
        <span className="opacity-70">Schritte</span>
        <span className="text-text-tertiary truncate">· {title}</span>
      </button>
      {open && (
        <div
          className="border-t border-borderSubtle pl-2 pr-1 py-1"
          style={{ fontSize: 12.5, lineHeight: 1.35, borderLeft: '2px solid var(--borderSubtle, #3f3f46)' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
