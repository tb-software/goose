// TB-Software: Qualitaetsregler - Rollenauswahl + Schreiben des Prompt-Blocks in die .goosehints.
// Bewusst OHNE electron/logger-Import, damit die Verdrahtung in Integrationstests gegen ein
// Temp-Verzeichnis gefahren werden kann (process.env.APPDATA zeigt im Test dorthin).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { qualityParams } from './qualityPolicy';
import { selectRoles, DEFAULT_ROLES, type Role } from './roles';
import { composeQualityHint, upsertMarkerBlock } from './composeHints';
import type { QualityConfig } from './qualityConfig';

// Phase A ist global (kein Chat-Thema bekannt): ein breites Themen-Set, damit die passenden Rollen
// gelistet werden; das Modell wendet die zutreffenden Perspektiven an. always-Rollen sind immer dabei.
export const BROAD_TOPIC = ['text', 'code', 'plan', 'offerte', 'email', 'dokument', 'tool', 'recherche', 'ux', 'daten'];

export function qualityConfigDir(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Block', 'goose', 'config');
}

export function rolesForConfig(cfg: QualityConfig): Role[] {
  return selectRoles({
    roles: DEFAULT_ROLES,
    topic: BROAD_TOPIC,
    params: qualityParams(cfg.stufe),
    mode: cfg.mode,
    manualIds: cfg.manualRoleIds,
  });
}

// Den Qualitaets-Block in die verwaltete .goosehints schreiben (idempotent, marker-umklammert).
// Gibt zurueck, ob die Datei geaendert wurde.
export function applyQualityHint(cfg: QualityConfig): boolean {
  try {
    const hintsFile = path.join(qualityConfigDir(), '.goosehints');
    const params = qualityParams(cfg.stufe);
    const roles = rolesForConfig(cfg);
    const block = composeQualityHint(params, roles); // Stufe 1 -> leerer Block (entfernt vorhandenen)
    const existing = fs.existsSync(hintsFile) ? fs.readFileSync(hintsFile, 'utf8') : '';
    const next = upsertMarkerBlock(existing, block);
    if (next !== existing) {
      fs.mkdirSync(path.dirname(hintsFile), { recursive: true });
      fs.writeFileSync(hintsFile, next.endsWith('\n') ? next : next + '\n');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[TB][quality] applyQualityHint fehlgeschlagen', e);
    return false;
  }
}
