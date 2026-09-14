import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchSwapScript, prepareUpdateInstall } from './githubUpdater';

const tempDirs: string[] = [];

function run(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))
    );
  });
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeLauncher(dir: string, markerPath: string): Promise<string> {
  if (process.platform === 'win32') {
    const launcher = path.join(dir, 'Goose.cmd');
    await fs.writeFile(launcher, `@echo off\r\necho relaunched> "${markerPath}"\r\n`);
    return launcher;
  }

  const launcher = path.join(dir, 'Goose');
  await fs.writeFile(launcher, `#!/bin/sh\necho relaunched > "${markerPath}"\n`, { mode: 0o755 });
  return launcher;
}

function executableRelativePath(): string {
  if (process.platform === 'darwin') {
    return path.join('Contents', 'MacOS', 'Goose');
  }
  return process.platform === 'win32' ? 'Goose.cmd' : 'Goose';
}

async function makePayload(root: string, version: string, markerPath: string): Promise<string> {
  if (process.platform === 'darwin') {
    const bundle = path.join(root, 'Goose.app');
    const macOsDir = path.join(bundle, 'Contents', 'MacOS');
    await fs.mkdir(macOsDir, { recursive: true });
    await fs.writeFile(
      path.join(bundle, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Goose</string>
<key>CFBundleIdentifier</key><string>dev.goose.updater.test.${version}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`
    );
    await writeLauncher(macOsDir, markerPath);
    await fs.writeFile(path.join(bundle, 'version.txt'), version);
    return bundle;
  }

  const payload = path.join(root, 'Goose');
  await fs.mkdir(payload, { recursive: true });
  await writeLauncher(payload, markerPath);
  await fs.writeFile(path.join(payload, 'version.txt'), version);
  return payload;
}

// A structurally valid payload directory that was packaged without the application executable.
async function makeEmptyPayload(root: string): Promise<string> {
  const payload = path.join(root, process.platform === 'darwin' ? 'Goose.app' : 'Goose');
  await fs.mkdir(payload, { recursive: true });
  await fs.writeFile(path.join(payload, 'README.txt'), 'no executable here');
  return payload;
}

async function zip(payloadPath: string, archivePath: string): Promise<void> {
  const parent = path.dirname(payloadPath);
  const name = path.basename(payloadPath);

  if (process.platform === 'darwin') {
    await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', name, archivePath], parent);
  } else if (process.platform === 'win32') {
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path '${payloadPath}' -DestinationPath '${archivePath}' -Force`,
      ],
      parent
    );
  } else {
    await run('zip', ['-r', '-q', archivePath, name], parent);
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function listTree(dir: string, prefix = ''): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return `${prefix}(missing)\n`;
  }

  let out = '';
  for (const entry of entries) {
    out += `${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;
    if (entry.isDirectory() && prefix.length < 4) {
      out += await listTree(path.join(dir, entry.name), `${prefix}  `);
    }
  }
  return out;
}

// The swap script deletes its staging directory when it finishes, so its log is written to a
// stable path OUTSIDE staging and is the only record of why a background script gave up.
async function diagnostics(logPath: string, installRoot: string): Promise<string> {
  const logText = await fs.readFile(logPath, 'utf8').catch(() => '(no update log)');
  return [
    '',
    '--- tb-update.log ---',
    logText,
    '--- install dir ---',
    await listTree(installRoot),
  ].join('\n');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('prepareUpdateInstall', () => {
  it('waits for the app to exit, swaps in the new version, and relaunches it', async () => {
    const workspace = await makeTempDir('goose-update-test-');
    const logPath = path.join(workspace, 'tb-update.log');
    const stagingDir = path.join(workspace, 'staging');
    const payloadSource = path.join(workspace, 'payload');
    const installRoot = path.join(workspace, 'install');
    const markerPath = path.join(workspace, 'relaunched.txt');
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(payloadSource, { recursive: true });
    await fs.mkdir(installRoot, { recursive: true });

    const newPayload = await makePayload(payloadSource, '2.0.0', markerPath);
    const archivePath = path.join(stagingDir, 'Goose-2.0.0.zip');
    await zip(newPayload, archivePath);

    const installedRoot = await makePayload(installRoot, '1.0.0', markerPath);
    const versionFile = path.join(installedRoot, 'version.txt');

    const relaunchPath =
      process.platform === 'darwin'
        ? installedRoot
        : path.join(installedRoot, executableRelativePath());

    const runningApp = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const swap = await prepareUpdateInstall({
      archivePath,
      targetPath: installedRoot,
      relaunchPath,
      executableRelativePath: executableRelativePath(),
      pid: runningApp.pid!,
      logPath,
    });

    launchSwapScript(swap);

    const unrelatedFile = path.join(installRoot, 'unrelated-user-file.txt');
    await fs.writeFile(unrelatedFile, 'keep me');

    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(await fs.readFile(versionFile, 'utf8')).toBe('1.0.0');
    expect(await exists(markerPath)).toBe(false);

    runningApp.kill();
    await new Promise((resolve) => runningApp.once('exit', resolve));

    const swapped = await waitFor(
      async () => (await fs.readFile(versionFile, 'utf8').catch(() => '')) === '2.0.0',
      60000
    );
    expect(swapped, await diagnostics(logPath, installRoot)).toBe(true);
    expect(await waitFor(() => exists(markerPath), 60000)).toBe(true);
    expect(await waitFor(async () => !(await exists(stagingDir)), 60000)).toBe(true);
    expect(await fs.readFile(unrelatedFile, 'utf8')).toBe('keep me');
    expect(await exists(`${installedRoot}.goose-previous`)).toBe(false);
  }, 150000);

  it('leaves the existing install intact when the new payload cannot be copied', async () => {
    const workspace = await makeTempDir('goose-update-rollback-');
    const logPath = path.join(workspace, 'tb-update.log');
    const stagingDir = path.join(workspace, 'staging');
    const payloadSource = path.join(workspace, 'payload');
    const installRoot = path.join(workspace, 'install');
    const markerPath = path.join(workspace, 'relaunched.txt');
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(payloadSource, { recursive: true });
    await fs.mkdir(installRoot, { recursive: true });

    const newPayload = await makePayload(payloadSource, '2.0.0', markerPath);
    const archivePath = path.join(stagingDir, 'Goose-2.0.0.zip');
    await zip(newPayload, archivePath);

    const installedRoot = await makePayload(installRoot, '1.0.0', markerPath);
    const versionFile = path.join(installedRoot, 'version.txt');

    const relaunchPath =
      process.platform === 'darwin'
        ? installedRoot
        : path.join(installedRoot, executableRelativePath());

    const exitedApp = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => exitedApp.once('exit', resolve));

    const swap = await prepareUpdateInstall({
      archivePath,
      targetPath: installedRoot,
      relaunchPath,
      executableRelativePath: executableRelativePath(),
      pid: exitedApp.pid!,
      logPath,
    });

    // Deleting the extracted payload makes the copy step fail, exercising the failure path.
    await fs.rm(path.join(stagingDir, 'extracted'), { recursive: true, force: true });

    launchSwapScript(swap);

    // The copy-over swap never touches the install until it can read the payload, so a failed
    // copy leaves the old version in place. The app is still relaunched at the end of the swap,
    // so the marker proves the script ran to completion rather than aborting silently.
    const relaunched = await waitFor(() => exists(markerPath), 30000);
    expect(relaunched, await diagnostics(logPath, installRoot)).toBe(true);
    expect(await exists(`${installedRoot}.goose-previous`)).toBe(false);
    expect(await fs.readFile(versionFile, 'utf8')).toBe('1.0.0');
    expect(await exists(path.join(installedRoot, executableRelativePath()))).toBe(true);
  }, 60000);

  it('refuses to install a payload that is missing its executable', async () => {
    const workspace = await makeTempDir('goose-update-invalid-');
    const stagingDir = path.join(workspace, 'staging');
    const payloadSource = path.join(workspace, 'payload');
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(payloadSource, { recursive: true });

    const emptyPayload = await makeEmptyPayload(payloadSource);
    const archivePath = path.join(stagingDir, 'Goose-2.0.0.zip');
    await zip(emptyPayload, archivePath);

    await expect(
      prepareUpdateInstall({
        archivePath,
        targetPath: path.join(workspace, 'install', 'Goose'),
        relaunchPath: path.join(workspace, 'install', 'Goose'),
        executableRelativePath: executableRelativePath(),
        pid: process.pid,
        logPath: path.join(workspace, 'tb-update.log'),
      })
    ).rejects.toThrow(/missing its executable/);
  }, 60000);

  // Fast, no-spawn regression guard for the swap-script contract (Milestone [11]):
  // copy-over-in-place, kill lingering processes by name, and log to a stable path that
  // survives the staging cleanup. These are the exact properties whose absence made earlier
  // GUI updates silently leave the old version in place with no trace.
  it('generates a copy-over swap script that kills by name and logs to a stable path', async () => {
    const workspace = await makeTempDir('goose-update-script-');
    const stagingDir = path.join(workspace, 'staging');
    const payloadSource = path.join(workspace, 'payload');
    const installRoot = path.join(workspace, 'install');
    const markerPath = path.join(workspace, 'relaunched.txt');
    const logPath = path.join(workspace, 'tb-update.log');
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(payloadSource, { recursive: true });
    await fs.mkdir(installRoot, { recursive: true });

    const newPayload = await makePayload(payloadSource, '2.0.0', markerPath);
    const archivePath = path.join(stagingDir, 'Goose-2.0.0.zip');
    await zip(newPayload, archivePath);

    const installedRoot = await makePayload(installRoot, '1.0.0', markerPath);
    const relaunchPath =
      process.platform === 'darwin'
        ? installedRoot
        : path.join(installedRoot, executableRelativePath());

    const swap = await prepareUpdateInstall({
      archivePath,
      targetPath: installedRoot,
      relaunchPath,
      executableRelativePath: executableRelativePath(),
      pid: 424242,
      logPath,
    });

    const scriptPath = swap.args[swap.args.length - 1];
    const script = await fs.readFile(scriptPath, 'utf8');

    // The log path must be embedded verbatim so the "Update-Protokoll öffnen" button finds it.
    expect(script).toContain(logPath);
    // Copy-over, never move the running install aside (a single locked file broke the old move).
    expect(script).not.toContain('goose-previous');
    // \b keeps this from matching the "move-Item" inside the cleanup's Remove-Item.
    expect(script).not.toMatch(/\bMove-Item/i);

    if (process.platform === 'win32') {
      expect(script).toMatch(/Copy-Item/);
      // Kill our own app/backend by specific name...
      expect(script).toContain("Get-Process -Name 'TB-Goose','goose'");
      // ...but crashpad_handler only when its path is under our install dir (never foreign ones).
      expect(script).toMatch(/Get-Process -Name 'crashpad_handler'[^\n]*StartsWith\(\$prefix\)/);
      expect(script).toMatch(/Start-Process -FilePath/);
    } else if (process.platform === 'darwin') {
      expect(script).toMatch(/ditto /);
    } else {
      expect(script).toMatch(/cp -a /);
    }
  }, 60000);
});
