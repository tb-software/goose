// TB-Software: Qualitaetsregler Phase A - Rollen-Katalog und Auswahl (rein, testbar).
// Rollen werden spaeter ueber die Einstellungen erweiterbar; hier die Standard-Besetzung und
// die Auswahl-Logik nach Thema/Stufe/Modus. Siehe Konzept-Doku 01_Qualitaetsregler-...md.

import type { QualityParams } from './qualityPolicy';

export type RoleType = 'wissen' | 'produzent' | 'reviewer' | 'koordinator';
export type RollenModus = 'auto' | 'manuell';

export interface Role {
  id: string;
  name: string;
  type: RoleType;
  topics: string[]; // '*' = passt immer; sonst Schnittmenge mit dem Chat-Thema
  always: boolean; // unabhaengig vom Thema immer aktiv (ab minStufe)
  minStufe: number; // ab welcher Reglerstufe zuschaltbar
  loopAllowed: boolean;
  promptFragment: string; // Perspektive für den Prompt
}

// Reihenfolge je Typ fuer eine stabile, nachvollziehbare Ausgabe.
const TYPE_ORDER: Record<RoleType, number> = { wissen: 0, produzent: 1, reviewer: 2, koordinator: 3 };

export const DEFAULT_ROLES: Role[] = [
  {
    id: 'wissens-rechercheur',
    name: 'Wissens-Rechercheur',
    type: 'wissen',
    topics: ['*'],
    always: true,
    minStufe: 2,
    loopAllowed: false,
    promptFragment:
      'Hole vor der Arbeit vorhandenes Wissen zum Thema aus lenax-db (frühere Entscheidungen, Gotchas, Rapporte) und beziehe es ein.',
  },
  {
    id: 'fach-experte',
    name: 'Fach-Experte',
    type: 'produzent',
    topics: ['*'],
    always: false,
    minStufe: 4,
    loopAllowed: true,
    promptFragment: 'Erstelle den Hauptinhalt fachlich korrekt und vollständig.',
  },
  {
    id: 'koordinator',
    name: 'Koordinator',
    type: 'koordinator',
    topics: ['*'],
    always: false,
    minStufe: 4,
    loopAllowed: true,
    promptFragment:
      'Fasse die Beiträge zusammen, schlichte Widersprüche (die sicherere Variante gewinnt) und entscheide am Ende, was in die Endantwort kommt.',
  },
  {
    id: 'lektor',
    name: 'Lektor',
    type: 'reviewer',
    topics: ['text', 'offerte', 'email', 'dokument', 'web-copy'],
    always: false,
    minStufe: 2,
    loopAllowed: false,
    promptFragment:
      'Prüfe Sprache, Stil und Typografie. Deutscher Text nutzt echte Umlaute und ss statt Eszett, keine Gedankenstriche.',
  },
  {
    id: 'vollstaendigkeit',
    name: 'Vollständigkeits-Prüfer',
    type: 'reviewer',
    topics: ['text', 'offerte', 'email', 'dokument', 'code', 'plan'],
    always: false,
    minStufe: 3,
    loopAllowed: false,
    promptFragment:
      'Gleiche die Antwort gegen den lenax-db-Befund ab und frage: ist etwas Wichtiges aus der Vergangenheit vergessen worden?',
  },
  {
    id: 'faktenpruefer',
    name: 'Faktenprüfer',
    type: 'reviewer',
    topics: ['text', 'offerte', 'plan', 'recherche'],
    always: false,
    minStufe: 4,
    loopAllowed: false,
    promptFragment: 'Prüfe Konsistenz, Zahlen, Widersprüche und mögliche Halluzinationen.',
  },
  {
    id: 'code-reviewer',
    name: 'Code-Reviewer',
    type: 'reviewer',
    topics: ['code'],
    always: false,
    minStufe: 4,
    loopAllowed: false,
    promptFragment: 'Prüfe Korrektheit, Randfälle und Sicherheit im Code.',
  },
  {
    id: 'qs-test',
    name: 'QS/Test',
    type: 'reviewer',
    topics: ['code', 'tool'],
    always: false,
    minStufe: 4,
    loopAllowed: true,
    promptFragment: 'Prüfe, ob es baut und läuft (Tests, Typecheck, Lint).',
  },
  {
    id: 'sicherheits-pruefer',
    name: 'Sicherheits-Prüfer',
    type: 'reviewer',
    topics: ['*'],
    always: true,
    minStufe: 2,
    loopAllowed: false,
    promptFragment:
      'Warne vor destruktiven Aktionen (Löschen, Überschreiben, nach aussen senden) und habe bei klaren Gefahren ein Veto. Im Zweifel anhalten und fragen, auch im auto-Modus.',
  },
  {
    id: 'datenschutz-pruefer',
    name: 'Datenschutz-Prüfer',
    type: 'reviewer',
    topics: ['text', 'email', 'offerte', 'daten'],
    always: false,
    minStufe: 5,
    loopAllowed: false,
    promptFragment: 'Verhindere, dass Zugangsdaten oder personenbezogene Daten ungewollt in Ausgaben gelangen.',
  },
  {
    id: 'kosten-waechter',
    name: 'Kosten/Aufwand-Wächter',
    type: 'reviewer',
    topics: ['*'],
    always: false,
    minStufe: 6,
    loopAllowed: false,
    promptFragment: 'Halte den Umfang vernünftig, warne vor Überengineering und vor dem Reissen der Deckel.',
  },
  {
    id: 'kunden-anwalt',
    name: 'Kunden-Anwalt',
    type: 'reviewer',
    topics: ['offerte', 'text', 'plan', 'ux'],
    always: false,
    minStufe: 5,
    loopAllowed: false,
    promptFragment: 'Prüfe, ob die Antwort die eigentliche Absicht des Nutzers trifft, nicht nur die wörtliche Frage.',
  },
  {
    id: 'compliance',
    name: 'Compliance/Recht',
    type: 'reviewer',
    topics: ['vertrag', 'recht', 'agb', 'werbung'],
    always: false,
    minStufe: 7,
    loopAllowed: false,
    promptFragment: 'Prüfe rechtliche Fallstricke bei Verträgen, Werbung und AGB.',
  },
];

