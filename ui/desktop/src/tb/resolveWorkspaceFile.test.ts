// TB-Software: Tests fuer die Datei-Aufloesung (Plan 03, Punkt 1 - Pflicht-Test VOR Deploy).
// Timo-Vorgabe 30.10.: "egal wie der Basis-Pfad aussieht, muss das funktional werden."
// Teil 1 prueft die reine Logik (resolveWorkspaceFile) mit injizierten Abhaengigkeiten gegen ALLE
// Basis-Pfad-Formen; Teil 2 prueft den echten Datei-Walker (findExactBasenameUnder) auf der Platte,
// inkl. Mehrtreffer -> kuerzester relativer Pfad gewinnt.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import {
  resolveWorkspaceFile,
  resolveWorkspaceFileRoots,
  findExactBasenameUnder,
  longestExistingPrefix,
  type ResolveDeps,
} from './resolveWorkspaceFile';

describe('longestExistingPrefix', () => {
  const real = 'D:\\NextCloud\\Familie\\Noah 6. Geburtstag';
  const existsReal = async (abs: string) => abs === real;

  it('schneidet Fliesstext-Ueberhang hinter dem Pfad weg', async () => {
    expect(await longestExistingPrefix(real + ' und 339 MB', existsReal)).toBe(real);
  });

  it('exakt existierender Pfad bleibt unveraendert', async () => {
    expect(await longestExistingPrefix(real, existsReal)).toBe(real);
  });

  it('nicht existente Datei faellt auf den existierenden Ordner zurueck', async () => {
    const dir = 'C:\\data\\reports';
    const exists = async (abs: string) => abs === dir;
    expect(await longestExistingPrefix('C:\\data\\reports\\q4 final.xlsx', exists)).toBe(
      dir
    );
  });

  it('nichts existiert -> null (nicht unter das Laufwerk kuerzen)', async () => {
    expect(
      await longestExistingPrefix('C:\\gibtsnicht\\x y z', async () => false)
    ).toBe(null);
  });
});

// --- Teil 1: reine Logik (win32-Semantik, wie auf Timos Rechner) ---

function makeDeps(existing: string[], found: string | null = null): ResolveDeps {
  const norm = (x: string) => path.win32.normalize(x).toLowerCase();
  const set = new Set(existing.map(norm));
  return {
    pathApi: path.win32,
    exists: async (abs: string) => set.has(norm(abs)),
    findByBasename: async () => found,
  };
}

