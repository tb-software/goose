import log from 'electron-log';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

// TB-Software: Logs möglichst NEBEN dem Programm ablegen (<Programmpfad>\logs), denn genau dort
// sucht der Anwender die Fehlermeldung — und ein Start-/Backend-Fehler ist so auch dann findbar,
// wenn die App-Menüs (Debug -> „Logs öffnen") nicht erreichbar sind. Ist der Ordner nicht
// beschreibbar (z. B. Installation unter Program Files) oder läuft die App unpaketiert (Dev),
// fällt es auf %APPDATA%\TB-Goose\logs zurück.
let cachedLogsDir: string | null = null;
export function tbLogsDir(): string {
  if (cachedLogsDir) return cachedLogsDir;
  const userDataLogs = path.join(app.getPath('userData'), 'logs');
  let chosen = userDataLogs;
  if (app.isPackaged) {
    try {
      const exeLogs = path.join(path.dirname(app.getPath('exe')), 'logs');
      fs.mkdirSync(exeLogs, { recursive: true });
      fs.accessSync(exeLogs, fs.constants.W_OK); // Schreibprobe
      chosen = exeLogs;
    } catch {
      chosen = userDataLogs;
    }
  }
  try {
    fs.mkdirSync(chosen, { recursive: true });
  } catch {
    /* ignore */
  }
  cachedLogsDir = chosen;
  return chosen;
}

log.transports.file.resolvePathFn = () => path.join(tbLogsDir(), 'main.log');

log.transports.file.level = app.isPackaged ? 'info' : 'debug';
log.transports.console.level = app.isPackaged ? false : 'debug';

export default log;
