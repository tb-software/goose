// TB-Software: Qualitaetsregler - persistierte Einstellung (Stufe, Modus, manuelle Rollen).
// Eigene Datei im Config-Ordner (analog tb-wolke.json/tb-tags.json). Phase A ist global; die
// Pro-Chat-Verfeinerung kommt spaeter.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { RollenModus } from './roles';
import { clampStufe } from './qualityPolicy';

export interface QualityConfig {
  stufe: number; // 1..10
  mode: RollenModus; // 'auto' | 'manuell'
  manualRoleIds: string[]; // nur im Modus 'manuell' genutzt
}

function configFile(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Block', 'goose', 'config', 'tb-quality.json');
}

function defaults(): QualityConfig {
  return { stufe: 3, mode: 'auto', manualRoleIds: [] };
}

export function readQualityConfig(): QualityConfig {
  const d = defaults();
  try {
    const f = configFile();
    if (!fs.existsSync(f)) {
      writeQualityConfig(d);
      return d;
    }
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<QualityConfig>;
    return {
      stufe: clampStufe(typeof parsed.stufe === 'number' ? parsed.stufe : d.stufe),
      mode: parsed.mode === 'manuell' ? 'manuell' : 'auto',
      manualRoleIds: Array.isArray(parsed.manualRoleIds)
        ? parsed.manualRoleIds.filter((x): x is string => typeof x === 'string')
        : d.manualRoleIds,
    };
  } catch (e) {
    console.error('[TB] readQualityConfig fehlgeschlagen', e);
    return d;
  }
}

export function writeQualityConfig(cfg: QualityConfig): void {
  const f = configFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
}

export function mergeQualityConfig(current: QualityConfig, patch: Partial<QualityConfig>): QualityConfig {
  return {
    stufe: typeof patch.stufe === 'number' ? clampStufe(patch.stufe) : current.stufe,
    mode: patch.mode === 'auto' || patch.mode === 'manuell' ? patch.mode : current.mode,
    manualRoleIds: Array.isArray(patch.manualRoleIds)
      ? patch.manualRoleIds.filter((x): x is string => typeof x === 'string')
      : current.manualRoleIds,
  };
}
