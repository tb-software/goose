import { app } from 'electron';
import { compareVersions } from 'compare-versions';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import log from './logger';
import { safeJsonParse, errorMessage } from './conversionUtils';

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

interface UpdateCheckResult {
  updateAvailable: boolean;
  latestVersion?: string;
  downloadUrl?: string;
  releaseUrl?: string;
  error?: string;
}

interface InstallTarget {
  targetPath: string;
  relaunchPath: string;
  // Used to confirm the extracted payload really is an app, and to verify the new executable
  // exists after the copy-over swap.
  executableRelativePath: string;
}

interface SwapCommand {
  command: string;
  args: string[];
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  if (process.platform === 'darwin') {
    await runCommand('ditto', ['-x', '-k', archivePath, destDir]);
  } else if (process.platform === 'win32') {
    await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${powershellQuote(archivePath)} -DestinationPath ${powershellQuote(destDir)} -Force`,
    ]);
  } else {
    await runCommand('unzip', ['-q', '-o', archivePath, '-d', destDir]);
  }
}

async function resolvePayloadPath(extractDir: string): Promise<string> {
  let current = extractDir;

  for (let depth = 0; depth < 3; depth += 1) {
    const entries = (await fs.readdir(current, { withFileTypes: true })).filter(
      (entry) => !entry.name.startsWith('.') && entry.name !== '__MACOSX'
    );

    const appBundle = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
    if (appBundle) {
      return path.join(current, appBundle.name);
    }

    if (entries.length === 1 && entries[0].isDirectory()) {
      current = path.join(current, entries[0].name);
      continue;
    }

    return current;
  }

  return current;
}

// Electron ships these alongside the executable in every packaged build, so an install
// root always contains them. Their absence means the directory is not an install root.
const REQUIRED_INSTALL_DIRECTORIES = ['locales', 'resources'];

// Everything a packaged Electron app is allowed to place next to its executable. Anything
// else means the directory holds unrelated files and cannot be replaced wholesale.
const ELECTRON_RUNTIME_DIRECTORIES = new Set(['locales', 'resources', 'swiftshader']);

const ELECTRON_RUNTIME_FILES = new Set([
  'chrome-sandbox',
  'chrome_crashpad_handler',
  'icudtl.dat',
  'libvulkan.so.1',
  'license',
  'licenses.chromium.html',
  'version',
]);

const ELECTRON_RUNTIME_EXTENSIONS = new Set([
  '.bin',
  '.dat',
  '.dll',
  '.exe',
  '.html',
  '.json',
  '.node',
  '.pak',
  '.so',
  '.txt',
]);

// Directories users commonly unpack portable builds into. Replacing one of these
// wholesale would delete unrelated files, so an install there is never swapped.
const SHARED_DIRECTORY_NAMES = new Set([
  'applications',
  'appdata',
  'bin',
  'desktop',
  'documents',
  'downloads',
  'dropbox',
  'etc',
  'home',
  'local',
  'music',
  'onedrive',
  'opt',
  'pictures',
  'program files',
  'program files (x86)',
  'programdata',
  'roaming',
  'temp',
  'tmp',
  'usr',
  'users',
  'var',
  'videos',
]);

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function isSharedDirectory(dir: string): boolean {
  if (dir === path.parse(dir).root) {
    return true;
  }
  if (dir === path.resolve(os.homedir()) || dir === path.resolve(os.tmpdir())) {
    return true;
  }
  return SHARED_DIRECTORY_NAMES.has(path.basename(dir).toLowerCase());
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

// Packaged Electron apps always ship resources/app.asar (or an unpacked resources/app)
// alongside the locales directory, which distinguishes an install root from an arbitrary folder.
async function isPackagedAppDirectory(dir: string): Promise<boolean> {
  for (const required of REQUIRED_INSTALL_DIRECTORIES) {
    if (!(await isDirectory(path.join(dir, required)))) {
      return false;
    }
  }

  const resources = path.join(dir, 'resources');
  return (
    (await pathExists(path.join(resources, 'app.asar'))) ||
    (await pathExists(path.join(resources, 'app')))
  );
}

// A basename blacklist cannot prove a directory is safe to replace, so require that every
// entry belongs to a packaged Electron app. Anything else means the directory is shared
// with unrelated files that a wholesale swap would delete.
async function findUnexpectedInstallEntries(dir: string, exeName: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => {
      const name = entry.name.toLowerCase();
      if (name.startsWith('.') || name === exeName.toLowerCase()) {
        return false;
      }
      if (entry.isDirectory()) {
        return !ELECTRON_RUNTIME_DIRECTORIES.has(name);
      }
      return (
        !ELECTRON_RUNTIME_FILES.has(name) && !ELECTRON_RUNTIME_EXTENSIONS.has(path.extname(name))
      );
    })
    .map((entry) => entry.name);
}

export async function resolveInstallTarget(exePath: string): Promise<InstallTarget> {
  const resolvedExePath = path.resolve(exePath);

  if (process.platform === 'darwin') {
    const appPath = path.resolve(resolvedExePath, '..', '..', '..');
    if (!appPath.endsWith('.app')) {
      throw new Error(`Could not locate running .app bundle from ${resolvedExePath}`);
    }
    return {
      targetPath: appPath,
      relaunchPath: appPath,
      executableRelativePath: path.relative(appPath, resolvedExePath),
    };
  }

  const installDir = path.dirname(resolvedExePath);

  // TB-Software: Beim Self-Update IST dirname(exe) per Definition der App-Ordner (die laufende
  // App liegt dort). Der Tausch kopiert das neue Paket IN PLACE über den Ordner (copy-over) —
  // er verschiebt/löscht den Ordner NICHT. Der einzig gefährliche Fall ist ein GETEILTER
  // Systemordner (z. B. Desktop, Downloads, Programme-Wurzel), in den das Paket fremde Dateien
  // streuen würde. Das bleibt ein hartes Abbruch-Kriterium. Die übrigen Prüfungen (sieht es
  // „verpackt" aus / nur App-Dateien) waren zu streng und lehnten reale, gültige Installationen
  // ab (z. B. D:\_AI\Programs\TB-Goose). Sie werden zu WARNUNGEN — copy-over lässt Fremd-Dateien
  // unangetastet und prüft nach dem Kopieren, ob die neue Exe vorhanden ist (sonst bleibt Alt).
  if (isSharedDirectory(installDir)) {
    throw new Error(
      `Auto-Update abgebrochen: ${installDir} ist ein geteilter Systemordner. Bitte TB-Goose in einen eigenen Ordner verschieben (z. B. C:\\_AI\\Applications\\TB-Goose) und erneut versuchen.`
    );
  }

  if (!(await isPackagedAppDirectory(installDir))) {
    log.warn(
      `resolveInstallTarget: ${installDir} sieht nicht wie ein typischer Paket-Ordner aus — fahre trotzdem fort (Self-Update, Backup wird angelegt).`
    );
  }

  const unexpected = await findUnexpectedInstallEntries(installDir, path.basename(resolvedExePath));
  if (unexpected.length > 0) {
    log.warn(
      `resolveInstallTarget: Fremd-Einträge im App-Ordner (${unexpected.slice(0, 5).join(', ')}) — copy-over lässt sie unangetastet (weder gelöscht noch überschrieben).`
    );
  }

  return {
    targetPath: installDir,
    relaunchPath: resolvedExePath,
    executableRelativePath: path.basename(resolvedExePath),
  };
}

async function writeSwapScript(options: {
  stagingDir: string;
  payloadPath: string;
  targetPath: string;
  relaunchPath: string;
  executableRelativePath: string;
  pid: number;
  // false = nur tauschen, nicht neu starten (Installation beim Beenden -> App bleibt zu).
  relaunch: boolean;
  // STABILER, findbarer Pfad des Update-Protokolls (überlebt Staging-Cleanup; im UI öffenbar).
  logPath: string;
}): Promise<SwapCommand> {
  const { stagingDir, payloadPath, targetPath, relaunchPath, executableRelativePath, pid, relaunch, logPath } =
    options;

  if (process.platform === 'win32') {
    const scriptPath = path.join(stagingDir, 'swap-and-relaunch.ps1');
    const installedExe = powershellQuote(path.join(targetPath, executableRelativePath));
    // TB-Software (Milestone [11]): COPY-OVER-IN-PLACE nach dem bewährten LenaX-DB-Muster —
    // NICHT den laufenden Ordner verschieben (Move scheitert an einer einzigen gesperrten Datei).
    // Erst App+Backend per NAME und Pfad beenden, dann das Paket über den Ordner kopieren.
    const script = [
      `$ErrorActionPreference = 'Continue'`,
      `$target = ${powershellQuote(targetPath)}`,
      `$payload = ${powershellQuote(payloadPath)}`,
      `$installedExe = ${installedExe}`,
      `$log = ${powershellQuote(logPath)}`,
      `function L($m){ try { ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -LiteralPath $log -Append -Encoding UTF8 } catch {} }`,
      `L "===== swap start · pid=${pid} · relaunch=${relaunch} · target=$target ====="`,
      // 1) Auf das Beenden der Haupt-App warten (max ~60 s).
      `L "warte auf App-Ende (pid ${pid})..."`,
      `for ($i=0; $i -lt 120; $i++){ if (-not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 500 }`,
      `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { L "WARN: App-pid nach 60s noch aktiv — fahre trotzdem fort" } else { L "App beendet" }`,
      // 2) NUR EIGENE Rest-Prozesse hart beenden. Wichtig: 'crashpad_handler' ist ein generischer
      // Name (jede Electron/Chrome-App hat einen) — per Name zu killen würde FREMDE Prozesse treffen
      // und die Schleife endlos laufen lassen (deren Crashpad startet/bleibt), sodass das Kopieren nie
      // dran kam. Darum: App/Backend per spezifischem Namen, Crashpad NUR wenn seine Exe unter unserem
      // Installationsordner liegt. Das ist zudem schnell (kein Voll-Enum aller Prozess-Pfade).
      `$prefix = $target.ToLower().TrimEnd('\\') + '\\'`,
      `for ($k=0; $k -lt 30; $k++){`,
      `  $byApp = Get-Process -Name 'TB-Goose','goose' -ErrorAction SilentlyContinue`,
      `  $byCrashpad = Get-Process -Name 'crashpad_handler' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.ToLower().StartsWith($prefix) }`,
      `  $procs = @($byApp) + @($byCrashpad) | Sort-Object Id -Unique`,
      `  if (-not $procs) { break }`,
      `  L ("beende: " + (($procs | ForEach-Object { $_.ProcessName } | Select-Object -Unique) -join ','))`,
      `  $procs | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {} }`,
      `  Start-Sleep -Milliseconds 400`,
      `}`,
      `Start-Sleep -Milliseconds 700`,
      // 3) Paket ÜBER den Ordner kopieren (in place), mit Wiederholung falls Handles langsam frei werden.
      `L "kopiere Paket über Installation (in place)..."`,
      `$ok = $false`,
      `for ($c=0; $c -lt 20; $c++){`,
      `  try {`,
      `    $entries = (Get-ChildItem -LiteralPath $payload -Force).FullName`,
      `    Copy-Item -LiteralPath $entries -Destination $target -Recurse -Force -ErrorAction Stop`,
      `    if (Test-Path -LiteralPath $installedExe) { $ok = $true; break }`,
      `    L "Kopie ok, aber Exe fehlt noch — Versuch $c"`,
      `  } catch { L ("Kopierfehler (Versuch $c): " + $_.Exception.Message) }`,
      `  Start-Sleep -Milliseconds 800`,
      `}`,
      `if ($ok) { L "SWAP OK — neue Version liegt im Ordner" } else { L "SWAP FEHLGESCHLAGEN nach Wiederholungen — alte Version bleibt (Datei gesperrt?)" }`,
      // 4) Neustart (immer, wenn gewünscht — auch nach Teil-Fehlschlag, damit nie ohne App).
      ...(relaunch
        ? [`L "starte neu: $installedExe"`, `Start-Process -FilePath $installedExe`]
        : [`L "kein Neustart (Installation beim Beenden)"`]),
      // 5) Staging aufräumen — das LOG bleibt (stabiler Pfad, nicht im Staging).
      `Remove-Item -LiteralPath ${powershellQuote(stagingDir)} -Recurse -Force -ErrorAction SilentlyContinue`,
      `L "===== swap ende ====="`,
      '',
    ].join('\r\n');

    // TB-Software (Milestone [11]): Das Skript enthält deutsche Log-Texte mit Umlauten (ü/ö/ä)
    // und Gedankenstrichen (—). Windows PowerShell 5.1 liest eine BOM-LOSE Datei als Windows-1252,
    // NICHT als UTF-8 — dadurch werden Mehrbyte-UTF-8-Sequenzen fehlinterpretiert (z. B. wird aus
    // „—" ein Smart-Quote, das der Parser als String-Begrenzer wertet) und das Skript bricht mit
    // einem ParserError ab, BEVOR auch nur die erste Log-Zeile geschrieben wird. Das war die
    // eigentliche Ursache für „Update tut nichts, keine Version getauscht, kein Protokoll".
    // Mit UTF-8-BOM liest PowerShell die Datei korrekt.
    await fs.writeFile(scriptPath, `﻿${script}`, { encoding: 'utf8' });
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ],
    };
  }

  // POSIX: ebenfalls copy-over-in-place (kein Move der laufenden Wurzel).
  const scriptPath = path.join(stagingDir, 'swap-and-relaunch.sh');
  const quotedPayload = shellQuote(payloadPath);
  const quotedTarget = shellQuote(targetPath);
  const quotedRelaunch = shellQuote(relaunchPath);
  const quotedInstalledExe = shellQuote(path.join(targetPath, executableRelativePath));
  const copyCommand =
    process.platform === 'darwin'
      ? `ditto ${quotedPayload} ${quotedTarget}`
      : `cp -a ${quotedPayload}/. ${quotedTarget}/`;
  const relaunchCmds = !relaunch
    ? ['echo "no relaunch"']
    : process.platform === 'darwin'
      ? [`xattr -dr com.apple.quarantine ${quotedTarget} || true`, `open ${quotedRelaunch}`]
      : [`${quotedRelaunch} >/dev/null 2>&1 &`];

  const script = [
    '#!/bin/sh',
    `exec >> ${shellQuote(logPath)} 2>&1`,
    `echo "===== swap start pid=${pid} ====="`,
    'attempt=0',
    `while [ "$attempt" -lt 120 ]; do kill -0 ${pid} 2>/dev/null || break; sleep 0.5; attempt=$((attempt + 1)); done`,
    `${copyCommand} && [ -x ${quotedInstalledExe} ] && echo "SWAP OK" || echo "SWAP FAILED"`,
    ...relaunchCmds,
    `rm -rf ${shellQuote(stagingDir)}`,
    'echo "===== swap end ====="',
    '',
  ].join('\n');

  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  return { command: '/bin/sh', args: [scriptPath] };
}

// TB-Software: Das Swap-Skript MUSS das Beenden der App überleben. Der frühere Weg
// (spawn detached:false) wurde beim App-Quit mitbeendet (Konsole/Prozessgruppe) -> das Skript
// stoppte direkt nach dem Start, es fand kein Tausch/Neustart statt (real reproduziert).
// Lösung auf Windows: über `cmd /c start` einen EIGENSTÄNDIGEN Prozess mit eigener Konsole
// starten, der von der App vollständig losgelöst ist. POSIX: detached + eigene Session.
export function launchSwapScript(swap: SwapCommand): void {
  if (process.platform === 'win32') {
    // `start` erwartet als erstes (leeres) Argument den Fenstertitel. windowsHide versteckt das
    // cmd-Fenster; das per start gestartete powershell läuft losgelöst weiter, auch wenn die App
    // (und dieses cmd) enden.
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', '""', '/min', swap.command, ...swap.args],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();
    return;
  }
  const child = spawn(swap.command, swap.args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

// A ZIP can be valid yet packaged without the expected application, which would let the swap
// copy an unrunnable payload over a working install. Checking before the swap script even runs
// keeps the failure recoverable — the existing install is never touched.
async function assertPayloadIsRunnable(
  payloadPath: string,
  executableRelativePath: string
): Promise<void> {
  const executable = path.join(payloadPath, executableRelativePath);
  if (!(await pathExists(executable))) {
    throw new Error(
      `Update payload is missing its executable (expected ${executableRelativePath} in ${path.basename(payloadPath)})`
    );
  }

  if (process.platform === 'darwin' && !payloadPath.endsWith('.app')) {
    throw new Error(`Update payload is not an .app bundle: ${payloadPath}`);
  }
}

export async function prepareUpdateInstall(options: {
  archivePath: string;
  targetPath: string;
  relaunchPath: string;
  executableRelativePath: string;
  pid: number;
  relaunch?: boolean;
  logPath: string;
}): Promise<SwapCommand> {
  const stagingDir = path.dirname(options.archivePath);
  const extractDir = path.join(stagingDir, 'extracted');

  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });
  await extractArchive(options.archivePath, extractDir);

  const payloadPath = await resolvePayloadPath(extractDir);
  log.info(`GitHubUpdater: Update payload: ${payloadPath}`);

  await assertPayloadIsRunnable(payloadPath, options.executableRelativePath);

  return writeSwapScript({
    stagingDir,
    payloadPath,
    targetPath: options.targetPath,
    relaunchPath: options.relaunchPath,
    executableRelativePath: options.executableRelativePath,
    pid: options.pid,
    relaunch: options.relaunch !== false,
    logPath: options.logPath,
  });
}

// TB-Software: stabiler, findbarer Pfad des Update-Protokolls (im UI öffenbar, überlebt Swap).
export function tbUpdateLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'tb-update.log');
}
function tbAppendUpdateLog(line: string): void {
  try {
    const p = tbUpdateLogPath();
    require('node:fs').mkdirSync(path.dirname(p), { recursive: true });
    require('node:fs').appendFileSync(p, `${new Date().toISOString().replace('T', ' ').slice(0, 19)}  ${line}\n`);
  } catch {
    /* Log-Fehler nie fatal */
  }
}

export class GitHubUpdater {
  private readonly owner = process.env.GITHUB_OWNER || 'tb-software';
  private readonly repo = process.env.GITHUB_REPO || 'goose';
  private readonly bundleName = process.env.GOOSE_BUNDLE_NAME || 'TB-Goose';
  private readonly apiUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const startTime = Date.now();
    try {
      log.info('=== GitHubUpdater: STARTING UPDATE CHECK ===');
      log.info(`GitHubUpdater: API URL: ${this.apiUrl}`);
      log.info(`GitHubUpdater: Current app version: ${app.getVersion()}`);
      log.info(`GitHubUpdater: Timestamp: ${new Date().toISOString()}`);

      log.info('GitHubUpdater: Initiating fetch request...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        log.error('GitHubUpdater: Fetch request timed out after 30 seconds');
        controller.abort();
      }, 30000);

      const response = await fetch(this.apiUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': `Goose-Desktop/${app.getVersion()}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const fetchDuration = Date.now() - startTime;
      log.info(
        `GitHubUpdater: GitHub API response status: ${response.status} ${response.statusText} (took ${fetchDuration}ms)`
      );

