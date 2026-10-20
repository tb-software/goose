// TB-Software: Optionale Zusatzmodule fuer die "Vollstaendige Installation" (nach dem Consent-Gate).
// Jedes Modul wird aus seinem bestehenden Selbst-Update-Feed (latest.ashx -> 302 -> hoechste Version)
// nach C:\_AI\Applications\<installDir>\ heruntergeladen und entpackt. TB-Goose verdrahtet die MCPs
// danach automatisch (bootstrapDefaults sucht die Exe genau dort). Rein additiv, nichts wird geloescht.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import log from '../../utils/logger';

const execFileP = promisify(execFile);

export interface ModuleEntry {
  key: string;
  name: string;
  description: string;
  feedUrl: string | null; // null = Feed noch nicht publiziert -> nicht installierbar
  installDir: string; // Ordnername unter %SystemDrive%\_AI\Applications
  verifyRel: string; // relativer Pfad der Exe, an der der Erfolg geprueft wird
  // 'mcp' = TB-Goose verdrahtet es als MCP (bootstrapDefaults findet die Exe am Zielort).
  // 'app' = eigenstaendige App (z. B. Systray) -> nach dem Install Autostart (HKCU Run) + einmal starten.
  type: 'mcp' | 'app';
  note?: string; // zusaetzlicher Hinweis (z. B. Abhaengigkeit, nicht lautlos)
}

export interface ModuleResult {
  key: string;
  name: string;
  ok: boolean;
  detail: string;
}

// Reihenfolge = Installationsreihenfolge. LenaX-DB zuerst (ist das "Gehirn" vieler anderer).
export const MODULE_CATALOG: ModuleEntry[] = [
  {
    key: 'lenax-db',
    name: 'LenaX-DB',
    description: 'Lokale Wissens-/Suchdatenbank (RAG). Gehirn fuer Suche und den Support-Assistenten.',
    feedUrl: 'https://t78.ch/apps/lenaxdb/downloads/latest.ashx',
    installDir: 'LenaX-DB',
    verifyRel: path.join('mcp', 'lenaxdb-mcp.exe'),
    type: 'mcp',
    note: 'Enthaelt die Embedding-Modelle (groesserer Download).',
  },
  {
    key: 'lenax-ipforward',
    name: 'IP-Forwarder',
    description: 'Fuehrt Web-Requests transparent ueber einen Fleet-Client aus (ipforward-Tunnel).',
    feedUrl: 'https://t78.ch/apps/proxy/downloads/lenax-ipforward/latest.ashx',
    installDir: 'LenaX-IPForward',
    verifyRel: 'lenax-ipforward-mcp.exe',
    type: 'mcp',
  },
  {
    key: 'lenax-computeruse',
    name: 'Computer-Steuerung',
    description: 'Sieht den PC (Screenshot) und steuert Maus/Tastatur, shell_exec, Prozesse.',
    feedUrl: 'https://t78.ch/apps/proxy/downloads/lenax-computeruse/latest.ashx',
    installDir: 'LenaX-ComputerUse',
    verifyRel: 'Tbrd.ComputerUse.Mcp.exe',
    type: 'mcp',
    note: 'Braucht einen laufenden TBRD-Client auf diesem PC.',
  },
  {
    key: 'lenax-browser',
    name: 'LenaX-Browser',
    description: 'Steuert das laufende Chrome (Tabs, navigieren, klicken, lesen, Screenshots).',
    // Die MCP-Exe (lenax-browser-mcp) - NICHT der lenax-browser-Feed, der nur das Extension-/Policy-Kit
    // (CRX + .reg) enthaelt. Die Chrome-Erweiterung selbst wird separat per CBCM-Richtlinie installiert.
    feedUrl: 'https://t78.ch/apps/proxy/downloads/lenax-browser-mcp/latest.ashx',
    installDir: 'LenaX-Browser',
    verifyRel: 'lenax-browser-mcp.exe',
    type: 'mcp',
    note: 'Die Chrome-Erweiterung wird separat per Richtlinie (CBCM) installiert - nicht automatisch.',
  },
  {
    key: 'support-assistant',
    name: 'Support-Assistent (Systray)',
    description: 'Ruhiger Assistent im Infobereich: suchen, fragen, (spaeter) mitlesen/nachfragen.',
    feedUrl: 'https://t78.ch/apps/proxy/downloads/support-assistant/latest.ashx',
    installDir: 'LenaX-SupportAssistant',
    verifyRel: 'LenaX.SupportAssistant.exe',
    type: 'app',
    note: 'Nutzt LenaX-DB als Gehirn; startet beim Login automatisch im Infobereich.',
  },
];

function applicationsBase(): string {
  const drive = process.env.SystemDrive || 'C:';
  return path.join(drive + path.sep, '_AI', 'Applications');
}

export function catalogForDisplay(): Array<
  Pick<ModuleEntry, 'key' | 'name' | 'description' | 'note'> & { available: boolean }
> {
  return MODULE_CATALOG.map((m) => ({
    key: m.key,
    name: m.name,
    description: m.description,
    note: m.note,
    available: m.feedUrl !== null,
  }));
}

export interface ModuleStatus {
  key: string;
  name: string;
  description: string;
  note?: string;
  available: boolean; // Feed vorhanden -> installierbar
  installed: boolean; // erwartete Exe liegt am Zielort
  target: string; // Zielordner
}

