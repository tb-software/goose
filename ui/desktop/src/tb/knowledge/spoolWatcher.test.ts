import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// logger importiert electron — für den Main-Modul-Test stubben.
vi.mock('../../utils/logger', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {} },
}));

import { processSpoolDir } from './spoolWatcher';

const tempDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'spool-'));
  tempDirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});
async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe('processSpoolDir', () => {
  it('turns a valid spool file into the .knowledge tree and deletes the spool', async () => {
    const ws = await tmp();
    const spool = await tmp();
    const payload = {
      scope: 'local',
      workingDir: ws,
      sessionId: 'ses_9',
      title: 'Grüezi Wält',
      model: 'gericom/auto:code',
      summaryText: '## Ziel\nX',
      detailMarkdown: '# Session\n**User:** hi',
      compactionIso: '2026-09-19T20:51:03+00:00',
    };
    const spoolFile = path.join(spool, 'a.json');
    await fs.writeFile(spoolFile, JSON.stringify(payload), 'utf8');

    await processSpoolDir(spool);

    // Spool-Datei konsumiert.
    expect(await exists(spoolFile)).toBe(false);
    // Ablage entstanden.
    const chatDir = path.join(ws, '.knowledge', 'chats', 'grueezi-waelt__ses_9');
    expect(await exists(path.join(chatDir, 'summary.md'))).toBe(true);
    expect(await exists(path.join(chatDir, 'details'))).toBe(true);
    expect(await exists(path.join(ws, '.knowledge', 'index.md'))).toBe(true);
    const summary = await fs.readFile(path.join(chatDir, 'summary.md'), 'utf8');
    expect(summary).toContain('## Ziel');
  });

  it('discards an invalid (non-JSON) spool file instead of looping on it', async () => {
    const spool = await tmp();
    const bad = path.join(spool, 'bad.json');
    await fs.writeFile(bad, '{ not json', 'utf8');
    await processSpoolDir(spool);
    expect(await exists(bad)).toBe(false);
  });

  it('ignores tmp/dot files', async () => {
    const spool = await tmp();
    const tmpFile = path.join(spool, '.x.tmp');
    await fs.writeFile(tmpFile, 'partial', 'utf8');
    await processSpoolDir(spool);
    expect(await exists(tmpFile)).toBe(true); // unangetastet
  });
});