      if (!response.ok) {
        const errorText = await response.text();
        log.error(`GitHubUpdater: GitHub API error response: ${errorText}`);
        throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
      }

      const release: GitHubRelease = await safeJsonParse<GitHubRelease>(
        response,
        'Failed to get GitHub release information'
      );
      log.info(`GitHubUpdater: Found release: ${release.tag_name} (${release.name})`);
      log.info(`GitHubUpdater: Release published at: ${release.published_at}`);
      log.info(`GitHubUpdater: Release assets count: ${release.assets.length}`);

      const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
      const currentVersion = app.getVersion();

      log.info(
        `GitHubUpdater: Current version: ${currentVersion}, Latest version: ${latestVersion}`
      );

      // Compare versions
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
      log.info(`GitHubUpdater: Update available: ${updateAvailable}`);

      if (!updateAvailable) {
        return {
          updateAvailable: false,
          latestVersion,
        };
      }

      // Find the appropriate download URL based on platform
      const platform = process.platform;
      const arch = process.arch;
      let downloadUrl: string | undefined;
      let assetName: string;

      log.info(`GitHubUpdater: Looking for asset for platform: ${platform}, arch: ${arch}`);

      if (platform === 'darwin') {
        // macOS
        if (arch === 'arm64') {
          assetName = `${this.bundleName}.zip`;
        } else {
          assetName = `${this.bundleName}_intel_mac.zip`;
        }
      } else if (platform === 'win32') {
        // Windows - for future support
        assetName = `${this.bundleName}-win32-x64.zip`;
      } else {
        // Linux - for future support
        assetName = `${this.bundleName}-linux-${arch}.zip`;
      }

