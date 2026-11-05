// TB-Software: Tests der Versions-Logik fuer den "Update verfuegbar"-Zustand der Zusatzmodule.
import { describe, it, expect } from 'vitest';
import { parseVersionFromUrl, compareVersions } from './moduleCatalog';

describe('parseVersionFromUrl', () => {
  it('zieht die Version aus einer Feed-Zip-URL', () => {
    expect(
      parseVersionFromUrl('https://t78.ch/apps/proxy/downloads/lenax-browser-mcp/LenaX-Browser-MCP-v0.1.1.zip')
    ).toBe('0.1.1');
  });
  it('kommt mit mehrteiligen Versionen klar', () => {
    expect(parseVersionFromUrl('https://x/y/Foo-v1.53.50.zip')).toBe('1.53.50');
    expect(parseVersionFromUrl('https://x/y/Foo-v2.0.38.0.zip')).toBe('2.0.38.0');
  });
  it('kommt mit Query-String nach .zip klar', () => {
    expect(parseVersionFromUrl('https://x/y/Foo-v0.1.1.zip?t=123')).toBe('0.1.1');
  });
  it('liefert null ohne Version im Namen', () => {
    expect(parseVersionFromUrl('https://x/y/Foo.zip')).toBeNull();
    expect(parseVersionFromUrl('https://x/y/latest.ashx')).toBeNull();
    expect(parseVersionFromUrl(null)).toBeNull();
    expect(parseVersionFromUrl(undefined)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('erkennt kleiner/gleich/groesser', () => {
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareVersions('0.1.1', '0.1.0')).toBe(1);
    expect(compareVersions('0.1.1', '0.1.1')).toBe(0);
  });
  it('vergleicht pro Segment numerisch (nicht lexikografisch)', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1); // 9 < 10
    expect(compareVersions('1.53.50', '1.53.49')).toBe(1);
  });
  it('behandelt fehlende Segmente als 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
  });

  it('Update-Regel: installiert < Feed -> Update', () => {
    const updateAvailable = (inst: string, feed: string) => compareVersions(inst, feed) < 0;
    expect(updateAvailable('0.1.0', '0.1.1')).toBe(true);
    expect(updateAvailable('0.1.1', '0.1.1')).toBe(false);
    expect(updateAvailable('0.1.2', '0.1.1')).toBe(false);
  });
});
