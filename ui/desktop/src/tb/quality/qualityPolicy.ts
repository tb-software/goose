// TB-Software: Qualitaetsregler Phase A - reine Politik-Abbildung Stufe (1..10) -> Parameter.
// Deklarativ und seiteneffektfrei, damit es portabel ist (spaeter auch andere Tools) und voll
// testbar bleibt. Siehe Konzept milestone[19]/_Documents/01_Qualitaetsregler-...md.

export type DenkAufwand = 'niedrig' | 'mittel' | 'hoch';
export type Autonomie = 'smart_approve' | 'auto';
export type RollenTiefe = 'keine' | 'kurz' | 'flach' | 'mittel' | 'loop' | 'intensiv';

export interface QualityParams {
  stufe: number; // 1..10, geklemmt und gerundet
  lenaxIntensity: number; // 0 aus, 1 bei Bedarf, 2 immer, 3 multi, 4 multi+je-Rolle
  reviewerRounds: number; // max. Korrekturrunden
  loopBudget: number; // max. Iterationen je Rolle (0 = kein Loop)
  denkAufwand: DenkAufwand;
  autonomie: Autonomie;
  rollenTiefe: RollenTiefe;
  alleRollen: boolean; // ab Stufe 9: alle verfuegbaren Rollen zuschalten
  nachfassen: boolean; // ab Stufe 10: "Vergessen?"-Nachfassen auf die Verdichtung
  tokenCap: number; // Token-Deckel je Zug
  timeCapMs: number; // Wanduhr-Deckel je Zug
}

// Absolute letzte Reissleine, unabhaengig von der Stufe.
export const HARD_CEILING_MS = 10 * 60 * 1000;

// Eine Stufe auf gueltige, gerundete 1..10 bringen.
export function clampStufe(stufeRaw: number): number {
  if (!Number.isFinite(stufeRaw)) return 1;
  const r = Math.round(stufeRaw);
  return Math.min(10, Math.max(1, r));
}

// Nicht fallende Tabellen je Stufe-Index (1..10 -> Index 0..9).
const LENAX = [0, 1, 1, 2, 2, 2, 3, 3, 4, 4];
const REVIEWER = [0, 1, 1, 2, 2, 2, 3, 3, 4, 5];
const LOOP = [0, 0, 0, 2, 2, 4, 4, 6, 6, 8];
const TOKEN_CAP = [8000, 8000, 8000, 16000, 16000, 24000, 40000, 40000, 60000, 80000];
const TIME_CAP_MS = [30000, 30000, 45000, 60000, 90000, 120000, 180000, 240000, 360000, HARD_CEILING_MS];

function denkAufwand(stufe: number): DenkAufwand {
  if (stufe <= 3) return 'niedrig';
  if (stufe <= 6) return 'mittel';
  return 'hoch';
}

function rollenTiefe(stufe: number): RollenTiefe {
  if (stufe === 1) return 'keine';
  if (stufe <= 3) return 'kurz';
  if (stufe <= 5) return 'flach';
  if (stufe === 6) return 'mittel';
  if (stufe <= 8) return 'loop';
  return 'intensiv';
}

export function qualityParams(stufeRaw: number): QualityParams {
  const stufe = clampStufe(stufeRaw);
  const i = stufe - 1;
  return {
    stufe,
    lenaxIntensity: LENAX[i],
    reviewerRounds: REVIEWER[i],
    loopBudget: LOOP[i],
    denkAufwand: denkAufwand(stufe),
    autonomie: stufe >= 4 ? 'auto' : 'smart_approve',
    rollenTiefe: rollenTiefe(stufe),
    alleRollen: stufe >= 9,
    nachfassen: stufe >= 10,
    tokenCap: TOKEN_CAP[i],
    timeCapMs: Math.min(TIME_CAP_MS[i], HARD_CEILING_MS),
  };
}
