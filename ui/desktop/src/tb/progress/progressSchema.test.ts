import { describe, it, expect } from 'vitest';
import { detectProgress, parseToolResultJson } from './progressSchema';

const queued = {
  taskId: 'tx_abc',
  status: 'queued',
  statusUrl: 'http://192.168.56.10:5678/webhook/transcribe-status?taskId=tx_abc',
  audioSekunden: 600,
  geschaetzteGesamtSek: 2445,
};

const transcribing = {
  status: 'transcribing',
  phase: 'Transkribiert (68%)',
  fortschritt: 0.68,
  fortschrittProzent: 68,
  aktuelleSekunde: 163,
  gesamtSekunden: 240,
  chunkAktuell: 2,
  chunks: 2,
  segmenteBisher: 37,
  letzterText: '... dann regelt ihr das beim Betreiber aus den Komponenten ...',
  laufzeitSek: 112,
  verbleibendCaSek: 70,
  audioSekunden: 240,
  inputBytes: 3984588,
  taskId: 'tx_abc',
};

const diarizing = {
  status: 'diarizing',
  phase: 'Sprecher werden getrennt',
  fortschritt: 0.96,
  fortschrittProzent: 96,
  taskId: 'tx_abc',
};

const done = {
  status: 'done',
  phase: 'Fertig',
  taskId: 'tx_abc',
  ergebnis: {
    sprache: 'de',
    anzahlSprecher: 3,
    text: '[SPEAKER_00] Hallo\n[SPEAKER_01] Servus',
    transkriptDatei: '/files/meeting_4min_transkript.txt',
    audioSekunden: 240,
  },
};

const errored = {
  status: 'error',
  fehler: 'WhisperX abgestuerzt',
  taskId: 'tx_abc',
};

describe('parseToolResultJson', () => {
  it('liest JSON aus einem Text-Block', () => {
    const result = {
      status: 'success',
      value: { content: [{ type: 'text', text: JSON.stringify(transcribing) }] },
    };
    expect(parseToolResultJson(result)).toMatchObject({ status: 'transcribing' });
  });

  it('bevorzugt structuredContent', () => {
    const result = {
      status: 'success',
      value: {
        structuredContent: diarizing,
        content: [{ type: 'text', text: JSON.stringify(transcribing) }],
      },
    };
    expect(parseToolResultJson(result)).toMatchObject({ status: 'diarizing' });
  });

  it('gibt null bei Nicht-JSON / falscher Form', () => {
    expect(parseToolResultJson(null)).toBeNull();
    expect(parseToolResultJson({ value: { content: [{ type: 'text', text: 'kein json' }] } })).toBeNull();
    expect(parseToolResultJson({ status: 'success' })).toBeNull();
  });
});

describe('detectProgress', () => {
  it('queued: Status + taskId, indeterminat, kein Prozent', () => {
    const p = detectProgress(queued)!;
    expect(p.status).toBe('queued');
    expect(p.taskId).toBe('tx_abc');
    expect(p.percent).toBeUndefined();
    expect(p.indeterminate).toBe(true);
  });

  it('transcribing: running, 68%, ETA, Live-Vorschau, Details', () => {
    const p = detectProgress(transcribing)!;
    expect(p.status).toBe('running');
    expect(p.percent).toBe(68);
    expect(p.indeterminate).toBe(false);
    expect(p.etaSec).toBe(70);
    expect(p.livePreview).toContain('Betreiber');
    const labels = p.details.map((d) => d.label);
    expect(labels).toContain('Position');
    expect(labels).toContain('Segmente');
    expect(labels).toContain('Phase');
    expect(labels).toContain('Groesse');
  });

  it('diarizing: running bei 96%', () => {
    const p = detectProgress(diarizing)!;
    expect(p.status).toBe('running');
    expect(p.percent).toBe(96);
  });

  it('done: Ergebnis + Headline mit Sprecher/Dauer/Datei', () => {
    const p = detectProgress(done)!;
    expect(p.status).toBe('done');
    expect(p.result).toMatchObject({ anzahlSprecher: 3 });
    expect(p.headline).toContain('3 Sprecher');
    expect(p.headline).toContain('meeting_4min_transkript.txt');
  });

  it('error: error-Status + Klartext', () => {
    const p = detectProgress(errored)!;
    expect(p.status).toBe('error');
    expect(p.error).toBe('WhisperX abgestuerzt');
  });

  it('taskId wird aus statusUrl extrahiert, wenn Feld fehlt', () => {
    const p = detectProgress({ status: 'queued', statusUrl: 'x?taskId=tx_z&foo=1' })!;
    expect(p.taskId).toBe('tx_z');
  });

  it('percent aus Bruch-Alias (fortschritt) berechnet', () => {
    const p = detectProgress({ fortschritt: 0.5, phase: 'laeuft' })!;
    expect(p.percent).toBe(50);
    expect(p.status).toBe('unknown');
  });

  it('Mindest-Konfidenz: percent allein reicht nicht', () => {
    expect(detectProgress({ percent: 50 })).toBeNull();
    expect(detectProgress({ foo: 1, bar: 'x' })).toBeNull();
  });

  it('Mindest-Konfidenz: percent + phase/taskId genuegt', () => {
    expect(detectProgress({ percent: 50, phase: 'x' })).not.toBeNull();
    expect(detectProgress({ percent: 50, taskId: 't' })).not.toBeNull();
  });
});
