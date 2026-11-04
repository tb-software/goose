import { test, expect } from './fixtures';

// TB-Software: E2E fuer den Pfad-Link-Fix (Timo-Meldung 04.11.: Klick landete im falschen Ordner,
// statt die Datei zu markieren). Fuehrt die ECHTE IPC-Kette aus - Renderer ruft window.electron.
// tbResolveFile auf, der Main-Prozess loest gegen das REALE Dateisystem auf (resolveWorkspaceFile
// inkl. longestExistingPrefix). Das ist die Integrationsgrenze, die die Unit-Tests (mock-fs) NICHT
// abdecken. Deterministisch, kein Modell noetig. Zielordner existiert real auf diesem Rechner.
test.describe('TB-Goose Pfad-Aufloesung (echte IPC + echtes FS)', () => {
  test('loest endungslosen Pfad mit Leerzeichen + Fliesstext-Ueberhang auf die reale Datei auf', async ({
    goosePage,
  }) => {
    await goosePage.waitForSelector('[data-testid="chat-input"]', { timeout: 30000 });

    // Realer, endungsloser Ordner mit Leerzeichen (Screenshot-Fall "Noah 6. Geburtstag").
    const realDir = 'D:\\NextCloud\\Familie\\Noah 6. Geburtstag';

    const results = await goosePage.evaluate(async (dir) => {
      const call = (raw: string) =>
        (window as unknown as {
          electron: { tbResolveFile?: (r: string) => Promise<{ ok: boolean; path: string | null; reason: string }> };
        }).electron.tbResolveFile?.(raw);
      return {
        exact: await call(dir),
        // Pfad mitten im Satz: frueher am ersten Leerzeichen abgeschnitten -> falscher Ordner.
        mitUeberhang: await call(dir + ' und 339 MB'),
        // Nicht existente Datei IM realen Ordner -> Rueckfall auf den existierenden Elternordner.
        dateiImOrdner: await call(dir + '\\gibtsnicht_screenshot.psd'),
      };
    }, realDir);

    // 1. Exakter Pfad -> exists, unveraendert.
    expect(results.exact?.ok).toBe(true);
    expect(results.exact?.path).toBe(realDir);
    expect(results.exact?.reason).toBe('exists');

    // 2. Fliesstext-Ueberhang wird weggeschnitten, der volle Pfad bleibt erhalten (KEIN Abschnitt
    //    am ersten Leerzeichen -> genau der frueher kaputte Fall).
    expect(results.mitUeberhang?.ok).toBe(true);
    expect(results.mitUeberhang?.path).toBe(realDir);

    // 3. Nicht existente Datei faellt auf den real existierenden Ordner zurueck (statt Sackgasse).
    expect(results.dateiImOrdner?.ok).toBe(true);
    expect(results.dateiImOrdner?.path).toBe(realDir);
  });
});