// Status je Modul: ist die erwartete Exe am Zielort vorhanden (installiert)?
export async function moduleStatus(): Promise<ModuleStatus[]> {
  const out: ModuleStatus[] = [];
  for (const m of MODULE_CATALOG) {
    const target = path.join(applicationsBase(), m.installDir);
    let installed: boolean;
    try {
      await fs.access(path.join(target, m.verifyRel));
      installed = true;
    } catch {
      installed = false;
    }
    out.push({
      key: m.key,
      name: m.name,
      description: m.description,
      note: m.note,
      available: m.feedUrl !== null,
      installed,
      target,
    });
  }
  return out;
}

async function downloadToFile(url: string, destFile: string): Promise<void> {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok || !resp.body) {
    throw new Error(`Download HTTP ${resp.status}`);
  }
  await pipeline(Readable.fromWeb(resp.body as unknown as import('stream/web').ReadableStream), createWriteStream(destFile));
}

async function expandArchive(zipFile: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  // Windows-nativ, keine Zip-Lib noetig. -Force ueberschreibt vorhandene Dateien.
  await execFileP(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
  );
}

// Wenn das Archiv alles in EINEN Unterordner gelegt hat (z. B. LenaX-DB-v1.0.166\...), diesen als
// Inhaltswurzel nehmen; sonst das Entpackverzeichnis selbst.
async function contentRoot(extractDir: string): Promise<string> {
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractDir, entries[0].name);
  }
  return extractDir;
}

// Fuer eigenstaendige Apps (type 'app', z. B. Systray): Autostart beim Login eintragen (HKCU Run,
// benutzer-scoped, kein Admin) und einmal jetzt starten, damit der Nutzer sie sofort sieht.
async function registerAutostartAndLaunch(mod: ModuleEntry, exe: string): Promise<void> {
  const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const valueName = `LenaX-${mod.key}`;
  await execFileP('reg', ['add', runKey, '/v', valueName, '/t', 'REG_SZ', '/d', exe, '/f'], {
    windowsHide: true,
  });
  try {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* Start-Fehler ist unkritisch - laeuft spaetestens beim naechsten Login */
  }
}

async function installOne(mod: ModuleEntry): Promise<ModuleResult> {
  if (!mod.feedUrl) {
    return { key: mod.key, name: mod.name, ok: false, detail: 'kein Feed veroeffentlicht - uebersprungen' };
  }
  const target = path.join(applicationsBase(), mod.installDir);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tbmod-'));
  const zipFile = path.join(tmp, 'module.zip');
  const extractDir = path.join(tmp, 'x');
  try {
    log.info(`[TB] Modul ${mod.name}: lade ${mod.feedUrl}`);
    await downloadToFile(mod.feedUrl, zipFile);
    await expandArchive(zipFile, extractDir);
    const root = await contentRoot(extractDir);
    await fs.mkdir(target, { recursive: true });
    await fs.cp(root, target, { recursive: true, force: true });
    const exe = path.join(target, mod.verifyRel);
    try {
      await fs.access(exe);
    } catch {
      return {
        key: mod.key,
        name: mod.name,
        ok: false,
        detail: `entpackt, aber erwartete Datei fehlt (${mod.verifyRel}) - Archiv-Layout pruefen`,
      };
    }
    if (mod.type === 'app') {
      await registerAutostartAndLaunch(mod, exe).catch((e) =>
        log.error(`[TB] Autostart ${mod.name} fehlgeschlagen`, e)
      );
    }
    log.info(`[TB] Modul ${mod.name}: installiert -> ${target}`);
    const extra = mod.type === 'app' ? ' (Autostart eingerichtet + gestartet)' : '';
    return { key: mod.key, name: mod.name, ok: true, detail: `installiert nach ${target}${extra}` };
  } catch (e) {
    log.error(`[TB] Modul ${mod.name} fehlgeschlagen`, e);
    return { key: mod.key, name: mod.name, ok: false, detail: (e as Error).message };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// Installiert alle Module mit Feed (oder nur onlyKey), meldet Fortschritt je Modul ueber onProgress.
export async function installModules(
  onProgress?: (p: { index: number; total: number; name: string; phase: 'start' | 'done'; result?: ModuleResult }) => void,
  onlyKey?: string
): Promise<ModuleResult[]> {
  const installable = MODULE_CATALOG.filter(
    (m) => m.feedUrl !== null && (!onlyKey || m.key === onlyKey)
  );
  const results: ModuleResult[] = [];
  for (let i = 0; i < installable.length; i++) {
    const mod = installable[i];
    onProgress?.({ index: i, total: installable.length, name: mod.name, phase: 'start' });
    const res = await installOne(mod);
    results.push(res);
    onProgress?.({ index: i, total: installable.length, name: mod.name, phase: 'done', result: res });
  }
  // Module ohne Feed als uebersprungen melden (nur beim Gesamtlauf, nicht bei Einzel-Install).
  if (!onlyKey) {
    for (const mod of MODULE_CATALOG.filter((m) => m.feedUrl === null)) {
      results.push({ key: mod.key, name: mod.name, ok: false, detail: 'kein Feed veroeffentlicht - uebersprungen' });
    }
  }
  return results;
}
