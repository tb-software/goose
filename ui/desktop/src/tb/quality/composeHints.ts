// TB-Software: Qualitaetsregler Phase A - Prompt-Komposition (rein, testbar).
// Baut aus Stufe + aktiven Rollen einen Hinweis-Block fuer die .goosehints (Prompt-Schicht).
// Stufe 1 liefert bewusst einen leeren Block (heutiges Verhalten, keine Injektion).

import type { QualityParams } from './qualityPolicy';
import type { Role } from './roles';

export const QUALITY_HINT_START = '<!-- TB-QUALITY:START -->';
export const QUALITY_HINT_END = '<!-- TB-QUALITY:END -->';

const LENAX_DIRECTIVE = [
  '', // 0: aus -> keine Zeile
  'Ziehe bei Bedarf vorhandenes Wissen aus lenax-db heran.',
  'Frage vor der Antwort einmal lenax-db zum Thema ab.',
  'Frage lenax-db mehrfach ab (mit Query-Erweiterung) und beziehe die Treffer ein.',
  'Frage lenax-db mehrfach ab, auch je Rolle, und fasse am Ende nach, ob etwas aus der Vergangenheit vergessen wurde.',
];

// Reiner Textbaustein (ohne Marker). Leer bei Stufe 1.
export function composeQualityBody(params: QualityParams, roles: Role[]): string {
  if (params.stufe <= 1) return '';
  const lines: string[] = [];
  lines.push(`Qualitätsstufe ${params.stufe} von 10. Denk-Aufwand: ${params.denkAufwand}.`);

  const lenax = LENAX_DIRECTIVE[params.lenaxIntensity];
  if (lenax) lines.push(`Wissen: ${lenax}`);

  if (roles.length > 0) {
    lines.push('Prüfe deine Antwort vor dem Abschluss aus der Sicht dieser Rollen und bessere nach:');
    for (const r of roles) {
      lines.push(`- ${r.name}: ${r.promptFragment}`);
    }
  }

  if (params.reviewerRounds > 0) {
    lines.push(
      `Höchstens ${params.reviewerRounds} Korrekturrunde(n); höre früher auf, wenn eine Runde nichts Wesentliches mehr ändert.`
    );
  }
  lines.push(
    `Grenzen für diesen Zug: bis ${params.tokenCap} Token und ${Math.round(params.timeCapMs / 1000)} Sekunden. Halte dich knapp an das Ziel.`
  );
  return lines.join('\n');
}

// Vollstaendiger, marker-umklammerter Block. Leer-String bei Stufe 1 (kein Block).
export function composeQualityHint(params: QualityParams, roles: Role[]): string {
  const body = composeQualityBody(params, roles);
  if (!body) return '';
  return `${QUALITY_HINT_START}\n${body}\n${QUALITY_HINT_END}`;
}

// Idempotentes Einsetzen/Ersetzen eines marker-umklammerten Blocks in einen Text.
// Leerer block entfernt den vorhandenen Block. Mehrfaches Anwenden ergibt denselben Text.
export function upsertMarkerBlock(content: string, block: string, start = QUALITY_HINT_START, end = QUALITY_HINT_END): string {
  const base = content ?? '';
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\n*${esc(start)}[\\s\\S]*?${esc(end)}\\n*`, 'g');
  const stripped = base.replace(re, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!block) return stripped;
  return stripped ? `${stripped}\n\n${block}\n` : `${block}\n`;
}
