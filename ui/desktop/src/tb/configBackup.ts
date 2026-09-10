// TB-Software: Sicherung & Wiederherstellung der Goose-Config (config.yaml).
//
// Hintergrund: Lässt man den Agenten „die Einstellungen selbst vornehmen", kann er die
// config.yaml so überschreiben, dass die App nur noch den Onboarding-Screen zeigt
// („Willkommen bei goose"). Damit man nie einen funktionierenden Stand verliert:
//   1) Beim Beenden wird die aktuelle Config gesichert — ABER nur, wenn sie „funktional"
//      ist (gültiges YAML, Mindestgröße, Provider+Modell gesetzt). So überschreibt ein
//      kaputter Stand nie das letzte gute Backup. Ein einziges, rollierendes Backup.
//   2) „Auf TB-Werkseinstellungen zurücksetzen" schreibt die mitgelieferte Standard-Config
//      (Proxy/tb-software, auto:code, auto-Modus) und trägt lenax-db als MCP ein.
//   3) „Aus Backup wiederherstellen" spielt das letzte gute Backup zurück.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as yaml from 'yaml';
import log from '../utils/logger';
import { tbDefaultsDir, ensureLenaxDbExtension } from './bootstrapDefaults';

// Kleiner als das = kann keine sinnvollen Settings enthalten (Nutzer-Vorgabe).
const MIN_CONFIG_BYTES = 200;

export interface TbConfigPaths {
  cfgDir: string;
  cfgFile: string;
  backupFile: string;
}

export function tbConfigPaths(): TbConfigPaths {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const cfgDir = path.join(appData, 'Block', 'goose', 'config');
  return {
    cfgDir,
    cfgFile: path.join(cfgDir, 'config.yaml'),
    backupFile: path.join(cfgDir, 'config.yaml.tb-backup'),
  };
}

// „Funktional" = groß genug + syntaktisch gültiges YAML + Provider UND Modell gesetzt.
// (Der Onboarding-Zustand hat keinen Provider -> gilt als NICHT funktional.)
export function isFunctionalConfigText(text: string | null | undefined): boolean {
  if (!text || Buffer.byteLength(text, 'utf8') < MIN_CONFIG_BYTES) return false;
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch {
    return false; // kaputtes YAML -> nicht funktional
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as Record<string, unknown>;
  const provider = String(p.GOOSE_PROVIDER ?? '').trim();
  const model = String(p.GOOSE_MODEL ?? '').trim();
  return provider.length > 0 && model.length > 0;
}

function readIfExists(file: string): string | null {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

// Beim Beenden aufrufen: sichert die aktuelle Config rollierend, aber NUR wenn sie funktional ist.
export function backupConfigOnExit(): void {
  try {
    const { cfgFile, backupFile } = tbConfigPaths();
    const text = readIfExists(cfgFile);
    if (!isFunctionalConfigText(text)) {
      log.info('[TB] Beenden: Config nicht funktional/zu klein -> kein Backup (letztes gutes Backup bleibt erhalten).');
      return;
    }
    fs.writeFileSync(backupFile, text as string); // rollierend: überschreibt das vorige gute Backup
    log.info(`[TB] Config-Backup beim Beenden geschrieben -> ${backupFile}`);
  } catch (e) {
    log.error('[TB] Backup beim Beenden fehlgeschlagen', e);
  }
}

export function hasUsableBackup(): boolean {
  const { backupFile } = tbConfigPaths();
  return isFunctionalConfigText(readIfExists(backupFile));
}

export interface TbActionResult {
  ok: boolean;
  message: string;
}

// „Aus Backup wiederherstellen": spielt das letzte gute Backup zurück (nur wenn gültig).
export function restoreFromBackup(): TbActionResult {
  try {
    const { cfgFile, backupFile } = tbConfigPaths();
    const text = readIfExists(backupFile);
    if (text === null) return { ok: false, message: 'Kein Backup vorhanden.' };
    if (!isFunctionalConfigText(text)) {
      return { ok: false, message: 'Das Backup ist ungültig oder zu klein — nicht wiederhergestellt.' };
    }
    // Aktuelle (evtl. kaputte) Config vorsichtshalber daneben ablegen.
    if (fs.existsSync(cfgFile)) {
      try {
        fs.copyFileSync(cfgFile, cfgFile + '.pre-restore');
      } catch {
        /* nicht kritisch */
      }
    }
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    fs.writeFileSync(cfgFile, text);
    log.info('[TB] Config aus Backup wiederhergestellt.');
    return { ok: true, message: 'Konfiguration aus Backup wiederhergestellt. Zum Übernehmen die App neu starten.' };
  } catch (e) {
    log.error('[TB] Wiederherstellen aus Backup fehlgeschlagen', e);
    return { ok: false, message: 'Wiederherstellen fehlgeschlagen: ' + String(e) };
  }
}

// „Auf TB-Werkseinstellungen zurücksetzen": mitgelieferte Standard-Config schreiben
// (tb-software/Proxy, auto:code, auto-Modus) + lenax-db als MCP (mit Platzhalter-Fallback).
export function resetToFactory(): TbActionResult {
  try {
    const { cfgDir, cfgFile, backupFile } = tbConfigPaths();
    fs.mkdirSync(cfgDir, { recursive: true });

    // Aktuelle funktionale Config zuvor als Backup sichern (nicht verlieren) + Kopie daneben.
    const current = readIfExists(cfgFile);
    if (isFunctionalConfigText(current)) {
      try {
        fs.writeFileSync(backupFile, current as string);
      } catch {
        /* nicht kritisch */
      }
    }
    if (current !== null) {
      try {
        fs.copyFileSync(cfgFile, cfgFile + '.pre-reset');
      } catch {
        /* nicht kritisch */
      }
    }

    const src = path.join(tbDefaultsDir(), 'config.yaml');
    if (!fs.existsSync(src)) {
      return { ok: false, message: 'Mitgelieferte Standard-Config nicht gefunden (tb-defaults\\config.yaml).' };
    }
    fs.copyFileSync(src, cfgFile);
    // lenax-db-Extension eintragen — mit Platzhalter, falls die Exe (noch) nicht gefunden wird.
    ensureLenaxDbExtension(cfgDir, { writePlaceholderIfMissing: true });

    log.info('[TB] Auf TB-Werkseinstellungen zurückgesetzt.');
    return {
      ok: true,
      message:
        'Auf TB-Werkseinstellungen zurückgesetzt (Proxy/tb-software, auto:code, auto-Modus, lenax-db MCP). Zum Übernehmen die App neu starten.',
    };
  } catch (e) {
    log.error('[TB] Werksreset fehlgeschlagen', e);
    return { ok: false, message: 'Werksreset fehlgeschlagen: ' + String(e) };
  }
}
