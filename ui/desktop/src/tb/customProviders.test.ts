import { describe, it, expect } from 'vitest';
import {
  normalizeProviderId,
  apiKeyEnvName,
  buildCustomProvider,
  parseTbProviders,
} from './customProviders';

describe('normalizeProviderId', () => {
  it('praefixt custom_ und sanitisiert', () => {
    expect(normalizeProviderId('DeepSeek')).toBe('custom_deepseek');
    expect(normalizeProviderId('api.deepseek')).toBe('custom_api_deepseek');
    expect(normalizeProviderId('')).toBe('custom_provider');
  });
});

describe('apiKeyEnvName', () => {
  it('entspricht generate_api_key_name (<ID>_API_KEY, gross)', () => {
    expect(apiKeyEnvName('custom_deepseek')).toBe('CUSTOM_DEEPSEEK_API_KEY');
  });
});

describe('buildCustomProvider', () => {
  it('baut eine gueltige openai-Provider-Config mit Key', () => {
    const built = buildCustomProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: 'sk-abc',
      models: ['deepseek-v4-flash', { name: 'deepseek-v4-pro', context_limit: 131072 }],
    });
    expect(built.id).toBe('custom_deepseek');
    expect(built.fileName).toBe('custom_deepseek.json');
    expect(built.apiKeyEnv).toBe('CUSTOM_DEEPSEEK_API_KEY');
    expect(built.apiKey).toBe('sk-abc');
    expect(built.config.engine).toBe('openai');
    expect(built.config.requires_auth).toBe(true);
    expect(built.config.api_key_env).toBe('CUSTOM_DEEPSEEK_API_KEY');
    expect(built.config.base_url).toBe('https://api.deepseek.com/v1');
    expect(built.config.skip_canonical_filtering).toBe(true);
    const models = built.config.models as Array<Record<string, unknown>>;
    expect(models).toEqual([
      { name: 'deepseek-v4-flash' },
      { name: 'deepseek-v4-pro', context_limit: 131072 },
    ]);
  });

  it('ohne Key: requires_auth=false, kein Secret-Name', () => {
    const built = buildCustomProvider({
      id: 'lokal',
      base_url: 'http://127.0.0.1:1234/v1',
      models: ['glm-4.6'],
    });
    expect(built.config.requires_auth).toBe(false);
    expect(built.config.api_key_env).toBe('');
    expect(built.apiKeyEnv).toBeNull();
    expect(built.apiKey).toBeNull();
  });
});

describe('parseTbProviders', () => {
  it('ignoriert Eintraege ohne id oder base_url', () => {
    const out = parseTbProviders([
      { id: 'ok', base_url: 'https://x/v1', models: ['m'] },
      { id: 'kein-url', models: ['m'] },
      { base_url: 'https://y/v1', models: ['m'] },
      'quatsch',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ok');
  });

  it('gibt leeres Array bei Nicht-Array', () => {
    expect(parseTbProviders(undefined)).toEqual([]);
    expect(parseTbProviders({})).toEqual([]);
  });
});
