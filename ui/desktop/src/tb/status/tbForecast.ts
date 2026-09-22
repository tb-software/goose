// TB-Software Milestone [16] — Teil C: einmaliger, kleiner auto:chat-Call zur Restzeit-Schätzung.
// Läuft im Main-Prozess, weil dort die Proxy-Zugangsdaten als process.env vorliegen (ensureTbDefaults).
// Der Aufruf geht an denselben OpenAI-kompatiblen Endpunkt wie der openai-Provider von goose.
import { ipcMain, net } from 'electron';
import log from '../../utils/logger';

interface ForecastArgs {
  task: string;
  elapsedS: number;
  phase: string;
}
export interface ForecastResult {
  ok: boolean;
  text?: string;
  error?: string;
}

// "K=V,K2=V2" -> Header-Objekt (z. B. die TB-Client-Identity-Header fürs Monitoring).
function parseCustomHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) out[k] = v;
    }
  }
  return out;
}

function completionsUrl(): string | null {
  const host = (process.env.OPENAI_HOST || '').replace(/\/+$/, '');
  const basePath = (process.env.OPENAI_BASE_PATH || '').replace(/^\/+/, '');
  if (!host || !basePath) return null;
  return `${host}/${basePath}`;
}

export function registerTbForecastIpc(): void {
  ipcMain.handle('tb-forecast', async (_e, args: ForecastArgs): Promise<ForecastResult> => {
    try {
      const url = completionsUrl();
      if (!url) return { ok: false, error: 'proxy-config-fehlt' };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'none'}`,
        ...parseCustomHeaders(process.env.OPENAI_CUSTOM_HEADERS),
      };

      const body = {
        model: 'auto:chat',
        temperature: 0,
        max_tokens: 12,
        messages: [
          {
            role: 'system',
            content:
              'Du schätzt knapp, wie viele Sekunden eine bereits laufende KI-Aufgabe noch dauert. ' +
              'Antworte NUR mit einer ganzen Zahl (verbleibende Sekunden), ohne Einheit, ohne Erklärung.',
          },
          {
            role: 'user',
            content:
              `Aufgabe: ${args.task || '(unbekannt)'}\n` +
              `Läuft seit ${args.elapsedS} Sekunden. Aktuelle Phase: ${args.phase}.\n` +
              'Geschätzte verbleibende Sekunden?',
          },
        ],
      };

      const res = await net.fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) return { ok: false, error: `http_${res.status}` };
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data?.choices?.[0]?.message?.content ?? '';
      return { ok: true, text };
    } catch (e) {
      log.warn?.('[TB][forecast] Call fehlgeschlagen', e);
      return { ok: false, error: String(e) };
    }
  });
}
