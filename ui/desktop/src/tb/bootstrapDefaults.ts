// TB-Software: Macht das gepackte Windows-Release out-of-the-box lauffaehig.
// 1) Setzt Default-Umgebungsvariablen fuer den LLMProxy-Betrieb (kein Secret noetig,
//    Windows-Keyring aus) — falls nicht bereits gesetzt.
// 2) Schreibt beim ERSTEN Start die mitgelieferte Standard-Config (Proxy-Endpoint,
//    Modell-Routen auto:code, Verhalten) in den Goose-Config-Ordner, sowie die
//    .goosehints (Durchhalte-/Budget-Direktive) — beide nur, wenn noch nicht vorhanden
//    (bestehende Nutzer-Anpassungen bleiben erhalten).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import * as yaml from 'yaml';
import log from '../utils/logger';

// TB-Software: Die "auto:*"-Routing-Tags des Kilo/LenaX-Setups (keyless ueber den
// gericom-Proxy, alle cost 0). Der Nutzer waehlt die AUFGABE, das Gateway routet auf
// das passende freie Fleet-Modell. Erscheinen als kuratierte Modell-Liste im Dropdown.
// Default bleibt auto:code (siehe GOOSE_DEFAULT_MODEL unten + config.yaml GOOSE_MODEL).
const TB_AUTO_MODELS = [
  {
    name: 'auto:code',
    provider: 'openai',
    alias: 'Auto: Code',
    subtext: 'Coding · Werkzeuge · Reasoning (Qwen) — Standard',
    context_limit: 262144,
    reasoning: true,
  },
  {
    name: 'auto:chat',
    provider: 'openai',
    alias: 'Auto: Chat',
    subtext: 'Schneller Chat, ohne Werkzeuge (Mistral)',
    context_limit: 131072,
  },
  {
    name: 'auto:vision',
    provider: 'openai',
    alias: 'Auto: Vision',
    subtext: 'Bilder/Screenshots erkennen (Mistral VLM)',
    context_limit: 131072,
  },
  {
    name: 'auto:image',
    provider: 'openai',
    alias: 'Auto: Image',
    subtext: 'Höhere Bildqualität (Qwen)',
    context_limit: 262144,
    reasoning: true,
  },
  {
    name: '*',
    provider: 'openai',
    alias: 'Auto: * (bestes verfügbares)',
    subtext: 'Automatische Modellwahl',
    context_limit: 131072,
  },
];

export function tbDefaultsDir(): string {
  // extraResource kopiert src/tb-defaults -> resources/tb-defaults (gepackt).
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tb-defaults')
    : path.join(app.getAppPath(), 'src', 'tb-defaults');
}

// Fallback-Pfad, wenn keine lenaxdb-mcp.exe gefunden wird (Nutzer-Auswahl: Auto-Erkennung +
// Fallback). Beim Werksreset wird dieser Platzhalter (enabled) eingetragen, damit die
// Extension sichtbar/aktiv ist; der Nutzer korrigiert den Pfad ggf. in den Einstellungen.
const LENAXDB_FALLBACK_EXE = 'C:\\_AI\\Applications\\LenaX-DB\\mcp\\lenaxdb-mcp.exe';