      log.info(`GitHubUpdater: Looking for asset named: ${assetName}`);
      log.info(`GitHubUpdater: Available assets: ${release.assets.map((a) => a.name).join(', ')}`);

      const asset = release.assets.find((a) => a.name.toLowerCase() === assetName.toLowerCase()); // keeping comparison to lowercase because Goose vs goose
      if (asset) {
        downloadUrl = asset.browser_download_url;
        log.info(`GitHubUpdater: Found matching asset: ${asset.name} (${asset.size} bytes)`);
        log.info(`GitHubUpdater: Download URL: ${downloadUrl}`);
      } else {
        log.warn(`GitHubUpdater: No matching asset found for ${assetName}`);
      }

      if (!downloadUrl) {
        throw new Error(
          `Update Available but no download URL found for platform: ${platform}, arch: ${arch}`
        );
      }

      return {
        updateAvailable: true,
        latestVersion,
        downloadUrl,
        releaseUrl: release.html_url,
      };
    } catch (error) {
      log.error('GitHubUpdater: Error checking for updates:', error);
      log.error('GitHubUpdater: Error details:', {
        message: errorMessage(error, 'Unknown error'),
        stack: error instanceof Error ? error.stack : 'No stack',
        name: error instanceof Error ? error.name : 'Unknown',
        code:
          error instanceof Error && 'code' in error
            ? (error as Error & { code: unknown }).code
            : undefined,
      });
      return {
        updateAvailable: false,
        error: errorMessage(error, 'Unknown error'),
      };
    }
  }

  async downloadUpdate(
    downloadUrl: string,
    latestVersion: string,
    onProgress?: (percent: number, loadedBytes: number, totalBytes: number) => void
  ): Promise<{ success: boolean; downloadPath?: string; extractedPath?: string; error?: string }> {
    const downloadStartTime = Date.now();
    try {
      log.info('=== GitHubUpdater: STARTING DOWNLOAD ===');
      log.info(`GitHubUpdater: Download URL: ${downloadUrl}`);
      log.info(`GitHubUpdater: Version: ${latestVersion}`);
      log.info(`GitHubUpdater: Timestamp: ${new Date().toISOString()}`);

      log.info('GitHubUpdater: Initiating download fetch request...');
      const response = await fetch(downloadUrl);
      const fetchDuration = Date.now() - downloadStartTime;
      log.info(
        `GitHubUpdater: Download response received in ${fetchDuration}ms - Status: ${response.status} ${response.statusText}`
      );

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      // Get total size from headers
      const contentLength = response.headers.get('content-length');
      const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
      log.info(
        `GitHubUpdater: Content-Length: ${totalSize} bytes (${(totalSize / 1024 / 1024).toFixed(2)} MB)`
      );

      if (!response.body) {
        throw new Error('Response body is null');
      }
      let lastReportedPercent = -1; // Track last reported percentage to throttle updates
      let lastLoggedPercent = -1; // Track for logging at 10% intervals

      // Read the response stream
      log.info('GitHubUpdater: Starting to read response stream...');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let downloadedSize = 0;
      let lastProgressTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        downloadedSize += value.length;

        // Report progress - only when percentage changes by at least 1%
        if (totalSize > 0 && onProgress) {
          const percent = Math.round((downloadedSize / totalSize) * 100);

          // Only report if percent changed (throttles from hundreds/sec to ~100 total)
          if (percent !== lastReportedPercent) {
            onProgress(percent, downloadedSize, totalSize);
            lastReportedPercent = percent;

            // Log at 10% intervals for debugging
            if (percent % 10 === 0 && percent !== lastLoggedPercent) {
              const elapsed = Date.now() - downloadStartTime;
              const speed = downloadedSize / (elapsed / 1000) / 1024; // KB/s
              log.info(
                `GitHubUpdater: Download progress ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(2)}/${(totalSize / 1024 / 1024).toFixed(2)} MB) @ ${speed.toFixed(0)} KB/s`
              );
              lastLoggedPercent = percent;
            }
          }
        }

        // Warn if no progress for 30 seconds
        const now = Date.now();
        if (now - lastProgressTime > 30000) {
          log.warn(
            `GitHubUpdater: Download appears slow - no significant progress in 30 seconds (${downloadedSize}/${totalSize} bytes)`
          );
          lastProgressTime = now;
        } else if (value.length > 0) {
          lastProgressTime = now;
        }
      }

      const downloadDuration = Date.now() - downloadStartTime;
      const avgSpeed = downloadedSize / (downloadDuration / 1000) / 1024;
      log.info(
        `GitHubUpdater: Download stream complete - ${downloadedSize} bytes in ${downloadDuration}ms (avg ${avgSpeed.toFixed(0)} KB/s)`
      );

      // Combine chunks into a single buffer
      log.info('GitHubUpdater: Combining chunks into buffer...');
      const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      log.info(`GitHubUpdater: Buffer created - ${buffer.length} bytes`);

      const stagingDir = path.join(os.tmpdir(), `goose-update-${latestVersion}-${Date.now()}`);
      await fs.mkdir(stagingDir, { recursive: true });
      const fileName = `${this.bundleName}-${latestVersion}.zip`;
      const downloadPath = path.join(stagingDir, fileName);

      log.info(`GitHubUpdater: Writing file to ${downloadPath}...`);
      await fs.writeFile(downloadPath, buffer);

      const totalDuration = Date.now() - downloadStartTime;
      log.info(`=== GitHubUpdater: DOWNLOAD COMPLETE in ${totalDuration}ms ===`);
      log.info(`GitHubUpdater: File saved to ${downloadPath}`);

      return { success: true, downloadPath, extractedPath: stagingDir };
    } catch (error) {
      const duration = Date.now() - downloadStartTime;
      log.error(`=== GitHubUpdater: DOWNLOAD FAILED after ${duration}ms ===`);
      log.error('GitHubUpdater: Error downloading update:', error);
      log.error('GitHubUpdater: Download error details:', {
        message: errorMessage(error, 'Unknown error'),
        stack: error instanceof Error ? error.stack : 'No stack',
        name: error instanceof Error ? error.name : 'Unknown',
      });
      return {
        success: false,
        error: errorMessage(error, 'Unknown error'),
      };
    }
  }

  async installUpdate(
    downloadPath: string,
    relaunch = true
  ): Promise<{ success: boolean; error?: string }> {
    const logPath = tbUpdateLogPath();
    try {
      log.info('=== GitHubUpdater: STARTING AUTOMATIC INSTALL ===');
      tbAppendUpdateLog(
        `--- install requested (relaunch=${relaunch}, mainPid=${process.pid}, appVer=${app.getVersion()}) ---`
      );
      tbAppendUpdateLog(`download: ${downloadPath}`);

      await fs.access(downloadPath);

      const { targetPath, relaunchPath, executableRelativePath } = await resolveInstallTarget(
        app.getPath('exe')
      );
      log.info(`GitHubUpdater: Install target: ${targetPath}`);
      tbAppendUpdateLog(`install target: ${targetPath} (exe: ${executableRelativePath})`);

      const swap = await prepareUpdateInstall({
        archivePath: downloadPath,
        targetPath,
        relaunchPath,
        executableRelativePath,
        pid: process.pid,
        relaunch,
        logPath,
      });

      tbAppendUpdateLog(`swap script prepared, launching (${swap.command}); app will exit now.`);
      launchSwapScript(swap);

      log.info('=== GitHubUpdater: SWAP SCRIPT LAUNCHED, app will quit ===');
      return { success: true };
    } catch (error) {
      log.error('GitHubUpdater: Error installing update:', error);
      tbAppendUpdateLog(`ERROR installing update: ${errorMessage(error, 'Unknown error')}`);
      return {
        success: false,
        error: errorMessage(error, 'Unknown error'),
      };
    }
  }
}

// Create singleton instance
export const githubUpdater = new GitHubUpdater();
