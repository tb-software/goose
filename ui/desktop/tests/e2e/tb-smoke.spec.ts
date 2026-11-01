import { test, expect } from './fixtures';

// TB-Software: Deterministischer E2E-Smoke fuer den Test-Service. Beweist, dass das GANZE Programm
// mit seinen Tools und Bedienelementen hochfaehrt und bedienbar ist - ohne von einer Live-Modell-
// Antwort abzuhaengen (damit reproduzierbar, auch ohne erreichbaren Provider). Die Erstlauf-Gates
// (Sicherheits-Consent + Zusatzmodul-Angebot) sind im E2E-Lauf bewusst uebersprungen
// (window.electron.isE2E via ENABLE_PLAYWRIGHT aus fixtures.ts), damit der Test das ganze Szenario
// mit allen bereitgestellten Tools direkt erreicht.
test.describe('TB-Goose Smoke (voller Start + Tools)', () => {
  test('startet das ganze Programm mit Tools und ohne Erstlauf-Gates', async ({ goosePage }) => {
    // 1. Volle App bedienbar: die Chat-Eingabe ist da (Gates sind durch).
    await goosePage.waitForSelector('[data-testid="chat-input"]', { timeout: 30000 });

    // 2. Die Erstlauf-Gates sind im Test uebersprungen (nicht im DOM).
    await expect(goosePage.getByText('Wichtige Sicherheitswarnung', { exact: false })).toHaveCount(0);
    await expect(goosePage.getByText('Vollständige Installation', { exact: false })).toHaveCount(0);

    // 3. Kern-Bedienelemente stehen bereit: Modell/Provider (bootstrapDefaults), der
    //    Qualitaetsregler (Rollen) und mindestens ein Tool-Schalter (Browser).
    await expect(goosePage.getByText(/auto:(code|chat|vision)/).first()).toBeVisible();
    await expect(goosePage.getByText('Qualität', { exact: false }).first()).toBeVisible();
    await expect(goosePage.getByText('Browser', { exact: false }).first()).toBeVisible();

    // 4. Eingabe funktioniert end-to-end bis zur Uebernahme (ohne das Modell aufzurufen).
    const chatInput = goosePage.locator('[data-testid="chat-input"]');
    await chatInput.fill('TB-Goose E2E Smoke');
    await expect(chatInput).toHaveValue('TB-Goose E2E Smoke');

    await goosePage.screenshot({
      path: test.info().outputPath('tb-smoke-voller-start.png'),
      fullPage: true,
    });
  });
});