export function ensureTbDefaults(): void {
  // (1) Env-Defaults — nur setzen, wenn der Nutzer/Starter nichts vorgegeben hat.
  if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'none';
  if (!process.env.GOOSE_DISABLE_KEYRING) process.env.GOOSE_DISABLE_KEYRING = 'true';

  // KRITISCH: Der Proxy-Endpunkt MUSS gesetzt sein, sonst spricht der eingebaute openai-Provider
  // das echte api.openai.com an (401 „Incorrect API key: none"). Frueher stand der Endpunkt NUR
  // in der geseedeten config.yaml — existierte dort schon eine Config OHNE diese Schluessel (z. B.
  // aus einer aelteren Version / UI-Onboarding), fiel Goose auf OpenAI zurueck. Da `Config::get_param`
  // die ENV VOR der config.yaml liest, erzwingt das den Proxy unabhaengig vom Config-Zustand.
  if (!process.env.OPENAI_HOST) process.env.OPENAI_HOST = 'https://t78.ch';
  if (!process.env.OPENAI_BASE_PATH) {
    process.env.OPENAI_BASE_PATH = 'apps/proxy/gericom/jumpserver.ashx/v1/chat/completions';
  }
  if (!process.env.OPENAI_CUSTOM_HEADERS) {
    // Pflicht-Client-Identity-Header (sonst nur IP im #routes-Monitor).
    const ver = (() => {
      try {
        return app.getVersion();
      } catch {
        return '1.50';
      }
    })();
    process.env.OPENAI_CUSTOM_HEADERS = `X-Title=TB-Goose,X-Client=TB-Goose,X-Client-Site=gericom,X-Client-Version=${ver},X-Client-OS=Windows`;
  }

  // Kuratierte auto:*-Modell-Liste + Default. Wird von getBundledConfig() (main.ts)
  // in appConfig uebernommen und treibt das Modell-Dropdown. Default: auto:code.
  if (!process.env.GOOSE_DEFAULT_PROVIDER) process.env.GOOSE_DEFAULT_PROVIDER = 'openai';
  if (!process.env.GOOSE_DEFAULT_MODEL) process.env.GOOSE_DEFAULT_MODEL = 'auto:code';
  if (!process.env.GOOSE_PREDEFINED_MODELS) {
    process.env.GOOSE_PREDEFINED_MODELS = JSON.stringify(TB_AUTO_MODELS);
  }

  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const cfgDir = path.join(appData, 'Block', 'goose', 'config');
    fs.mkdirSync(cfgDir, { recursive: true });

    const base = tbDefaultsDir();

    // Config nur seeden, wenn noch keine vorhanden ist (Einstellungen des Nutzers
    // — Modell-Modus, Tools-Modus — nicht ueberschreiben).
    const cfgSrc = path.join(base, 'config.yaml');
    const cfgDst = path.join(cfgDir, 'config.yaml');
    if (fs.existsSync(cfgSrc) && !fs.existsSync(cfgDst)) {
      fs.copyFileSync(cfgSrc, cfgDst);
      log.info(`[TB] Standard-Config geschrieben -> ${cfgDst}`);
    }

    // .goosehints: nur seeden, wenn noch keine vorhanden ist — sonst wuerden lokale
    // Anpassungen (eigene Budget-/Persistenz-Direktiven) bei jedem Start ueberschrieben.
    // Bewusste Aktualisierung auf den Release-Stand geht per Loeschen der Datei.
    const hintsSrc = path.join(base, 'goosehints');
    const hintsDst = path.join(cfgDir, '.goosehints');
    if (fs.existsSync(hintsSrc) && !fs.existsSync(hintsDst)) {
      fs.copyFileSync(hintsSrc, hintsDst);
    }

    // LenaX-DB MCP standardmäßig verbinden. IMMER als Erweiterung eintragen (auch wenn die Exe
    // (noch) nicht gefunden wird) -> sichtbar + konfigurierbar. Gefunden = aktiv/verbunden,
    // nicht gefunden = sichtbar, aber deaktiviert (Pfad in den Einstellungen setzen).
    ensureLenaxDbExtension(cfgDir, { writePlaceholderIfMissing: true });
  } catch (e) {
    log.error('[TB] ensureTbDefaults fehlgeschlagen', e);
  }
}

// ---------------------------------------------------------------------------
// LenaX-DB MCP-Anbindung (STDIO) — standardmäßig verbinden, mit Auto-Discovery.
// ---------------------------------------------------------------------------

interface LenaxDbLocation {
  exe: string;
  config: string | null;
}

