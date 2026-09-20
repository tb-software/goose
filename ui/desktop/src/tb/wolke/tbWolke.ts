// TB-Software Milestone [13] — Wolke: IPC-Verdrahtung (Main <-> Renderer).
// Konfiguration lesen/schreiben, Bridge starten/stoppen, Live-Status pushen. Der Renderer ist reine
// Anzeige/Steuerung; die Bridge-Logik lebt in wolkeBridge.ts.
import { ipcMain, BrowserWindow } from 'electron';
import log from '../../utils/logger';
import { readWolkeConfig, writeWolkeConfig, mergeWolkeConfig, type WolkeConfig } from './wolkeConfig';
import { getWolkeStatus, onWolkeStatus, startWolke, stopWolke, type WolkeStatus } from './wolkeBridge';

function broadcast(status: WolkeStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send('tb-wolke-status', status);
    }
  }
}

export interface WolkeSnapshot {
  config: WolkeConfig;
  status: WolkeStatus;
}

export function registerTbWolkeIpc(): void {
  onWolkeStatus(broadcast);

  ipcMain.handle('tb-wolke-get', (): WolkeSnapshot => ({ config: readWolkeConfig(), status: getWolkeStatus() }));

  ipcMain.handle('tb-wolke-set-config', async (_e, patch: Partial<WolkeConfig>): Promise<WolkeSnapshot> => {
    try {
      const current = readWolkeConfig();
      const wasEnabled = current.enabled;
      const next = mergeWolkeConfig(current, patch);
      writeWolkeConfig(next);
      // enabled ist der Schalter: Übergang aus/an -> Bridge starten bzw. stoppen.
      if (next.enabled && !wasEnabled) {
        await startWolke();
      } else if (!next.enabled && wasEnabled) {
        await stopWolke();
      }
      return { config: readWolkeConfig(), status: getWolkeStatus() };
    } catch (e) {
      log.error('[TB][wolke] set-config fehlgeschlagen', e);
      return { config: readWolkeConfig(), status: getWolkeStatus() };
    }
  });

  ipcMain.handle('tb-wolke-start', async (): Promise<WolkeStatus> => {
    const cfg = readWolkeConfig();
    if (!cfg.enabled) writeWolkeConfig({ ...cfg, enabled: true });
    return startWolke();
  });

  ipcMain.handle('tb-wolke-stop', async (): Promise<WolkeStatus> => {
    const cfg = readWolkeConfig();
    if (cfg.enabled) writeWolkeConfig({ ...cfg, enabled: false });
    return stopWolke();
  });
}
