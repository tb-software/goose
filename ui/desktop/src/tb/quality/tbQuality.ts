// TB-Software: Qualitaetsregler - IPC (Main <-> Renderer). Die Rollenauswahl und das Schreiben des
// Prompt-Blocks in die .goosehints liegen in qualityApply.ts (electron-frei, testbar).
import { ipcMain } from 'electron';
import log from '../../utils/logger';
import { readQualityConfig, writeQualityConfig, mergeQualityConfig, type QualityConfig } from './qualityConfig';
import { qualityParams } from './qualityPolicy';
import { DEFAULT_ROLES, type Role } from './roles';
import { applyQualityHint, rolesForConfig } from './qualityApply';

export interface QualitySnapshot {
  config: QualityConfig;
  roleNames: string[]; // aktuell aktive Rollen (fuer die Anzeige)
}

function snapshot(cfg: QualityConfig, roles: Role[] = rolesForConfig(cfg)): QualitySnapshot {
  return { config: cfg, roleNames: roles.map((r) => r.name) };
}

export function registerTbQualityIpc(): void {
  ipcMain.handle('tb-quality-get', (): QualitySnapshot => snapshot(readQualityConfig()));

  ipcMain.handle('tb-quality-set', (_e, patch: Partial<QualityConfig>): QualitySnapshot => {
    try {
      const next = mergeQualityConfig(readQualityConfig(), patch);
      writeQualityConfig(next);
      const roles = rolesForConfig(next); // einmal berechnen, fuer Hint und Anzeige
      const changed = applyQualityHint(next, roles);
      log.info(`[TB][quality] Stufe ${next.stufe}, Modus ${next.mode}, .goosehints ${changed ? 'aktualisiert' : 'unverändert'}.`);
      return snapshot(next, roles);
    } catch (e) {
      log.error('[TB][quality] set fehlgeschlagen', e);
      return snapshot(readQualityConfig());
    }
  });

  // Liste der verfuegbaren Rollen fuer die manuelle Auswahl.
  ipcMain.handle('tb-quality-roles', () =>
    DEFAULT_ROLES.map((r) => ({ id: r.id, name: r.name, type: r.type, always: r.always, minStufe: r.minStufe }))
  );
}

// Realer Backend-Hebel beim goosed-Start: das Verdichtungs-Budget je Qualitaetsstufe als
// GOOSE_COMPACTION_MAX_TOKENS an den Backend-Prozess geben. 0 -> undefined (nicht setzen, der
// Backend-Default greift). Env wird je neuem Chat/goosed-Start aus dem aktuellen Stand gelesen.
export function qualityCompactionBudgetEnv(): string | undefined {
  try {
    const budget = qualityParams(readQualityConfig().stufe).compactionMaxTokens;
    return budget > 0 ? String(budget) : undefined;
  } catch (e) {
    log.error('[TB][quality] qualityCompactionBudgetEnv fehlgeschlagen', e);
    return undefined;
  }
}

// Beim App-Start den gespeicherten Stand in die .goosehints spiegeln.
export function initQuality(): void {
  try {
    applyQualityHint(readQualityConfig());
  } catch (e) {
    log.error('[TB][quality] initQuality fehlgeschlagen', e);
  }
}