describe('resolveWorkspaceFile (reine Logik)', () => {
  const WD = 'G:\\_AI\\Workspace';

  it('leere Eingabe -> empty', async () => {
    expect(await resolveWorkspaceFile('', WD, makeDeps([]))).toEqual({
      ok: false,
      path: null,
      reason: 'empty',
    });
    expect((await resolveWorkspaceFile('   ', WD, makeDeps([]))).reason).toBe('empty');
  });

  it('absoluter, existierender Pfad -> exists (normalisiert)', async () => {
    const r = await resolveWorkspaceFile('G:\\_AI\\Workspace\\Ergebnis.md', WD, makeDeps([
      'G:\\_AI\\Workspace\\Ergebnis.md',
    ]));
    expect(r).toEqual({ ok: true, path: 'G:\\_AI\\Workspace\\Ergebnis.md', reason: 'exists' });
  });

  it('absoluter Pfad mit Vorwaerts-Slashes -> exists, auf Backslashes normalisiert', async () => {
    const r = await resolveWorkspaceFile('G:/_AI/Workspace/Ergebnis.md', WD, makeDeps([
      'G:\\_AI\\Workspace\\Ergebnis.md',
    ]));
    expect(r.ok).toBe(true);
    expect(r.path).toBe('G:\\_AI\\Workspace\\Ergebnis.md');
    expect(r.reason).toBe('exists');
  });

  it('Datei direkt in der Workdir-Wurzel (blosser Name) -> resolved', async () => {
    const r = await resolveWorkspaceFile('Ergebnis.md', WD, makeDeps([
      'G:\\_AI\\Workspace\\Ergebnis.md',
    ]));
    expect(r).toEqual({ ok: true, path: 'G:\\_AI\\Workspace\\Ergebnis.md', reason: 'resolved' });
  });

  it('Datei in Unterordner (relativer Pfad, Vorwaerts-Slashes) -> resolved', async () => {
    const r = await resolveWorkspaceFile('unter/report.md', WD, makeDeps([
      'G:\\_AI\\Workspace\\unter\\report.md',
    ]));
    expect(r.ok).toBe(true);
    expect(r.path).toBe('G:\\_AI\\Workspace\\unter\\report.md');
    expect(r.reason).toBe('resolved');
  });

  it('fuehrendes ./ und / werden relativ zur Wurzel aufgeloest', async () => {
    const deps = makeDeps(['G:\\_AI\\Workspace\\a\\b.txt']);
    expect((await resolveWorkspaceFile('./a/b.txt', WD, deps)).path).toBe(
      'G:\\_AI\\Workspace\\a\\b.txt'
    );
    expect((await resolveWorkspaceFile('/a/b.txt', WD, deps)).path).toBe(
      'G:\\_AI\\Workspace\\a\\b.txt'
    );
  });

  it('blosser Name nicht direkt vorhanden, aber tiefer gefunden -> found', async () => {
    const r = await resolveWorkspaceFile(
      'flash_backup.py',
      WD,
      makeDeps([], 'G:\\_AI\\Workspace\\tools\\flash_backup.py')
    );
    expect(r).toEqual({
      ok: true,
      path: 'G:\\_AI\\Workspace\\tools\\flash_backup.py',
      reason: 'found',
    });
  });

  it('absoluter Pfad existiert nicht, aber Basisname liegt unter der Wurzel -> found', async () => {
    const r = await resolveWorkspaceFile(
      'C:\\woanders\\Ergebnis.md',
      WD,
      makeDeps([], 'G:\\_AI\\Workspace\\Ergebnis.md')
    );
    expect(r.reason).toBe('found');
    expect(r.path).toBe('G:\\_AI\\Workspace\\Ergebnis.md');
  });

  it('nirgends gefunden -> missing', async () => {
    const r = await resolveWorkspaceFile('fehlt.md', WD, makeDeps([], null));
    expect(r).toEqual({ ok: false, path: null, reason: 'missing' });
  });

  it('relativer Pfad ohne Arbeitsverzeichnis -> no-working-dir', async () => {
    for (const wd of ['', null, undefined]) {
      expect((await resolveWorkspaceFile('x.md', wd, makeDeps([]))).reason).toBe('no-working-dir');
    }
  });

  it('absoluter, fehlender Pfad ohne Arbeitsverzeichnis -> missing', async () => {
    expect((await resolveWorkspaceFile('C:\\x\\y.md', null, makeDeps([]))).reason).toBe('missing');
  });

  it('Name mit Leerzeichen bleibt erhalten', async () => {
    const r = await resolveWorkspaceFile('Mein Report.pdf', WD, makeDeps([
      'G:\\_AI\\Workspace\\Mein Report.pdf',
    ]));
    expect(r.path).toBe('G:\\_AI\\Workspace\\Mein Report.pdf');
    expect(r.reason).toBe('resolved');
  });

  it('Arbeitsverzeichnis mit Trailing-Slash und als Laufwerkswurzel', async () => {
    expect(
      (await resolveWorkspaceFile('x.md', 'G:\\_AI\\Workspace\\', makeDeps([
        'G:\\_AI\\Workspace\\x.md',
      ]))).path
    ).toBe('G:\\_AI\\Workspace\\x.md');
    // Laufwerkswurzel als Basis-Pfad
    expect(
      (await resolveWorkspaceFile('x.md', 'G:\\', makeDeps(['G:\\x.md']))).path
    ).toBe('G:\\x.md');
  });

  it('verhindert ..-Ausbruch: loest NICHT ausserhalb des Arbeitsverzeichnisses auf', async () => {
    // Selbst wenn die Datei ausserhalb existiert, darf der relative ..-Pfad sie nicht liefern.
    const r = await resolveWorkspaceFile('..\\secret.txt', WD, makeDeps(['G:\\_AI\\secret.txt'], null));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing');
  });

  it('funktioniert auch mit POSIX-Basis-Pfad (pathApi=posix)', async () => {
    const deps: ResolveDeps = {
      pathApi: path.posix,
      exists: async (abs) => abs === '/home/ws/sub/a.md',
      findByBasename: async () => null,
    };
    const r = await resolveWorkspaceFile('sub/a.md', '/home/ws', deps);
    expect(r).toEqual({ ok: true, path: '/home/ws/sub/a.md', reason: 'resolved' });
  });
});