function normalizeTopics(topic: string | string[]): string[] {
  const arr = Array.isArray(topic) ? topic : [topic];
  return arr.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function matchesTopic(role: Role, topics: string[]): boolean {
  if (role.topics.includes('*')) return true;
  return role.topics.some((t) => topics.includes(t));
}

function byType(a: Role, b: Role): number {
  const d = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  return d !== 0 ? d : a.id.localeCompare(b.id);
}

function unionById(a: Role[], b: Role[]): Role[] {
  const seen = new Set<string>();
  const out: Role[] = [];
  for (const r of [...a, ...b]) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

export interface SelectRolesOptions {
  roles?: Role[];
  topic: string | string[];
  params: QualityParams;
  mode: RollenModus;
  manualIds?: string[];
  // Nur fuer Nachweis im Test: wird im Automatik-Pfad aufgerufen, im Manuell-Pfad nicht.
  onClassify?: (topics: string[]) => void;
}

// Waehlt die aktiven Rollen nach Stufe, Thema und Modus. Rein, keine Seiteneffekte ausser onClassify.
export function selectRoles(opts: SelectRolesOptions): Role[] {
  const roles = opts.roles ?? DEFAULT_ROLES;
  const { params, mode } = opts;

  // Stufe 1: ueberhaupt keine Rollen (heutiges Verhalten).
  if (params.rollenTiefe === 'keine') return [];

  const eligible = roles.filter((r) => r.minStufe <= params.stufe);
  const alwaysRoles = eligible.filter((r) => r.always);

  let picked: Role[];
  if (mode === 'manuell') {
    const ids = opts.manualIds ?? [];
    const manual = eligible.filter((r) => ids.includes(r.id));
    picked = unionById(manual, alwaysRoles);
  } else {
    const topics = normalizeTopics(opts.topic);
    opts.onClassify?.(topics);
    let auto = params.alleRollen ? eligible.slice() : eligible.filter((r) => matchesTopic(r, topics));
    // Ohne Loop-Budget (Stufe 2-3) keine Produzenten/Koordinatoren - das Hauptmodell produziert.
    if (params.loopBudget === 0) {
      auto = auto.filter((r) => r.type === 'reviewer' || r.type === 'wissen' || r.always);
    }
    picked = unionById(auto, alwaysRoles);
  }

  return picked.sort(byType);
}
