// TB-Software: Auto-Update über den t78.ch-Feed (gleiches Muster wie LenaX-DB / NInfer).
//
// Der Feed `latest.ashx` im Downloads-Ordner leitet per 302 auf die neueste
// `TB-Goose-v<version>.zip` um. Wir folgen dem Redirect mit HEAD, lesen die Version aus
// dem finalen Dateinamen, vergleichen mit der App-Version und liefern die Download-URL.
// Herunterladen/Entpacken/Neustart übernimmt weiterhin der bestehende githubUpdater —
// diese Datei tauscht nur die PRÜF-/BEZUGSQUELLE (GitHub -> t78.ch).
import { app } from 'electron';
import { compareVersions } from 'compare-versions';
import log from './logger';

// Öffentlicher Feed (out-of-the-box). Überschreibbar per TBGOOSE_UPDATE_FEED;
// leer = Auto-Update deaktiviert.
const DEFAULT_FEED = 'https://t78.ch/apps/tbgoose/downloads/latest.ashx';

export function t78FeedUrl(): string | null {
  const v = process.env.TBGOOSE_UPDATE_FEED;
  if (v === undefined) return DEFAULT_FEED;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface T78CheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  sha256Url?: string;
  error?: string;
}

// Dateinamensmuster des Feeds: TB-Goose-v1.50.1.zip
const VERSION_RE = /TB-Goose-v(\d+(?:\.\d+){1,3})\.zip/i;

export async function checkT78Feed(): Promise<T78CheckResult> {
  const feed = t78FeedUrl();
  const currentVersion = app.getVersion();
  if (!feed) {
    return { updateAvailable: false, currentVersion, error: 'feed disabled' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    // HEAD + Redirects folgen: res.url ist die finale ZIP-URL (kein Body geladen).
    const res = await fetch(feed, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': `TB-Goose/${currentVersion}` },
    });
    clearTimeout(timeout);

    const finalUrl = res.url || feed;
    const match = VERSION_RE.exec(finalUrl) || VERSION_RE.exec(decodeURIComponent(finalUrl));
    if (!match) {
      // Kein versioniertes ZIP hinter dem Feed (z. B. "No download available").
      return { updateAvailable: false, currentVersion, error: `no versioned asset: ${finalUrl}` };
    }
    const latestVersion = match[1];
    const downloadUrl = finalUrl;
    const sha256Url = `${downloadUrl}.sha256.txt`;
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    log.info(
      `[TB] t78-Feed: aktuell ${currentVersion}, neueste ${latestVersion}, Update verfügbar: ${updateAvailable}`
    );
    return { updateAvailable, currentVersion, latestVersion, downloadUrl, sha256Url };
  } catch (error) {
    log.error('[TB] t78-Feed-Check fehlgeschlagen', error);
    return { updateAvailable: false, currentVersion, error: (error as Error).message };
  }
}

// Prüft die SHA-256 einer heruntergeladenen Datei gegen den `.sha256.txt`-Sidecar des Feeds.
// Ist der Sidecar erreichbar, MUSS die Summe passen (Schutz vor manipuliertem Paket);
// fehlt er (404) oder ist unbrauchbar, wird nicht blockiert.
export async function verifyT78Sha256(filePath: string, sha256Url: string): Promise<boolean> {
  try {
    const res = await fetch(sha256Url);
    if (!res.ok) {
      log.warn(`[TB] sha256-Sidecar nicht abrufbar (HTTP ${res.status}) — Prüfung übersprungen`);
      return true;
    }
    const expected = (await res.text()).trim().toLowerCase().split(/\s+/)[0];
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      log.warn('[TB] sha256-Sidecar unbrauchbar — Prüfung übersprungen');
      return true;
    }
    const crypto = await import('node:crypto');
    const fs = await import('node:fs');
    const actual = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
    const ok = actual === expected;
    if (!ok) {
      log.error(`[TB] sha256-Mismatch: erwartet ${expected}, berechnet ${actual}`);
    }
    return ok;
  } catch (error) {
    log.warn('[TB] sha256-Prüfung fehlgeschlagen — übersprungen', error);
    return true;
  }
}
