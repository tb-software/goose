// TB-Software: Rechtssicherer Erst-Start-Warnhinweis mit DREIFACHER Bestätigung.
//
// Zweck (Haftung): Niemand soll behaupten können, er habe nicht bestätigt, dass TB-Goose als
// autonomer Agent Dateien erstellen/ändern/löschen kann — auf diesem PC UND auf allem, was
// darüber erreichbar ist (Netzlaufwerke, Server, Cloud). Die Zustimmung wird als Audit
//   1) LOKAL im Benutzerprofil gespeichert (tamper-evident, eigene Datei),
//   2) für die Anzeige in den Einstellungen bereitgestellt,
//   3) an die Statistik-Seite (PostHog) gemeldet.
import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import log from '../../utils/logger';

// Version des Warntextes. Ändert sich der Inhalt der Warnungen, MUSS diese Version erhöht werden
// → bestehende Zustimmungen gelten dann nicht mehr für den neuen Text (erneute Bestätigung nötig).
export const RISK_DISCLAIMER_VERSION = '1';

// Statistik-Seite: TBS EU-PostHog (öffentlicher Ingest-Key — nur schreibend, unbedenklich).
const POSTHOG_HOST = process.env.TB_POSTHOG_HOST || 'https://eu.i.posthog.com';
const POSTHOG_KEY =
  process.env.TB_POSTHOG_KEY || 'phc_nyAiM23QcWw3KFppagpUkP5XobUGVDoz9qL3a7N6cMJP';

export interface RiskAcknowledgement {
  step: number;
  text: string;
  acceptedAt: string; // ISO, clientseitig gestempelt (pro Schritt)
}

export interface RiskConsentRecord {
  disclaimerVersion: string;
  accepted: true;
  acceptedAt: string; // ISO, autoritativ im Hauptprozess gestempelt
  appVersion: string;
  osUser: string;
  hostname: string;
  platform: string;
  arch: string;
  method: string;
  acknowledgements: RiskAcknowledgement[];
}

function consentFile(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const cfgDir = path.join(appData, 'Block', 'goose', 'config');
  return path.join(cfgDir, 'tb-risk-consent.json');
}

export function readRiskConsent(): RiskConsentRecord | null {
  try {
    const f = consentFile();
    if (!fs.existsSync(f)) return null;
    const rec = JSON.parse(fs.readFileSync(f, 'utf8')) as RiskConsentRecord;
    // Nur gültig, wenn es die AKTUELLE Textversion bestätigt.
    if (rec?.accepted && rec.disclaimerVersion === RISK_DISCLAIMER_VERSION) return rec;
    return null;
  } catch (e) {
    log.error('[TB] readRiskConsent fehlgeschlagen', e);
    return null;
  }
}

async function reportToStats(rec: RiskConsentRecord): Promise<void> {
  try {
    const res = await fetch(`${POSTHOG_HOST.replace(/\/$/, '')}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: 'tb_risk_consent_accepted',
        distinct_id: `${rec.hostname}::${rec.osUser}`,
        timestamp: rec.acceptedAt,
        properties: {
          disclaimer_version: rec.disclaimerVersion,
          app_version: rec.appVersion,
          os_user: rec.osUser,
          hostname: rec.hostname,
          platform: rec.platform,
          arch: rec.arch,
          method: rec.method,
          acknowledgement_count: rec.acknowledgements.length,
          acknowledgements: rec.acknowledgements,
          $lib: 'tb-goose-desktop',
        },
      }),
    });
    if (!res.ok) log.warn(`[TB] Risk-Consent-Statistik HTTP ${res.status}`);
    else log.info('[TB] Risk-Consent an Statistik gemeldet.');
  } catch (e) {
    // Statistik-Ausfall darf die Zustimmung nicht blockieren (lokales Audit ist maßgeblich).
    log.warn('[TB] Risk-Consent-Statistik nicht erreichbar (lokales Audit bleibt gültig)', e);
  }
}

function writeRiskConsent(acks: RiskAcknowledgement[]): RiskConsentRecord {
  const f = consentFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const rec: RiskConsentRecord = {
    disclaimerVersion: RISK_DISCLAIMER_VERSION,
    accepted: true,
    acceptedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    osUser: (() => {
      try {
        return os.userInfo().username;
      } catch {
        return process.env.USERNAME || 'unknown';
      }
    })(),
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    method: 'triple-step-wizard-v1',
    acknowledgements: acks,
  };
  // Schreibgeschützt-ish: erst schreiben, dann als Audit belassen. Bewusst eigene Datei
  // (nicht config.yaml), damit ein Config-Reset das Audit NICHT löscht.
  fs.writeFileSync(f, JSON.stringify(rec, null, 2));
  log.info(`[TB] Risk-Consent lokal gespeichert -> ${f}`);
  return rec;
}

export function registerRiskConsentIpc(): void {
  ipcMain.handle('tb-get-risk-consent', () => {
    const rec = readRiskConsent();
    return { accepted: !!rec, record: rec, disclaimerVersion: RISK_DISCLAIMER_VERSION };
  });

  ipcMain.handle('tb-accept-risk-consent', async (_e, acknowledgements: RiskAcknowledgement[]) => {
    if (!Array.isArray(acknowledgements) || acknowledgements.length < 3) {
      return { ok: false, error: 'Unvollständige Bestätigung (3 Schritte erforderlich).' };
    }
    try {
      const rec = writeRiskConsent(acknowledgements);
      void reportToStats(rec); // nicht blockieren
      return { ok: true, record: rec };
    } catch (e) {
      log.error('[TB] tb-accept-risk-consent fehlgeschlagen', e);
      return { ok: false, error: String(e) };
    }
  });
}