// Ermittelt die lenaxdb-mcp.exe aus einem LAUFENDEN LenaX-DB-Prozess (Idee: LenaX-DB läuft als
// App -> der Programmpfad ist eindeutig ableitbar). Cockpit liegt unter <Wurzel>\cockpit\,
// die MCP unter <Wurzel>\mcp\. Findet einen der beiden Prozesse -> baut den mcp-Exe-Pfad.
function lenaxExeFromRunningProcess(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    // PowerShell: Pfade laufender LenaX-DB-Prozesse (Manager/MCP) holen.
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-Process LenaXDB.Manager,lenaxdb-mcp -ErrorAction SilentlyContinue | ForEach-Object { $_.Path } | Where-Object { $_ }",
      ],
      { encoding: 'utf8', timeout: 4000, windowsHide: true }
    );
    const paths = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of paths) {
      const lower = p.toLowerCase();
      if (lower.endsWith('\\mcp\\lenaxdb-mcp.exe') && fs.existsSync(p)) return p;
      // Cockpit gefunden -> Wurzel = parent(cockpit), mcp-Exe daneben.
      if (lower.endsWith('\\cockpit\\lenaxdb.manager.exe')) {
        const root = path.dirname(path.dirname(p));
        const mcp = path.join(root, 'mcp', 'lenaxdb-mcp.exe');
        if (fs.existsSync(mcp)) return mcp;
      }
    }
  } catch (e) {
    log.info('[TB] LenaX-DB-Prozess-Scan fehlgeschlagen (unkritisch)', (e as Error)?.message);
  }
  return null;
}

// Sucht die lenaxdb-mcp.exe: erst statische Installationsorte + Override LENAXDB_MCP_EXE,
// dann als Fallback über einen LAUFENDEN LenaX-DB-Prozess (robust bei abweichendem Pfad).
function discoverLenaxDbMcp(): LenaxDbLocation | null {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    process.env.LENAXDB_MCP_EXE,
    'C:\\_AI\\Applications\\LenaX-DB\\mcp\\lenaxdb-mcp.exe',
    'D:\\_AI\\Applications\\LenaX-DB\\mcp\\lenaxdb-mcp.exe',
    'D:\\_AI\\Programs\\LenaX-DB\\mcp\\lenaxdb-mcp.exe',
    path.join(localAppData, 'Programs', 'LenaX-DB', 'mcp', 'lenaxdb-mcp.exe'),
    path.join(localAppData, 'LenaX-DB', 'mcp', 'lenaxdb-mcp.exe'),
    path.join(programFiles, 'LenaX-DB', 'mcp', 'lenaxdb-mcp.exe'),
    path.join(programFilesX86, 'LenaX-DB', 'mcp', 'lenaxdb-mcp.exe'),
  ].filter((c): c is string => !!c);

  let exe = candidates.find((c) => {
    try {
      return fs.existsSync(c) && fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });

  // Fallback: aus laufendem Prozess (deckt beliebige Installationspfade ab).
  if (!exe) {
    const fromProc = lenaxExeFromRunningProcess();
    if (fromProc) {
      log.info(`[TB] LenaX-DB MCP über laufenden Prozess gefunden: ${fromProc}`);
      exe = fromProc;
    }
  }
  if (!exe) return null;

  // Config-Pfad (gemeinsam mit dem Cockpit). Fehlt sie, startet die MCP mit Default-Config.
  const cfg = path.join(localAppData, 'LenaXDB', 'config.json');
  return { exe, config: fs.existsSync(cfg) ? cfg : null };
}

// Config-Pfad POSITIONAL übergeben (kanonisch, code-verifiziert in Program.cs:
//   configPath = args.FirstOrDefault(a => !a.StartsWith("--"))).
// `--config <pfad>` (mit Leerzeichen) funktioniert ebenfalls, ist aber unnötig;
// `--config=<pfad>` (mit `=`) beginnt mit `--` und würde übersprungen -> Default-Config (0 Quellen).
function lenaxArgs(configPath: string | null): string[] {
  return configPath ? [configPath] : [];
}

// Erkennt einen kaputt konfigurierten Config-Args-Eintrag: die `--config=<pfad>`-Form (mit `=`)
// wird vom Binary übersprungen -> Default-Config. Solche Einträge werden beim Self-Heal korrigiert.
function hasBrokenConfigArg(args: unknown): boolean {
  return Array.isArray(args) && args.some((a) => typeof a === 'string' && a.startsWith('--config='));
}

// Findet einen vorhandenen LenaX-DB-Extension-Eintrag (per Key oder per Name).
function findLenaxEntry(
  parsed: unknown
): { key: string; entry: { cmd?: string; timeout?: number; args?: unknown } } | null {
  const exts = (
    parsed as {
      extensions?: Record<string, { name?: string; cmd?: string; timeout?: number; args?: unknown }>;
    }
  )?.extensions;
  if (!exts || typeof exts !== 'object') return null;
  if (exts.lenax_db) return { key: 'lenax_db', entry: exts.lenax_db };
  for (const [key, entry] of Object.entries(exts)) {
    if (typeof entry?.name === 'string' && /lenax/i.test(entry.name)) {
      return { key, entry };
    }
  }
  return null;
}

