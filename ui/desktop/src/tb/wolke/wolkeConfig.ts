// TB-Software Milestone [13] — Wolke: persistierte Verbindungs-Konfiguration.
// Eigene Datei im Config-Ordner (überlebt Reset, kein Eingriff ins ACP), analog zu tb-tags.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import log from '../../utils/logger';

export interface WolkeConfig {
  // Ist der PC als Wolken-Client aktiv (registriert + pollt)?
  enabled: boolean;
  // Basis-URL der t78-Queue (Client-Index + Request-Queue).
  queueBase: string;
  // Stabile Kennung dieses Clients in der Wolke.
  clientId: string;
  // Anzeigename im Client-Index (Standard: Rechnername).
  clientName: string;
}

function configFile(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Block', 'goose', 'config', 'tb-wolke.json');
}

function defaults(): WolkeConfig {
  const host = os.hostname() || 'tb-goose';
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    enabled: false,
    queueBase: 'https://t78.ch/apps/cloud',
    clientId: `pc_${host.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${rand}`,
    clientName: `TB-Goose @ ${host}`,
  };
}

export function readWolkeConfig(): WolkeConfig {
  const d = defaults();
  try {
    const f = configFile();
    if (!fs.existsSync(f)) {
      writeWolkeConfig(d);
      return d;
    }
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<WolkeConfig>;
    // Fehlende Felder mit Defaults auffüllen; clientId bleibt stabil, sobald einmal vergeben.
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : d.enabled,
      queueBase: typeof parsed.queueBase === 'string' && parsed.queueBase ? parsed.queueBase : d.queueBase,
      clientId: typeof parsed.clientId === 'string' && parsed.clientId ? parsed.clientId : d.clientId,
      clientName: typeof parsed.clientName === 'string' && parsed.clientName ? parsed.clientName : d.clientName,
    };
  } catch (e) {
    log.error('[TB] readWolkeConfig fehlgeschlagen', e);
    return d;
  }
}

export function writeWolkeConfig(cfg: WolkeConfig): void {
  const f = configFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
}

// Nur die vom Nutzer editierbaren Felder übernehmen; enabled steuert der Start/Stop-Pfad.
export function mergeWolkeConfig(current: WolkeConfig, patch: Partial<WolkeConfig>): WolkeConfig {
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    queueBase: typeof patch.queueBase === 'string' && patch.queueBase.trim() ? patch.queueBase.trim() : current.queueBase,
    clientId: current.clientId,
    clientName:
      typeof patch.clientName === 'string' && patch.clientName.trim() ? patch.clientName.trim() : current.clientName,
  };
}
