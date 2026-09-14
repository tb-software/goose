import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as fss from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareUpdateInstall } from './githubUpdater';

// Windows-only: runs the REAL generated swap script directly (synchronously) and inspects its
// stderr and log. This is the regression guard for the two defects that made GUI updates fail
// silently — the app closed, but no version was swapped and no log was written:
//   1. The script carries German log text (ü/ö/ä) and an em-dash (—). Written without a UTF-8
//      BOM, Windows PowerShell 5.1 decodes it as Windows-1252 and the mis-decoded bytes break the
//      parser BEFORE the first log line -> ParserError on stderr, powershell exits, nothing runs.
//   2. The lingering-process kill loop matched 'crashpad_handler' by its generic name, which every
//      Electron/Chrome app has. It kept trying to kill FOREIGN crashpads forever, so the copy step
//      was never reached and the update hung.
// A direct run surfaces the ParserError on stderr explicitly and proves the swap completes fast.

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makePayload(root: string, version: string, marker: string): Promise<string> {
  const payload = path.join(root, 'Goose');
  await fs.mkdir(payload, { recursive: true });
  await fs.writeFile(path.join(payload, 'Goose.cmd'), `@echo off\r\necho relaunched> "${marker}"\r\n`);
  await fs.writeFile(path.join(payload, 'version.txt'), version);
  return payload;
}

describe('generated swap script (win32)', () => {
  it('parses cleanly, swaps the version, and writes a readable log', async () => {
    if (process.platform !== 'win32') return;

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'goose-script-'));
    tempDirs.push(workspace);
    const stagingDir = path.join(workspace, 'staging');
    const installRoot = path.join(workspace, 'install');
    const marker = path.join(workspace, 'relaunched.txt');
    const logPath = path.join(workspace, 'tb-update.log');
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(installRoot, { recursive: true });

    const payload = await makePayload(path.join(workspace, 'payload'), '2.0.0', marker);
    const archivePath = path.join(stagingDir, 'Goose-2.0.0.zip');
    spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Compress-Archive -Path '${payload}' -DestinationPath '${archivePath}' -Force`],
      { stdio: 'ignore' }
    );
    const installedRoot = await makePayload(installRoot, '1.0.0', marker);

    const swap = await prepareUpdateInstall({
      archivePath,
      targetPath: installedRoot,
      relaunchPath: path.join(installedRoot, 'Goose.cmd'),
      executableRelativePath: 'Goose.cmd',
      pid: 999999, // no such process -> the wait loop exits immediately
      relaunch: false, // don't spawn a stray relaunch during the test
      logPath,
    });

    const scriptPath = swap.args[swap.args.length - 1];
    const res = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { encoding: 'utf8', timeout: 30000 }
    );

    const log = fss.existsSync(logPath) ? fss.readFileSync(logPath, 'utf8') : '';
    const context = `status=${res.status}\nstderr=${res.stderr}\nlog=${log}`;

    // No parser/runtime error reached stderr (the BOM regression).
    expect(res.stderr, context).toBe('');
    // The swap ran to completion instead of hanging in the kill loop (the crashpad regression).
    expect(log, context).toContain('SWAP OK');
    expect(await fs.readFile(path.join(installedRoot, 'version.txt'), 'utf8')).toBe('2.0.0');
    // The German text survived the encoding round-trip, proving the BOM took effect.
    expect(log).toContain('über');
  }, 60000);
});
