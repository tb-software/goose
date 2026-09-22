// TB-Software Milestone [16]: Tests der Prognose-Logik.
import { describe, it, expect } from 'vitest';
import {
  derivePhase,
  median,
  estimateTurnMs,
  remainingMs,
  shouldAiForecast,
  fmtDuration,
  parseForecastSeconds,
} from './forecast';

describe('derivePhase', () => {
  it('priorisiert warten > verarbeitung > antwort > anfrage', () => {
    expect(derivePhase({ waitingForUserInput: true, toolActive: true, hasResponseText: true })).toBe('warten');
    expect(derivePhase({ waitingForUserInput: false, toolActive: true, hasResponseText: true })).toBe('verarbeitung');
    expect(derivePhase({ waitingForUserInput: false, toolActive: false, hasResponseText: true })).toBe('antwort');
    expect(derivePhase({ waitingForUserInput: false, toolActive: false, hasResponseText: false })).toBe('anfrage');
  });
});

describe('median / estimateTurnMs', () => {
  it('median gerade/ungerade', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([1, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
  });
  it('estimateTurnMs: null unter minSamples, sonst Median der letzten', () => {
    expect(estimateTurnMs([1000, 2000], 3)).toBeNull();
    expect(estimateTurnMs([1000, 2000, 3000], 3)).toBe(2000);
    const many = Array.from({ length: 60 }, (_, i) => (i < 10 ? 100000 : 2000)); // alte Ausreißer fallen aus dem Fenster
    expect(estimateTurnMs(many, 3, 50)).toBe(2000);
  });
});

describe('remainingMs', () => {
  it('null ohne Schätzung, sonst nicht negativ', () => {
    expect(remainingMs(null, 5000)).toBeNull();
    expect(remainingMs(10000, 3000)).toBe(7000);
    expect(remainingMs(10000, 15000)).toBe(0);
  });
});

describe('shouldAiForecast', () => {
  it('Schätzung > Schwelle', () => {
    expect(shouldAiForecast(90000, 0, 60000)).toBe(true);
    expect(shouldAiForecast(30000, 0, 60000)).toBe(false);
  });
  it('ohne Schätzung: erst wenn lange gelaufen', () => {
    expect(shouldAiForecast(null, 70000, 60000)).toBe(true);
    expect(shouldAiForecast(null, 10000, 60000)).toBe(false);
  });
});

describe('fmtDuration', () => {
  it('m:ss', () => {
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(9000)).toBe('0:09');
    expect(fmtDuration(90000)).toBe('1:30');
    expect(fmtDuration(-5)).toBe('0:00');
  });
});

describe('parseForecastSeconds', () => {
  it('erkennt mm:ss, Minuten, Sekunden, blanke Zahl', () => {
    expect(parseForecastSeconds('1:30')).toBe(90);
    expect(parseForecastSeconds('etwa 2 Minuten')).toBe(120);
    expect(parseForecastSeconds('~45 Sekunden')).toBe(45);
    expect(parseForecastSeconds('90')).toBe(90);
    expect(parseForecastSeconds('keine Ahnung')).toBeNull();
  });
});
