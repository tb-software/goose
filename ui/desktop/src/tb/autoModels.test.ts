import { describe, it, expect } from 'vitest';
import { mergeModels } from './autoModels';
import type Model from '../components/settings/models/modelInterface';

const base: Model[] = [
  { name: 'auto:code', provider: 'openai', alias: 'Auto: Code', subtext: 'Standard' },
  { name: 'auto:chat', provider: 'openai', alias: 'Auto: Chat', subtext: 'Chat' },
  { name: 'auto:vision', provider: 'openai', alias: 'Auto: Vision', subtext: 'Bilder' },
];

describe('mergeModels', () => {
  it('ohne Zusatz/Ausblenden bleibt die Basis unveraendert', () => {
    const out = mergeModels(base, [], []);
    expect(out.map((m) => m.name)).toEqual(['auto:code', 'auto:chat', 'auto:vision']);
  });

  it('blendet Live-Tags via hide aus (Reduktion auf code/chat)', () => {
    const out = mergeModels(base, [], ['auto:vision']);
    expect(out.map((m) => m.name)).toEqual(['auto:code', 'auto:chat']);
  });

  it('haengt neue Zusatzmodelle hinten an und setzt openai-Provider', () => {
    const out = mergeModels(base, [{ id: 'qwen3.8-27b-tbs', alias: 'Qwen3.8 27B', subtext: 'Konkret' }], []);
    expect(out.map((m) => m.name)).toEqual(['auto:code', 'auto:chat', 'auto:vision', 'qwen3.8-27b-tbs']);
    const extra = out.find((m) => m.name === 'qwen3.8-27b-tbs')!;
    expect(extra.provider).toBe('openai');
    expect(extra.alias).toBe('Qwen3.8 27B');
  });

  it('dedupliziert: gleiche ID erscheint nur einmal (Basis-Duplikat)', () => {
    const dup = [...base, { name: 'auto:code', provider: 'openai', alias: 'Doppelt' } as Model];
    const out = mergeModels(dup, [], []);
    expect(out.filter((m) => m.name === 'auto:code')).toHaveLength(1);
  });

  it('ein Zusatzeintrag mit vorhandener ID benennt nur um, dupliziert nicht', () => {
    const out = mergeModels(base, [{ id: 'auto:chat', alias: 'Auto: Chat (schnell)' }], []);
    expect(out.filter((m) => m.name === 'auto:chat')).toHaveLength(1);
    expect(out.find((m) => m.name === 'auto:chat')!.alias).toBe('Auto: Chat (schnell)');
  });

  it('hide schlaegt Zusatz: eine ausgeblendete ID erscheint auch als Extra nicht', () => {
    const out = mergeModels(base, [{ id: 'auto:vision', alias: 'X' }], ['auto:vision']);
    expect(out.some((m) => m.name === 'auto:vision')).toBe(false);
  });

  it('Zusatzmodell mit eigenem provider routet nicht ueber openai', () => {
    const out = mergeModels(
      base,
      [{ id: 'deepseek-v4-flash', alias: 'DeepSeek Flash', provider: 'custom_deepseek' }],
      []
    );
    const ds = out.find((m) => m.name === 'deepseek-v4-flash')!;
    expect(ds.provider).toBe('custom_deepseek');
  });
});
