import React, { useState } from 'react';
import type { Message, SystemNotificationContent } from '../../types/message';

interface SystemNotificationInlineProps {
  notification: SystemNotificationContent;
}

// Ab dieser Laenge (oder bei Mehrzeiligkeit) wird statt der kompletten Meldung nur die
// Kernaussage gezeigt, der Rest ist aufklappbar.
const LONG_THRESHOLD = 160;

// Heuristik, ob die Meldung ein Fehler ist (dann dezent rot statt grau). Deckt deutsche und
// englische Formulierungen sowie HTTP-4xx/5xx ab.
const ERROR_RE =
  /(fehler|error|failed|failure|exception|refused|timed? ?out|unauthoriz|forbidden|not found|\b[45]\d\d\b)/i;

// TB-Software: Backend-/Proxy-Statusmeldungen landen hier. Fehlermeldungen kommen transparent
// (inkl. aufgeloestem Flotten-Modell) vom /proxy - das soll lesbar BLEIBEN, aber nicht den Chat mit
// einem Wall-of-Text zukleistern. Darum: Kernaussage (erste Zeile) immer sichtbar, der volle Text
// per Klick aufklappbar. Kurze einzeilige Meldungen (z. B. Modellwechsel) bleiben wie gehabt.
function splitCore(msg: string): { core: string; hasMore: boolean } {
  const trimmed = msg.trim();
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  const multiLine = /\r?\n/.test(trimmed);
  const longSingle = firstLine.length > LONG_THRESHOLD;
  const core = longSingle ? firstLine.slice(0, LONG_THRESHOLD).trimEnd() + ' …' : firstLine;
  return { core, hasMore: multiLine || longSingle };
}

export const SystemNotificationInline: React.FC<SystemNotificationInlineProps> = ({
  notification,
}) => {
  const [open, setOpen] = useState(false);
  const msg = notification.msg ?? '';
  const { core, hasMore } = splitCore(msg);

  if (!hasMore) {
    return (
      <div className="text-xs text-gray-400 py-2 text-left whitespace-pre-wrap break-words">
        {msg}
      </div>
    );
  }

  const isError = ERROR_RE.test(msg);
  return (
    <div className={`text-xs py-2 text-left ${isError ? 'text-red-400' : 'text-gray-400'}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-start gap-1 w-full text-left hover:opacity-80 cursor-pointer"
        aria-expanded={open}
        title={open ? 'Details einklappen' : 'Details anzeigen'}
      >
        <span className="mt-[1px] select-none">{open ? '▾' : '▸'}</span>
        <span className="break-words">{core}</span>
      </button>
      {open && (
        <pre className="mt-1 ml-4 whitespace-pre-wrap break-words font-mono text-[11px] text-gray-400 bg-black/5 dark:bg-white/5 border border-border-primary rounded p-2">
          {msg}
        </pre>
      )}
    </div>
  );
};

export function getInlineSystemNotification(
  message: Message
): SystemNotificationContent | undefined {
  return message.content.find(
    (content): content is SystemNotificationContent & { type: 'systemNotification' } =>
      content.type === 'systemNotification' && content.notificationType === 'inlineMessage'
  );
}
