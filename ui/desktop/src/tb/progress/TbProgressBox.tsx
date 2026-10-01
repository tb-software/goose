// TB-Software: eine kompakte, auf-/zuklappbare Fortschritts-Box fuer korrelierte Status-Polls.
// Eingeklappt = Balken + eine Kernzeile; aufgeklappt = granulare Details, Live-Vorschau und Rohdaten.
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../utils';
import { fmtDuration } from '../status/forecast';
import type { TbProgress, TbProgressStatus } from './progressSchema';
import type { TbProgressBox as TbProgressBoxData } from './collectProgressBoxes';

const STATUS_ICON: Record<TbProgressStatus, string> = {
  queued: '⏳',
  running: '🎙',
  done: '✅',
  error: '⚠',
  unknown: '•',
};

function fmtSec(sec: number): string {
  return fmtDuration(sec * 1000);
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function resultText(result: Record<string, unknown> | undefined): string | undefined {
  const text = result?.text;
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}

function coreLine(p: TbProgress): string {
  if (p.status === 'error') return p.error ?? 'Fehler';
  if (p.status === 'done') return p.headline ?? 'Fertig';
  if (p.etaSec != null) return `noch ~${fmtSec(p.etaSec)}`;
  if (p.phaseText) return p.phaseText;
  if (p.livePreview) return shorten(p.livePreview, 60);
  return p.headline ?? '';
}

function Bar({ percent, indeterminate }: { percent?: number; indeterminate: boolean }) {
  return (
    <div className="w-32 h-2 bg-background-subtle rounded-full overflow-hidden relative shrink-0">
      {indeterminate || percent == null ? (
        <div className="absolute inset-0 animate-indeterminate bg-primary" />
      ) : (
        <div
          className="bg-primary h-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );
}

function Expandable({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1 text-sm text-textSubtle hover:text-textStandard"
      >
        <ChevronRight className={cn('w-4 h-4 transition-transform', open && 'rotate-90')} />
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export default function TbProgressBox({ box }: { box: TbProgressBoxData }) {
  const [open, setOpen] = useState(false);
  const p = box.latest;
  const title = p.title ?? box.seed.title ?? 'Fortschritt';
  const icon = STATUS_ICON[p.status];
  const core = coreLine(p);
  const ergebnisText = resultText(p.result);

  const details = [...p.details];
  if (box.seed.title && !details.some((d) => d.label === 'Datei')) {
    details.unshift({ label: 'Datei', value: box.seed.title });
  }

  return (
    <div className="rounded-lg border border-borderSubtle bg-background-muted p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="shrink-0">{icon}</span>
        <span className="font-sans text-sm truncate min-w-0 flex-1">{title}</span>
        {p.status !== 'done' && p.status !== 'error' && (
          <Bar percent={p.percent} indeterminate={p.indeterminate} />
        )}
        {p.percent != null && p.status !== 'done' && p.status !== 'error' && (
          <span className="text-sm text-textSubtle shrink-0">{p.percent} %</span>
        )}
        {core && (
          <span className="text-sm text-textSubtle truncate min-w-0">
            {p.status === 'done' || p.status === 'error' ? core : `· ${core}`}
          </span>
        )}
        <ChevronRight
          className={cn('w-4 h-4 text-textSubtle shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {details.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {details.map((d, i) => (
                <div key={i} className="contents">
                  <dt className="text-textSubtle">{d.label}:</dt>
                  <dd className="text-textStandard break-words">{d.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {p.status !== 'done' && p.livePreview && (
            <div className="text-sm">
              <div className="text-textSubtle">Zuletzt erkannt:</div>
              <div className="text-textStandard italic break-words">{p.livePreview}</div>
            </div>
          )}

          {p.status === 'error' && p.error && (
            <div className="text-sm text-textStandard break-words">{p.error}</div>
          )}

          {ergebnisText && (
            <Expandable label="Transkript anzeigen">
              <pre className="text-xs whitespace-pre-wrap break-words max-h-80 overflow-y-auto bg-background-subtle rounded p-2">
                {ergebnisText}
              </pre>
            </Expandable>
          )}

          <Expandable label={`Rohdaten / Polls (${box.raw.length})`}>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {box.raw.map((snapshot, i) => (
                <pre
                  key={i}
                  className="text-xs whitespace-pre-wrap break-words bg-background-subtle rounded p-2"
                >
                  {JSON.stringify(snapshot, null, 2)}
                </pre>
              ))}
            </div>
          </Expandable>
        </div>
      )}
    </div>
  );
}
