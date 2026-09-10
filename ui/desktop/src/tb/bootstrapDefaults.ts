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

function tbDefaultsDir(): string {
  // extraResource kopiert src/tb-defaults -> resources/tb-defaults (gepackt).
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tb-defaults')
    : path.join(app.getAppPath(), 'src', 'tb-defaults');
}

export function ensureTbDefaults(): void {
  // (1) Env-Defaults — nur setzen, wenn der Nutzer/Starter nichts vorgegeben hat.
  if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'none';
  if (!process.env.GOOSE_DISABLE_KEYRING) process.env.GOOSE_DISABLE_KEYRING = 'true';

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

    // LenaX-DB MCP standardmäßig verbinden (Pfad automatisch suchen; nicht gefunden ->
    // in den Einstellungen manuell konfigurierbar).
    ensureLenaxDbExtension(cfgDir);
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

// Sucht die lenaxdb-mcp.exe an den üblichen Installationsorten. Override per
// Umgebungsvariable LENAXDB_MCP_EXE (voller Pfad zur exe).
function discoverLenaxDbMcp(): LenaxDbLocation | null {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

  const candidates = [
    process.env.LENAXDB_MCP_EXE,
    'C:\\_AI\\Applications\\LenaX-DB\\mcp\\lenaxdb-mcp.exe',
    path.join(localAppData, 'Programs', 'LenaX-DB', 'mcp', 'lenaxdb-mcp.exe'),
    path.join(localAppData, 'LenaX-DB', 'mcp', 'lenaxdb-mcp.exe'),
    path.join(programFiles, 'LenaX-DB', 'mcp', 'lenaxdb-mcp.exe'),
  ].filter((c): c is string => !!c);

  const exe = candidates.find((c) => {
    try {
      return fs.existsSync(c) && fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });
  if (!exe) return null;

  // Config-Pfad (gemeinsam mit dem Cockpit). Fehlt sie, startet die MCP mit Default-Config.
  const cfg = path.join(localAppData, 'LenaXDB', 'config.json');
  return { exe, config: fs.existsSync(cfg) ? cfg : null };
}

// Prüft, ob in der Goose-Config bereits eine LenaX-DB-Extension existiert (Key oder Name).
function hasLenaxExtension(parsed: unknown): boolean {
  const exts = (parsed as { extensions?: Record<string, { name?: string }> })?.extensions;
  if (!exts || typeof exts !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(exts, 'lenax_db')) return true;
  return Object.values(exts).some(
    (e) => typeof e?.name === 'string' && /lenax/i.test(e.name)
  );
}

export function ensureLenaxDbExtension(cfgDir: string): void {
  try {
    const cfgFile = path.join(cfgDir, 'config.yaml');
    if (!fs.existsSync(cfgFile)) return; // Config wird zuvor geseedet; ohne sie nichts zu tun.

    const raw = fs.readFileSync(cfgFile, 'utf8');
    const parsed = yaml.parse(raw) ?? {};

    // Bereits vorhanden (auch deaktiviert) -> Nutzer-Entscheidung respektieren.
    if (hasLenaxExtension(parsed)) return;

    const found = discoverLenaxDbMcp();
    if (!found) {
      log.info(
        '[TB] LenaX-DB MCP nicht gefunden — in den Einstellungen manuell konfigurierbar.'
      );
      return;
    }

    // Eintrag anfügen, Kommentare/Reihenfolge der bestehenden Config erhalten.
    const doc = yaml.parseDocument(raw);
    doc.setIn(['extensions', 'lenax_db'], {
      enabled: true,
      type: 'stdio',
      name: 'LenaX-DB',
      description: 'LenaX-DB — lokale Wissens-/RAG-Datenbank (Dateisystem-Index)',
      cmd: found.exe,
      args: found.config ? [found.config] : [],
      // Startaufbau des Embedders (ONNX) kann einige Sekunden dauern -> großzügig.
      timeout: 300,
      env_keys: [],
      bundled: false,
    });
    fs.writeFileSync(cfgFile, doc.toString());
    log.info(
      `[TB] LenaX-DB MCP standardmäßig verbunden: ${found.exe}${found.config ? ' (Config: ' + found.config + ')' : ' (Default-Config)'}`
    );
  } catch (e) {
    log.error('[TB] LenaX-DB-Extension-Seeding fehlgeschlagen', e);
  }
}
