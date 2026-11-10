// TB-Software: Bruecke von einem benutzerfreundlichen config.yaml-Block (tb_providers) zu goose's
// NATIVEM Custom-Provider-Format (eine JSON-Datei je Provider unter
// %APPDATA%\Block\goose\config\custom_providers\<id>.json). Damit lassen sich FREMDE
// openai-kompatible Endpunkte (eigener Server, api.deepseek.com, ein anderer Proxy-Tenant ...)
// neben dem Standard-t78-Gateway nutzen - ganz ohne Backend-Aenderung (goose registriert die
// Dateien beim Start selbst, siehe crates/goose/src/config/declarative_providers.rs).
//
// Diese Datei ist REIN (kein electron/node-fs), damit die Erzeugung mit vitest geprueft werden kann.

export interface TbProviderModelInput {
  name: string;
  context_limit?: number;
  reasoning?: boolean;
  // Kosten pro 1 Token (wie goose ModelInfo). Fuer die Kosten-/Nutzungsanzeige. Optional.
  input_token_cost?: number;
  output_token_cost?: number;
  currency?: string;
}

export interface TbProviderInput {
  id: string; // kurzer Schluessel, z. B. "deepseek" -> Provider "custom_deepseek"
  name?: string; // Anzeigename; default = id
  base_url: string; // z. B. https://api.deepseek.com/v1
  api_key?: string; // optional; wenn gesetzt -> requires_auth + Secret
  models: Array<string | TbProviderModelInput>;
  headers?: Record<string, string>;
  supports_streaming?: boolean;
}

// goose: der Provider-Name/-id muss mit Kleinbuchstabe/Ziffer/'_' beginnen und darf nur
// [a-z0-9_-] enthalten (validate_provider_id). Wir praefixen immer "custom_" (wie die UI).
export function normalizeProviderId(rawId: string): string {
  const slug = (rawId || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `custom_${slug || 'provider'}`;
}

// Muss generate_api_key_name() aus declarative_providers.rs entsprechen: <ID>_API_KEY in Grossbuchstaben.
export function apiKeyEnvName(providerId: string): string {
  return `${providerId.toUpperCase()}_API_KEY`;
}

export interface BuiltCustomProvider {
  id: string;
  fileName: string; // <id>.json
  apiKeyEnv: string | null; // Secret-Name in secrets.yaml, falls Key gesetzt
  apiKey: string | null;
  config: Record<string, unknown>; // DeclarativeProviderConfig (snake_case) fuer die JSON-Datei
}

// Baut die native Custom-Provider-Konfiguration. engine bleibt "openai" (openai-kompatibel).
export function buildCustomProvider(input: TbProviderInput): BuiltCustomProvider {
  const id = normalizeProviderId(input.id);
  const hasKey = typeof input.api_key === 'string' && input.api_key.trim().length > 0;
  const apiKeyEnv = hasKey ? apiKeyEnvName(id) : null;

  const models = (input.models ?? [])
    .map((m) => {
      if (typeof m === 'string') {
        const name = m.trim();
        return name ? { name } : null;
      }
      if (m && typeof m === 'object' && typeof m.name === 'string' && m.name.trim()) {
        const out: Record<string, unknown> = { name: m.name.trim() };
        if (typeof m.context_limit === 'number') out.context_limit = m.context_limit;
        if (typeof m.reasoning === 'boolean') out.reasoning = m.reasoning;
        if (typeof m.input_token_cost === 'number') out.input_token_cost = m.input_token_cost;
        if (typeof m.output_token_cost === 'number') out.output_token_cost = m.output_token_cost;
        if (typeof m.currency === 'string') out.currency = m.currency;
        return out;
      }
      return null;
    })
    .filter((m): m is Record<string, unknown> => m != null);

  const config: Record<string, unknown> = {
    name: id,
    engine: 'openai',
    display_name: (input.name || input.id || id).trim(),
    description: 'TB-Software: eigener openai-kompatibler Endpunkt (tb_providers)',
    api_key_env: apiKeyEnv ?? '',
    base_url: (input.base_url || '').trim(),
    models,
    headers: input.headers && Object.keys(input.headers).length > 0 ? input.headers : null,
    timeout_seconds: null,
    supports_streaming: input.supports_streaming ?? true,
    requires_auth: hasKey,
    // Genau die angegebenen Modelle zeigen (keine Katalog-Filterung fremder IDs).
    skip_canonical_filtering: true,
  };

  return {
    id,
    fileName: `${id}.json`,
    apiKeyEnv,
    apiKey: hasKey ? (input.api_key as string).trim() : null,
    config,
  };
}

// Normalisiert den rohen tb_providers-Wert aus der config.yaml zu geprueften Eintraegen.
export function parseTbProviders(raw: unknown): TbProviderInput[] {
  if (!Array.isArray(raw)) return [];
  const out: TbProviderInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const base_url = typeof o.base_url === 'string' ? o.base_url.trim() : '';
    if (!id || !base_url) continue;
    const modelsRaw = Array.isArray(o.models) ? o.models : [];
    const models = modelsRaw
      .map((m) => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object') {
          const mo = m as Record<string, unknown>;
          if (typeof mo.name === 'string')
            return {
              name: mo.name,
              context_limit: typeof mo.context_limit === 'number' ? mo.context_limit : undefined,
              reasoning: typeof mo.reasoning === 'boolean' ? mo.reasoning : undefined,
              input_token_cost:
                typeof mo.input_token_cost === 'number' ? mo.input_token_cost : undefined,
              output_token_cost:
                typeof mo.output_token_cost === 'number' ? mo.output_token_cost : undefined,
              currency: typeof mo.currency === 'string' ? mo.currency : undefined,
            } as TbProviderModelInput;
        }
        return null;
      })
      .filter((m): m is string | TbProviderModelInput => m != null);
    out.push({
      id,
      name: typeof o.name === 'string' ? o.name : undefined,
      base_url,
      api_key: typeof o.api_key === 'string' ? o.api_key : undefined,
      models,
      headers:
        o.headers && typeof o.headers === 'object'
          ? (o.headers as Record<string, string>)
          : undefined,
      supports_streaming:
        typeof o.supports_streaming === 'boolean' ? o.supports_streaming : undefined,
    });
  }
  return out;
}
