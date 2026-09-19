import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chatFolderName,
  chatKnowledgePaths,
  defaultGlobalKnowledgeDir,
  detailFileName,
  expandHome,
  knowledgeEnabled,
  resolveKnowledgeRoot,
  slugify,
  DEFAULT_LOCAL_DIRNAME,
} from './knowledgePaths';

const HOME = path.join('C:', 'Users', 'timob');

describe('knowledgePaths', () => {
  it('slugifies titles (accents stripped, lowercased, dashed, capped)', () => {
    expect(slugify('Kesb Ronny Wüst Einstiegspunkte')).toBe('kesb-ronny-wuest-einstiegspunkte');
    expect(slugify('  Über/Größe: Test!! ')).toBe('ueber-groesse-test');
    expect(slugify('café déjà')).toBe('cafe-deja'); // Nicht-Deutsch: Akzente gestrippt
    expect(slugify('')).toBe('chat');
    expect(slugify(null)).toBe('chat');
  });

  it('builds a chat folder name <slug>__<sessionId>', () => {
    expect(chatFolderName('Mein Chat', 'ses_ABC-123')).toBe('mein-chat__ses_ABC-123');
    // unsafe id chars are stripped
    expect(chatFolderName('x', 'ses/../evil')).toBe('x__ses..evil');
  });

  it('names detail segments NNNN__<compact-iso>.md', () => {
    expect(detailFileName(1, '2026-09-19T20:51:03.123Z')).toBe('0001__2026-09-19T205103.md');
    expect(detailFileName(42, '2026-09-19T20:51:03Z')).toBe('0042__2026-09-19T205103.md');
    // Backend-rfc3339 mit Offset (…+00:00) muss ebenfalls sauber werden (kein langer Nano-String).
    expect(detailFileName(1, '2026-09-19T09:23:10.128703100+00:00')).toBe('0001__2026-09-19T092310.md');
  });

  it('expands ~ and %USERPROFILE%', () => {
    expect(expandHome('~/TB-Software/Knowledge', HOME)).toBe(path.join(HOME, 'TB-Software/Knowledge'));
    expect(expandHome('%USERPROFILE%\\TB-Software\\Knowledge', HOME)).toBe(`${HOME}\\TB-Software\\Knowledge`);
  });

  it('resolves LOCAL root relative to the working dir with default dirname', () => {
    const root = resolveKnowledgeRoot({ scope: 'local', workingDir: path.join('D', 'Projekt') });
    expect(root).toBe(path.join('D', 'Projekt', DEFAULT_LOCAL_DIRNAME));
  });

  it('resolves LOCAL root with a custom dirname', () => {
    const root = resolveKnowledgeRoot({ scope: 'local', workingDir: 'D:\\P', localDirName: '.wissen' });
    expect(root).toBe(path.join('D:\\P', '.wissen'));
  });

  it('resolves GLOBAL root to the shared default when unset', () => {
    const root = resolveKnowledgeRoot({ scope: 'global', workingDir: 'ignored', homedir: HOME });
    expect(root).toBe(defaultGlobalKnowledgeDir(HOME));
    expect(root).toBe(path.join(HOME, 'TB-Software', 'Knowledge'));
  });

  it('resolves GLOBAL root to a configured dir (with home expansion)', () => {
    const root = resolveKnowledgeRoot({
      scope: 'global',
      workingDir: 'ignored',
      globalDir: '~/KB',
      homedir: HOME,
    });
    expect(root).toBe(path.resolve(path.join(HOME, 'KB')));
  });

  it('assembles all chat paths under the resolved root', () => {
    const p = chatKnowledgePaths({
      scope: 'local',
      workingDir: 'D:\\P',
      title: 'Mein Chat',
      sessionId: 'ses_1',
    });
    expect(p.root).toBe(path.join('D:\\P', '.knowledge'));
    expect(p.chatDir).toBe(path.join('D:\\P', '.knowledge', 'chats', 'mein-chat__ses_1'));
    expect(p.summaryMd).toBe(path.join(p.chatDir, 'summary.md'));
    expect(p.chatMd).toBe(path.join(p.chatDir, 'chat.md'));
    expect(p.detailsDir).toBe(path.join(p.chatDir, 'details'));
    expect(p.indexJson).toBe(path.join(p.chatDir, 'index.json'));
    expect(p.rootIndexMd).toBe(path.join(p.root, 'index.md'));
  });

  it('knowledgeEnabled defaults to true and honors false', () => {
    expect(knowledgeEnabled(undefined)).toBe(true);
    expect(knowledgeEnabled(null)).toBe(true);
    expect(knowledgeEnabled(true)).toBe(true);
    expect(knowledgeEnabled(false)).toBe(false);
    expect(knowledgeEnabled('false')).toBe(false);
    expect(knowledgeEnabled('true')).toBe(true);
  });
});