export function ensureLenaxDbExtension(
  cfgDir: string,
  opts: { writePlaceholderIfMissing?: boolean } = {}
): void {
  try {
    const cfgFile = path.join(cfgDir, 'config.yaml');
    if (!fs.existsSync(cfgFile)) return; // Config wird zuvor geseedet; ohne sie nichts zu tun.

    const raw = fs.readFileSync(cfgFile, 'utf8');
    const parsed = yaml.parse(raw) ?? {};
    const found = discoverLenaxDbMcp();
    const existing = findLenaxEntry(parsed);

    if (existing) {
      // Vorhandenen Eintrag NUR reparieren, wenn er kaputt ist (cmd-Pfad existiert nicht)
      // und wir eine gültige exe gefunden haben. Sonst Nutzer-Entscheidung respektieren.
      const cmd = String(existing.entry.cmd ?? '').trim();
      const cmdBroken = !cmd || !fs.existsSync(cmd);
      const argsBroken = hasBrokenConfigArg(existing.entry.args);
      if (found && (cmdBroken || argsBroken)) {
        const doc = yaml.parseDocument(raw);
        if (cmdBroken) {
          doc.setIn(['extensions', existing.key, 'cmd'], found.exe);
          doc.setIn(['extensions', existing.key, 'args'], lenaxArgs(found.config));
        } else if (argsBroken) {
          // cmd ist ok, nur die `--config=`-Args-Form korrigieren (auf positional).
          doc.setIn(['extensions', existing.key, 'args'], lenaxArgs(found.config));
        }
        if (existing.entry.timeout == null) {
          doc.setIn(['extensions', existing.key, 'timeout'], 300);
        }
        fs.writeFileSync(cfgFile, doc.toString());
        log.info(
          `[TB] LenaX-DB MCP-Eintrag repariert (${existing.key}; cmdBroken=${cmdBroken}, argsBroken=${argsBroken})`
        );
      }
      return;
    }

    if (!found && !opts.writePlaceholderIfMissing) {
      log.info('[TB] LenaX-DB MCP nicht gefunden — in den Einstellungen manuell konfigurierbar.');
      return;
    }

    // Gefunden -> echter Pfad + AKTIV (verbunden). Nicht gefunden -> Platzhalter-Pfad, aber
    // DEAKTIVIERT: so ist die Extension sichtbar/konfigurierbar, Goose versucht aber NICHT den
    // nicht existierenden Prozess zu starten (das verursachte den „Kopierfehler"/Ladefehler).
    const exe = found ? found.exe : LENAXDB_FALLBACK_EXE;
    const cfg = found ? found.config : null;

    // Neuen Eintrag anfügen, Kommentare/Reihenfolge der bestehenden Config erhalten.
    const doc = yaml.parseDocument(raw);
    doc.setIn(['extensions', 'lenax_db'], {
      enabled: !!found,
      type: 'stdio',
      name: 'LenaX-DB',
      description: found
        ? 'LenaX-DB — lokale Wissens-/RAG-Datenbank (Dateisystem-Index)'
        : 'LenaX-DB — nicht gefunden. Pfad zur mcp\\lenaxdb-mcp.exe setzen und aktivieren.',
      cmd: exe,
      args: lenaxArgs(cfg),
      // Startaufbau des Embedders (ONNX) kann einige Sekunden dauern -> großzügig.
      timeout: 300,
      env_keys: [],
      bundled: false,
    });
    fs.writeFileSync(cfgFile, doc.toString());
    log.info(
      `[TB] LenaX-DB MCP eingetragen: ${exe}${found ? '' : ' (Platzhalter — Pfad ggf. anpassen)'}${cfg ? ' (--config ' + cfg + ')' : ' (Default-Config)'}`
    );
  } catch (e) {
    log.error('[TB] LenaX-DB-Extension-Seeding fehlgeschlagen', e);
  }
}