// --- Teil 1b: Mehr-Wurzel-Aufloesung (Ordnerwechsel waehrend des Projekts) ---

// Deps, bei denen die Basisnamen-Suche VOM Wurzelverzeichnis abhaengt (anders als makeDeps, das
// fuer jede Wurzel denselben Treffer liefert). Noetig, um "Datei nur unter Wurzel A" zu pruefen.
function makeRootDeps(
  existing: string[],
  byName: Record<string, string> = {} // `${rootLower}|${basenameLower}` -> abs
): ResolveDeps {
  const norm = (x: string) => path.win32.normalize(x).toLowerCase();
  const set = new Set(existing.map(norm));
  return {
    pathApi: path.win32,
    exists: async (abs: string) => set.has(norm(abs)),
    findByBasename: async (root: string, basename: string) =>
      byName[`${norm(root)}|${basename.toLowerCase()}`] ?? null,
  };
}

describe('resolveWorkspaceFileRoots (Ordner kann sich waehrend des Projekts aendern)', () => {
  const NEU = 'G:\\Proj\\neu'; // aktueller Chat-Ordner (session.working_dir)
  const ALT = 'G:\\Proj\\alt'; // beim Fenster-Start gebundene, VERALTETE Workdir

  it('Unterordner unter dem AKTUELLEN Ordner wird gefunden (nicht gegen die veraltete Wurzel)', async () => {
    const deps = makeRootDeps(['G:\\Proj\\neu\\docs\\report.md']);
    // Nur-veraltet (wie der Bug) scheitert:
    const stale = await resolveWorkspaceFile('docs/report.md', ALT, deps);
    expect(stale.ok).toBe(false);
    // Aktueller Ordner zuerst -> Treffer:
    const fixed = await resolveWorkspaceFileRoots('docs/report.md', [NEU, ALT], deps);
    expect(fixed).toEqual({
      ok: true,
      path: 'G:\\Proj\\neu\\docs\\report.md',
      reason: 'resolved',
    });
  });

  it('blosser Name wird unter dem aktuellen Ordner aufgeloest', async () => {
    const deps = makeRootDeps(['G:\\Proj\\neu\\ergebnis.md']);
    const r = await resolveWorkspaceFileRoots('ergebnis.md', [NEU, ALT], deps);
    expect(r.path).toBe('G:\\Proj\\neu\\ergebnis.md');
    expect(r.reason).toBe('resolved');
  });

  it('faellt auf die gebundene Wurzel zurueck, wenn die Datei nur dort liegt', async () => {
    const deps = makeRootDeps(['G:\\Proj\\alt\\nurdort.md']);
    const r = await resolveWorkspaceFileRoots('nurdort.md', [NEU, ALT], deps);
    expect(r.path).toBe('G:\\Proj\\alt\\nurdort.md');
    expect(r.reason).toBe('resolved');
  });

  it('erste Wurzel gewinnt bei Namensgleichheit in beiden Ordnern', async () => {
    const deps = makeRootDeps(['G:\\Proj\\neu\\gleich.md', 'G:\\Proj\\alt\\gleich.md']);
    const r = await resolveWorkspaceFileRoots('gleich.md', [NEU, ALT], deps);
    expect(r.path).toBe('G:\\Proj\\neu\\gleich.md');
  });

  it('Basisnamen-Suche nutzt die jeweilige Wurzel (tiefer Treffer nur im aktuellen Ordner)', async () => {
    const deps = makeRootDeps([], {
      [`${path.win32.normalize(NEU).toLowerCase()}|tief.md`]: 'G:\\Proj\\neu\\a\\b\\tief.md',
    });
    const r = await resolveWorkspaceFileRoots('tief.md', [NEU, ALT], deps);
    expect(r).toEqual({ ok: true, path: 'G:\\Proj\\neu\\a\\b\\tief.md', reason: 'found' });
  });

  it('absoluter, existierender Pfad ist unabhaengig von den Wurzeln', async () => {
    const deps = makeRootDeps(['D:\\woanders\\x.md']);
    const r = await resolveWorkspaceFileRoots('D:\\woanders\\x.md', [NEU, ALT], deps);
    expect(r).toEqual({ ok: true, path: 'D:\\woanders\\x.md', reason: 'exists' });
  });

  it('dedupliziert Wurzeln und ignoriert leere/null-Eintraege', async () => {
    const deps = makeRootDeps(['G:\\Proj\\neu\\d.md']);
    const r = await resolveWorkspaceFileRoots('d.md', [null, NEU, '', NEU, '  '], deps);
    expect(r.path).toBe('G:\\Proj\\neu\\d.md');
    expect(r.reason).toBe('resolved');
  });

  it('nirgends gefunden -> missing (aussagekraeftigster Grund), nicht no-working-dir', async () => {
    const deps = makeRootDeps([]);
    // NEU gueltig (-> missing), ALT null (-> no-working-dir): 'missing' soll berichtet werden.
    const r = await resolveWorkspaceFileRoots('fehlt.md', [NEU, null], deps);
    expect(r).toEqual({ ok: false, path: null, reason: 'missing' });
  });

  it('ganz ohne Wurzeln: relativer Name -> no-working-dir, absoluter Treffer -> exists', async () => {
    const deps = makeRootDeps(['C:\\a\\b.md']);
    expect((await resolveWorkspaceFileRoots('rel.md', [], deps)).reason).toBe('no-working-dir');
    expect((await resolveWorkspaceFileRoots('rel.md', [null, undefined], deps)).reason).toBe(
      'no-working-dir'
    );
    expect((await resolveWorkspaceFileRoots('C:\\a\\b.md', [], deps)).reason).toBe('exists');
  });

  it('leere Eingabe -> empty', async () => {
    expect((await resolveWorkspaceFileRoots('', [NEU, ALT], makeRootDeps([]))).reason).toBe('empty');
  });
});

