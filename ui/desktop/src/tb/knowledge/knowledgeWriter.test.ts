import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { persistKnowledge, renderFrontMatter } from './knowledgeWriter';

const tempDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'knowledge-'));
  tempDirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function read(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}
async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const base = (workingDir: string) => ({
  scope: 'local' as const,
  workingDir,
  sessionId: 'ses_1',
  title: 'Kesb Ronny Wüst',
  model: 'gericom/auto:code',
  summaryText: '## Ziel\nDen Fall zusammenfassen.',
  detailMarkdown: '**User:** Hallo\n\n**Assistant:** Hi',
  detailTokens: 1234,
  summaryTokens: 200,
});

describe('persistKnowledge', () => {
  it('writes the full .knowledge tree on first compaction (local scope)', async () => {
    const ws = await tmp();
    const res = await persistKnowledge(base(ws));
    expect(res.ok, res.error).toBe(true);
    expect(res.compaction).toBe(1);

    const root = path.join(ws, '.knowledge');
    const chatDir = path.join(root, 'chats', 'kesb-ronny-wuest__ses_1');

    // Detail-Segment #1 mit Front-Matter.
    const detailFiles = await fs.readdir(path.join(chatDir, 'details'));
    expect(detailFiles).toHaveLength(1);
    expect(detailFiles[0]).toMatch(/^0001__\d{4}-\d{2}-\d{2}T\d{6}\.md$/);
    const detailContent = await read(path.join(chatDir, 'details', detailFiles[0]));
    expect(detailContent).toContain('type: "chat-detail"');
    expect(detailContent).toContain('chatId: "ses_1"');
    expect(detailContent).toContain('compaction: 1');
    expect(detailContent).toContain('**User:** Hallo');

    // summary.md = Einstieg.
    const summary = await read(path.join(chatDir, 'summary.md'));
    expect(summary).toContain('type: "chat-summary"');
    expect(summary).toContain('## Ziel');

    // chat.md Kopf.
    const chatMd = await read(path.join(chatDir, 'chat.md'));
    expect(chatMd).toContain('type: "chat"');
    expect(chatMd).toContain('# Kesb Ronny Wüst');

    // index.json Manifest.
    const manifest = JSON.parse(await read(path.join(chatDir, 'index.json')));
    expect(manifest.chatId).toBe('ses_1');
    expect(manifest.compactions).toHaveLength(1);
    expect(manifest.compactions[0].detailFile).toBe('details/' + detailFiles[0]);

    // Root-Index + gitignore.
    expect(await exists(path.join(root, 'index.md'))).toBe(true);
    expect(await read(path.join(root, 'index.md'))).toContain('Kesb Ronny Wüst');
    expect(await read(path.join(root, '.gitignore'))).toContain('*');
  });

  it('appends a second detail and updates summary/manifest on the next compaction', async () => {
    const ws = await tmp();
    await persistKnowledge(base(ws));
    await new Promise((r) => setTimeout(r, 5));
    const res2 = await persistKnowledge({
      ...base(ws),
      summaryText: '## Ziel\nAktualisierte Zusammenfassung.',
      detailMarkdown: '**User:** Weiter\n\n**Assistant:** Ok',
    });
    expect(res2.ok, res2.error).toBe(true);
    expect(res2.compaction).toBe(2);

    const chatDir = path.join(ws, '.knowledge', 'chats', 'kesb-ronny-wuest__ses_1');
    const detailFiles = (await fs.readdir(path.join(chatDir, 'details'))).sort();
    expect(detailFiles).toHaveLength(2);
    expect(detailFiles[1]).toMatch(/^0002__/);

    const summary = await read(path.join(chatDir, 'summary.md'));
    expect(summary).toContain('Aktualisierte Zusammenfassung.');
    expect(summary).toContain('compaction: 2');

    const manifest = JSON.parse(await read(path.join(chatDir, 'index.json')));
    expect(manifest.compactions).toHaveLength(2);
  });

  it('resolves the GLOBAL scope to the configured dir', async () => {
    const home = await tmp();
    const globalDir = path.join(home, 'TB-Software', 'Knowledge');
    const res = await persistKnowledge({ ...base('D:\\irrelevant'), scope: 'global', globalDir });
    expect(res.ok, res.error).toBe(true);
    expect(res.chatDir).toBe(path.join(globalDir, 'chats', 'kesb-ronny-wuest__ses_1'));
    expect(await exists(path.join(globalDir, 'chats', 'kesb-ronny-wuest__ses_1', 'summary.md'))).toBe(true);
    // Global-Scope legt KEINE .gitignore an (liegt außerhalb von Repos).
    expect(await exists(path.join(globalDir, '.gitignore'))).toBe(false);
  });

  it('never throws — returns {ok:false} on an unwritable target', async () => {
    // Ungültiger Arbeitspfad (leer) -> Pfadauflösung/FS scheitert kontrolliert.
    const res = await persistKnowledge({ ...base(''), workingDir: '\0invalid' });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('renderFrontMatter quotes strings, skips empty, keeps numbers', () => {
    const fm = renderFrontMatter({ a: 'x"y', b: 3, c: true, d: '', e: null, f: undefined });
    expect(fm).toContain('a: "x\\"y"');
    expect(fm).toContain('b: 3');
    expect(fm).toContain('c: true');
    expect(fm).not.toContain('d:');
    expect(fm).not.toContain('e:');
    expect(fm).not.toContain('f:');
  });
});
