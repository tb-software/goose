// TB-Software: Qualitaetsregler Phase A - die 10 Testfaelle (zugleich Gegen-Tests).
// Siehe milestone[19]/_Documents/02_Qualitaetsregler-10-Testfaelle.md
import { describe, it, expect, vi } from 'vitest';
import { qualityParams, clampStufe, HARD_CEILING_MS } from './qualityPolicy';
import { selectRoles, DEFAULT_ROLES } from './roles';
import { composeQualityHint, composeQualityBody, upsertMarkerBlock } from './composeHints';

const roleIds = (topic: string | string[], stufe: number, mode: 'auto' | 'manuell' = 'auto', manualIds?: string[]) =>
  selectRoles({ topic, params: qualityParams(stufe), mode, manualIds }).map((r) => r.id);

describe('Qualitaetsregler - 10 Testfaelle', () => {
  // 1
  it('Stufe 1 = heutiges Verhalten: keine Rollen, lenax aus, smart_approve, leerer Hint', () => {
    const p = qualityParams(1);
    expect(p.lenaxIntensity).toBe(0);
    expect(p.reviewerRounds).toBe(0);
    expect(p.loopBudget).toBe(0);
    expect(p.autonomie).toBe('smart_approve');
    expect(p.rollenTiefe).toBe('keine');
    const roles = selectRoles({ topic: 'code', params: p, mode: 'auto' });
    expect(roles).toHaveLength(0);
    // Gegentest: kein Rollen-/Qualitaets-Block injiziert.
    expect(composeQualityHint(p, roles)).toBe('');
  });

  // 2
  it('Stufe 10 = Maximum; Stufe 11 ueberschreitet nichts (Clamping)', () => {
    const p = qualityParams(10);
    expect(p.reviewerRounds).toBe(5);
    expect(p.autonomie).toBe('auto');
    expect(p.alleRollen).toBe(true);
    expect(p.nachfassen).toBe(true);
    expect(qualityParams(11)).toEqual(p); // kein Wert ueber den Grenzen
  });

  // 3
  it('Monotonie: keine fallenden Werte mit steigender Stufe', () => {
    const keys = ['lenaxIntensity', 'reviewerRounds', 'loopBudget', 'tokenCap', 'timeCapMs'] as const;
    for (let s = 2; s <= 10; s++) {
      const a = qualityParams(s - 1);
      const b = qualityParams(s);
      for (const k of keys) {
        expect(b[k], `${k} bei Stufe ${s} < Stufe ${s - 1}`).toBeGreaterThanOrEqual(a[k]);
      }
    }
  });

  // 4
  it('Autonomie-Schwelle bei Stufe 4', () => {
    for (let s = 1; s <= 3; s++) expect(qualityParams(s).autonomie).toBe('smart_approve');
    for (let s = 4; s <= 10; s++) expect(qualityParams(s).autonomie).toBe('auto');
    // Gegentest
    expect(qualityParams(3).autonomie).not.toBe('auto');
    expect(qualityParams(4).autonomie).not.toBe('smart_approve');
  });

  // 5
  it('Clamping und Rundung ungueltiger Stufen', () => {
    expect(clampStufe(0)).toBe(1);
    expect(clampStufe(-5)).toBe(1);
    expect(clampStufe(11)).toBe(10);
    expect(clampStufe(3.7)).toBe(4);
    expect(clampStufe(Number.NaN)).toBe(1);
    expect(qualityParams(0)).toEqual(qualityParams(1));
    expect(qualityParams(11)).toEqual(qualityParams(10));
    expect(qualityParams(3.7)).toEqual(qualityParams(4));
  });

  // 6
  it('Themen-Auswahl (Automatik): code gegen offerte', () => {
    const code = roleIds('code', 6);
    expect(code).toContain('code-reviewer');
    expect(code).toContain('qs-test');
    expect(code).toContain('sicherheits-pruefer');

    const offerte = roleIds('offerte', 6);
    expect(offerte).toContain('lektor');
    expect(offerte).toContain('vollstaendigkeit');
    // Gegentest: themenfremde Nicht-always-Rolle nicht dabei.
    expect(offerte).not.toContain('code-reviewer');
  });

  // 7
  it('always-Rollen ab minStufe immer dabei, darunter nicht', () => {
    // Sicherheits-Pruefer (minStufe 2) und Wissens-Rechercheur (minStufe 2)
    for (const topic of ['code', 'offerte', 'irgendwas']) {
      for (let s = 2; s <= 10; s++) {
        const ids = roleIds(topic, s);
        expect(ids, `Stufe ${s} / ${topic}`).toContain('sicherheits-pruefer');
        expect(ids).toContain('wissens-rechercheur');
      }
    }
    // Unter minStufe (Stufe 1) nicht dabei.
    expect(roleIds('code', 1)).not.toContain('sicherheits-pruefer');
  });

  // 8
  it('Manueller Modus: nur statische Wahl + always, Klassifikator nicht aufgerufen', () => {
    const onClassify = vi.fn();
    const roles = selectRoles({
      topic: 'code',
      params: qualityParams(8),
      mode: 'manuell',
      manualIds: ['lektor'],
      onClassify,
    });
    const ids = roles.map((r) => r.id);
    expect(ids).toContain('lektor');
    expect(ids).toContain('sicherheits-pruefer'); // always bleibt aus Sicherheitsgruenden
    expect(ids).toContain('wissens-rechercheur'); // always
    expect(ids).not.toContain('code-reviewer'); // nicht statisch gewaehlt
    expect(onClassify).not.toHaveBeenCalled(); // Automatik-Pfad nicht betreten
  });

  // 9
  it('Hint-Komposition und idempotenter Upsert', () => {
    const p = qualityParams(6);
    const roles = selectRoles({ topic: 'code', params: p, mode: 'auto' });
    const body = composeQualityBody(p, roles);
    expect(body).toMatch(/lenax-db/i);
    expect(body).toContain('Code-Reviewer');
    expect(body).toContain('Sicherheits-Prüfer');
    // Stufe 1 -> leer
    expect(composeQualityHint(qualityParams(1), [])).toBe('');

    // Idempotenz: zweimaliges Einsetzen ergibt denselben Text, kein doppelter Block.
    const block = composeQualityHint(p, roles);
    const base = 'Projekt-Hinweise.\n';
    const once = upsertMarkerBlock(base, block);
    const twice = upsertMarkerBlock(once, block);
    expect(twice).toBe(once);
    expect((twice.match(/TB-QUALITY:START/g) || []).length).toBe(1);
    // Leerer Block entfernt den vorhandenen wieder.
    expect(upsertMarkerBlock(once, '')).toBe('Projekt-Hinweise.');
  });

  // 10
  it('Deckel und Budget: immer gesetzt, timeCap <= harte Obergrenze, Stufe 1 am engsten', () => {
    for (let s = 1; s <= 10; s++) {
      const p = qualityParams(s);
      expect(p.tokenCap).toBeGreaterThan(0);
      expect(p.timeCapMs).toBeGreaterThan(0);
      expect(p.timeCapMs).toBeLessThanOrEqual(HARD_CEILING_MS);
    }
    const caps = Array.from({ length: 10 }, (_, i) => qualityParams(i + 1).tokenCap);
    expect(Math.min(...caps)).toBe(qualityParams(1).tokenCap);
  });
});

describe('Rollen-Katalog Konsistenz', () => {
  it('eindeutige IDs und gueltige minStufe', () => {
    const ids = DEFAULT_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DEFAULT_ROLES) {
      expect(r.minStufe).toBeGreaterThanOrEqual(1);
      expect(r.minStufe).toBeLessThanOrEqual(10);
      expect(r.topics.length).toBeGreaterThan(0);
    }
  });
});
