// TB-Software: baut die auto:*-Modell-Liste fuer das Dropdown DYNAMISCH aus der Gateway-Antwort
// (/v1/models, via main-IPC tb-auto-models). Neue Kategorien (z. B. auto:fast) erscheinen damit
// automatisch, ohne statische Pflege. Beschreibungen sind NEUTRAL (kein konkretes Backend-Modell,
// da das Gateway dynamisch routet - "Qwen"/"Mistral" waere irrefuehrend). Faellt bei Fehler/Offline
// auf die gebuendelte Liste (GOOSE_PREDEFINED_MODELS) zurueck.
import type Model from '../components/settings/models/modelInterface';
import { getPredefinedModelsFromEnv } from '../components/settings/models/predefinedModelsUtils';

interface Meta {
  alias: string;
  subtext: string;
  contextLimit?: number;
  reasoning?: boolean;
}

const META: Record<string, Meta> = {
  'auto:code': {
    alias: 'Auto: Code',
    subtext: 'Coding, Werkzeuge, starkes Reasoning · Standard',
    contextLimit: 262144,
    reasoning: true,
  },
  'auto:chat': { alias: 'Auto: Chat', subtext: 'Schneller Chat mit Werkzeugen', contextLimit: 131072 },
  'auto:fast': {
    alias: 'Auto: Fast',
    subtext: 'Schnellste Antwort, einfache Aufgaben',
    contextLimit: 131072,
  },
  'auto:vision': {
    alias: 'Auto: Vision',
    subtext: 'Bilder und Screenshots erkennen',
    contextLimit: 131072,
  },
  'auto:image': {
    alias: 'Auto: Image',
    subtext: 'Höhere Bildqualität',
    contextLimit: 262144,
    reasoning: true,
  },
  'auto:uncensored': {
    alias: 'Auto: Uncensored',
    subtext: 'Ohne Inhaltsfilter',
    contextLimit: 131072,
  },
  '*': { alias: 'Auto: * (bestes verfügbares)', subtext: 'Automatische Modellwahl', contextLimit: 131072 },
};

function labelFor(id: string): { alias: string; subtext: string } {
  const m = META[id];
  if (m) return { alias: m.alias, subtext: m.subtext };
  const suffix = id.startsWith('auto:') ? id.slice('auto:'.length) : id;
  const alias = suffix ? `Auto: ${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}` : id;
  return { alias, subtext: 'Automatische Modellwahl' };
}

// Bevorzugte Reihenfolge; Unbekanntes alphabetisch; '*' ganz unten.
const ORDER = ['auto:code', 'auto:chat', 'auto:fast', 'auto:vision', 'auto:image', 'auto:uncensored'];
function sortIds(ids: string[]): string[] {
  const star = ids.filter((i) => i === '*');
  const rest = ids.filter((i) => i !== '*');
  rest.sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
  return [...rest, ...star];
}

interface ExtraModel {
  id: string;
  alias?: string;
  subtext?: string;
  contextLimit?: number;
  reasoning?: boolean;
  provider?: string;
}

// Fuehrt die Basis-Liste (live auto:* oder Offline-Fallback) mit den Benutzer-Zusatzmodellen
// (tb_extra_models) zusammen und wendet die Ausblend-Liste (tb_hide_models) an. Dedup ueber den
// Modellnamen: ein Zusatzeintrag mit gleicher ID ueberschreibt nur Anzeige-Meta eines Live-Tags
// (z. B. Alias umbenennen), neue IDs werden hinten angehaengt (Datei-Reihenfolge). Alles routet
// ueber denselben openai/t78.ch-Provider.
export function mergeModels(base: Model[], extras: ExtraModel[], hide: string[]): Model[] {
  const hidden = new Set(hide);
  const byName = new Map<string, Model>();
  const order: string[] = [];
  for (const m of base) {
    if (hidden.has(m.name)) continue;
    if (!byName.has(m.name)) {
      byName.set(m.name, { ...m });
      order.push(m.name);
    }
  }
  for (const e of extras) {
    const id = (e?.id ?? '').trim();
    if (!id || hidden.has(id)) continue;
    const existing = byName.get(id);
    if (existing) {
      if (e.alias) existing.alias = e.alias;
      if (e.subtext) existing.subtext = e.subtext;
      if (e.contextLimit != null) existing.context_limit = e.contextLimit;
      if (e.reasoning != null) existing.reasoning = e.reasoning;
      continue;
    }
    const lbl = labelFor(id);
    const meta = META[id];
    byName.set(id, {
      name: id,
      // Eigener Provider (fremder Endpunkt) falls angegeben, sonst der openai/t78-Provider.
      provider: e.provider && e.provider.length > 0 ? e.provider : 'openai',
      alias: e.alias ?? lbl.alias,
      subtext: e.subtext ?? lbl.subtext,
      context_limit: e.contextLimit ?? meta?.contextLimit,
      reasoning: e.reasoning ?? meta?.reasoning,
    } as Model);
    order.push(id);
  }
  return order.map((n) => byName.get(n)!).filter(Boolean);
}

export async function fetchAutoModels(): Promise<Model[]> {
  let base: Model[] = [];
  let extras: ExtraModel[] = [];
  let hide: string[] = [];
  try {
    const r = await window.electron.tbAutoModels();
    extras = Array.isArray(r?.extras) ? (r.extras as ExtraModel[]) : [];
    hide = Array.isArray(r?.hide) ? r.hide : [];
    if (r?.ok && Array.isArray(r.models) && r.models.length > 0) {
      const byId = new Map(r.models.map((m) => [m.id, m]));
      base = sortIds(r.models.map((m) => m.id)).map((id) => {
        const lbl = labelFor(id);
        const meta = META[id];
        const live = byId.get(id);
        return {
          name: id,
          provider: 'openai',
          alias: lbl.alias,
          subtext: lbl.subtext,
          context_limit: live?.contextLimit ?? meta?.contextLimit,
          reasoning: meta?.reasoning,
        } as Model;
      });
    }
  } catch {
    /* Fallback unten */
  }
  // Offline/Fehler: gebuendelte Liste als Basis; Zusatz-/Ausblendlisten gelten trotzdem.
  if (base.length === 0) base = getPredefinedModelsFromEnv();
  return mergeModels(base, extras, hide);
}
