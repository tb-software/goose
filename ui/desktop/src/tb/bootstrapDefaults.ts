// TB-Software: Macht das gepackte Windows-Release out-of-the-box lauffaehig.
// 1) Setzt Default-Umgebungsvariablen fuer den LLMProxy-Betrieb (kein Secret noetig,
//    Windows-Keyring aus) — falls nicht bereits gesetzt.
// 2) Schreibt beim ERSTEN Start die mitgelieferte Standard-Config (Proxy-Endpoint,
//    Modell-Routen auto:code, Verhalten) in den Goose-Config-Ordner, sowie die
//    managed .goosehints (Durchhalte-/Budget-Direktive) — Letztere bei jedem Start
//    aktualisiert.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import log from '../utils/logger';

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

    // Managed .goosehints: mit jedem Start auf den Release-Stand bringen.
    const hintsSrc = path.join(base, 'goosehints');
    const hintsDst = path.join(cfgDir, '.goosehints');
    if (fs.existsSync(hintsSrc)) {
      fs.copyFileSync(hintsSrc, hintsDst);
    }
  } catch (e) {
    log.error('[TB] ensureTbDefaults fehlgeschlagen', e);
  }
}
