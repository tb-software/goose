// TB-Software: Qualitaetsregler - Integrationstest der ausgelieferten Verdrahtung.
// Faehrt applyQualityHint() gegen ein echtes Temp-.goosehints (APPDATA umgelenkt) und prueft
// Koexistenz mit dem Canvio-Block, Idempotenz, Stufenwechsel und das Entfernen bei Stufe 1.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyQualityHint, qualityConfigDir, rolesForConfig } from './qualityApply';
import { writeQualityConfig, type QualityConfig } from './qualityConfig';

const CANVIO_BLOCK = '<!-- TB-CANVIO:START -->\nCanvio: extract/convert ueber den Online-Konverter.\n<!-- TB-CANVIO:END -->';
const USER_TEXT = 'Projekt-Hinweise des Nutzers.\nImmer verifizieren.';

let tmp: string;
let hintsFile: string;
let savedAppData: string | undefined;

function seedHints(content: string) {
  fs.mkdirSync(qualityConfigDir(), { recursive: true });
  fs.writeFileSync(hintsFile, content);
}
function readHints(): string {
  return fs.existsSync(hintsFile) ? fs.readFileSync(hintsFile, 'utf8') : '';
}
function cfg(patch: Partial<QualityConfig>): QualityConfig {
  const c: QualityConfig = { stufe: 3, mode: 'auto', manualRoleIds: [], ...patch };
  writeQualityConfig(c);
  return c;
}

beforeEach(() => {
  savedAppData = process.env.APPDATA;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tbq-'));
  process.env.APPDATA = tmp;
  hintsFile = path.join(qualityConfigDir(), '.goosehints');
});
afterEach(() => {
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('Qualitaetsregler - Verdrahtung in .goosehints (Integration)', () => {
  it('Stufe 3 schreibt genau einen TB-QUALITY-Block', () => {
    const changed = applyQualityHint(cfg({ stufe: 3 }));
    expect(changed).toBe(true);
    const h = readHints();
    expect((h.match(/TB-QUALITY:START/g) || []).length).toBe(1);
    expect(h).toContain('Qualitätsstufe 3');
  });

  it('laesst Nutzertext und den Canvio-Block unangetastet', () => {
    seedHints(`${USER_TEXT}\n\n${CANVIO_BLOCK}\n`);
    applyQualityHint(cfg({ stufe: 6 }));
    const h = readHints();
    expect(h).toContain('Projekt-Hinweise des Nutzers.');
    expect(h).toContain('TB-CANVIO:START');
    expect(h).toContain('Canvio: extract/convert');
    expect((h.match(/TB-QUALITY:START/g) || []).length).toBe(1);
    expect((h.match(/TB-CANVIO:START/g) || []).length).toBe(1);
  });

  it('ist idempotent: zweiter Aufruf aendert nichts', () => {
    seedHints(`${USER_TEXT}\n\n${CANVIO_BLOCK}\n`);
    expect(applyQualityHint(cfg({ stufe: 8 }))).toBe(true);
    const first = readHints();
    expect(applyQualityHint(cfg({ stufe: 8 }))).toBe(false); // keine Aenderung
    expect(readHints()).toBe(first);
  });

  it('Stufenwechsel ersetzt den Block, kein Doppelblock', () => {
    applyQualityHint(cfg({ stufe: 3 }));
    applyQualityHint(cfg({ stufe: 9 }));
    const h = readHints();
    expect((h.match(/TB-QUALITY:START/g) || []).length).toBe(1);
    expect(h).toContain('Qualitätsstufe 9');
    expect(h).not.toContain('Qualitätsstufe 3');
  });

  it('Stufe 1 entfernt den Block wieder, Nutzertext + Canvio bleiben', () => {
    seedHints(`${USER_TEXT}\n\n${CANVIO_BLOCK}\n`);
    applyQualityHint(cfg({ stufe: 7 }));
    expect(readHints()).toContain('TB-QUALITY:START');
    applyQualityHint(cfg({ stufe: 1 }));
    const h = readHints();
    expect(h).not.toContain('TB-QUALITY:START');
    expect(h).toContain('Projekt-Hinweise des Nutzers.');
    expect(h).toContain('TB-CANVIO:START');
  });

  it('Manueller Modus: nur gewaehlte Rollen + always im Block', () => {
    const c = cfg({ stufe: 8, mode: 'manuell', manualRoleIds: ['lektor'] });
    applyQualityHint(c);
    const h = readHints();
    const names = rolesForConfig(c).map((r) => r.name);
    expect(names).toContain('Lektor');
    expect(names).toContain('Sicherheits-Prüfer'); // always
    expect(names).not.toContain('Code-Reviewer');
    expect(h).toContain('Lektor');
    expect(h).not.toContain('Code-Reviewer');
  });

  it('hoehere Stufe nennt mehr Rollen und die lenax-db-Anweisung', () => {
    const c3 = cfg({ stufe: 3 });
    const n3 = rolesForConfig(c3).length;
    applyQualityHint(c3);
    const c9 = cfg({ stufe: 9 });
    const n9 = rolesForConfig(c9).length;
    applyQualityHint(c9);
    expect(n9).toBeGreaterThan(n3);
    expect(readHints()).toMatch(/lenax-db/i);
  });
});
