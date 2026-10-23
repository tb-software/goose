// TB-Software: Qualitaetsregler - IPC (Main <-> Renderer). Die Rollenauswahl und das Schreiben des
// Prompt-Blocks in die .goosehints liegen in qualityApply.ts (electron-frei, testbar).
import { ipcMain } from 'electron';
import log from '../../utils/logger';
import { readQualityConfig, writeQualityConfig, mergeQualityConfig, type QualityConfig } from './qualityConfig';
import { DEFAULT_ROLES } from './roles';
import { applyQualityHint, rolesForConfig } from './qualityApply';

export interface QualitySnapshot {
  config: QualityConfig;
  roleNames: string[]; // aktuell aktive Rollen (fuer die Anzeige)
}

function snapshot(cfg: QualityConfig): QualitySnapshot {
  return { config: cfg, roleNames: rolesForConfig(cfg).map((r) => r.name) };
}

export function registerTbQualityIpc(): void {
  ipcMain.handle('tb-quality-get', (): QualitySnapshot => snapshot(readQualityConfig()));

  ipcMain.handle('tb-quality-set', (_e, patch: Partial<QualityConfig>): QualitySnapshot => {
    try {
      const next = mergeQualityConfig(readQualityConfig(), patch);
      writeQualityConfig(next);
      const changed = applyQualityHint(next);
      log.info(`[TB][quality] Stufe ${next.stufe}, Modus ${next.mode}, .goosehints ${changed ? 'aktualisiert' : 'unveraendert'}.`);
      return snapshot(next);
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

// Beim App-Start den gespeicherten Stand in die .goosehints spiegeln.
export function initQuality(): void {
  try {
    applyQualityHint(readQualityConfig());
  } catch (e) {
    log.error('[TB][quality] initQuality fehlgeschlagen', e);
  }
}