// --- Teil 2: echter Datei-Walker auf der Platte ---

describe('findExactBasenameUnder (echtes Dateisystem)', () => {
  let root = '';

  beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tb-resolve-'));
    await fsp.mkdir(path.join(root, 'tief', 'tiefer'), { recursive: true });
    await fsp.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await fsp.writeFile(path.join(root, 'wurzel.md'), 'x');
    await fsp.writeFile(path.join(root, 'tief', 'nur_tief.md'), 'x');
    // Mehrtreffer: gleicher Name in Wurzel UND tief -> Wurzel (kuerzester rel. Pfad) gewinnt
    await fsp.writeFile(path.join(root, 'doppelt.md'), 'x');
    await fsp.writeFile(path.join(root, 'tief', 'tiefer', 'doppelt.md'), 'x');
    // In node_modules darf NICHT gefunden werden
    await fsp.writeFile(path.join(root, 'node_modules', 'pkg', 'versteckt.md'), 'x');
  });

  afterAll(async () => {
    if (root) await fsp.rm(root, { recursive: true, force: true });
  });

  it('findet eine Datei in der Wurzel', async () => {
    expect(await findExactBasenameUnder(root, 'wurzel.md')).toBe(path.join(root, 'wurzel.md'));
  });

  it('findet eine Datei nur in einem Unterordner', async () => {
    expect(await findExactBasenameUnder(root, 'nur_tief.md')).toBe(
      path.join(root, 'tief', 'nur_tief.md')
    );
  });

  it('bei Mehrtreffern gewinnt der kuerzeste relative Pfad (Wurzel)', async () => {
    expect(await findExactBasenameUnder(root, 'doppelt.md')).toBe(path.join(root, 'doppelt.md'));
  });

  it('ist case-insensitiv', async () => {
    expect(await findExactBasenameUnder(root, 'WURZEL.MD')).toBe(path.join(root, 'wurzel.md'));
  });

  it('ueberspringt node_modules/.git usw.', async () => {
    expect(await findExactBasenameUnder(root, 'versteckt.md')).toBeNull();
  });

  it('gibt null zurueck, wenn nichts passt', async () => {
    expect(await findExactBasenameUnder(root, 'gibtsnicht.md')).toBeNull();
  });
});
