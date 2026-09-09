// TB-Software: Kuerzt lange Pfade MITTIG auf die verfuegbare Breite:
//   Anfang des Pfades … Ende des Pfades
// (statt am Ende abzuschneiden, wo genau der Dateiname/letzte Ordner verloren geht).
//
// Technik: Der Kopf fuellt die verfuegbare Breite und bekommt bei Ueberlauf das
// CSS-Ellipsis; das Ende (letzte N Zeichen) ist immer sichtbar (flex-shrink-0).
// So passt sich die Kuerzung automatisch der jeweiligen Container-Breite an.
import React from 'react';

interface MiddleTruncateProps {
  text: string;
  /** Anzahl immer sichtbarer Zeichen am Ende (Dateiname/letzter Ordner). */
  tail?: number;
  className?: string;
  title?: string;
}

export const MiddleTruncate: React.FC<MiddleTruncateProps> = ({
  text,
  tail = 16,
  className,
  title,
}) => {
  const tooltip = title ?? text;

  // Schnittstelle bestimmen: bevorzugt VOR dem letzten Pfad-Separator, damit das
  // komplette letzte Segment (Ordner/Dateiname) sichtbar bleibt — sofern es nicht
  // absurd lang ist. Sonst die letzten `tail` Zeichen.
  let cut = text.length - tail;
  const sep = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));
  if (sep > 0 && text.length - sep <= 34) {
    cut = Math.min(cut, sep);
  }
  cut = Math.max(0, cut);

  // Kurz genug / nichts zu kuerzen -> unveraendert zeigen.
  if (cut === 0 || text.length - cut <= 4) {
    return (
      <span className={className} title={tooltip}>
        {text}
      </span>
    );
  }
  const head = text.slice(0, cut);
  const end = text.slice(cut);
  return (
    // Kein min-w-0 auf dem AEUSSEREN Span: so schlaegt die feste Breite des Endes
    // (flex-shrink-0) als Mindestbreite nach oben durch — die Anzeige kann nie ganz
    // auf 0 kollabieren, das Ende (Ordner-/Dateiname) bleibt immer sichtbar. Nur der
    // KOPF schrumpft und bekommt das Ellipsis.
    <span
      className={`inline-flex align-bottom ${className ?? ''}`}
      title={tooltip}
      style={{ whiteSpace: 'nowrap' }}
    >
      <span className="truncate min-w-0">{head}</span>
      <span className="flex-shrink-0">{end}</span>
    </span>
  );
};
