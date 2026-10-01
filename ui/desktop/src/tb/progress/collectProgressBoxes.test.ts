import { describe, it, expect } from 'vitest';
import type { Message } from '../../types/message';
import { collectProgressBoxes } from './collectProgressBoxes';

function request(id: string, name: string, args: Record<string, unknown>): Message {
  return {
    role: 'assistant',
    created: 0,
    content: [{ type: 'toolRequest', id, toolCall: { status: 'success', value: { name, arguments: args } } }],
    metadata: { userVisible: true, agentVisible: true },
  };
}

function response(id: string, json: Record<string, unknown>): Message {
  return {
    role: 'user',
    created: 0,
    content: [
      {
        type: 'toolResponse',
        id,
        toolResult: { status: 'success', value: { content: [{ type: 'text', text: JSON.stringify(json) }] } },
      },
    ],
    metadata: { userVisible: true, agentVisible: true },
  };
}

const start = { taskId: 'tx_abc', status: 'queued', audioSekunden: 600, geschaetzteGesamtSek: 2445 };
const poll68 = { taskId: 'tx_abc', status: 'transcribing', fortschrittProzent: 68, phase: 'Transkribiert (68%)' };
const poll96 = { taskId: 'tx_abc', status: 'diarizing', fortschrittProzent: 96, phase: 'Sprecher werden getrennt' };
const poolDone = {
  taskId: 'tx_abc',
  status: 'done',
  phase: 'Fertig',
  ergebnis: { anzahlSprecher: 3, text: '[SPEAKER_00] Hallo', transkriptDatei: '/files/m_transkript.txt' },
};

describe('collectProgressBoxes', () => {
  it('fasst Polls gleicher taskId zu EINER Box zusammen', () => {
    const messages: Message[] = [
      request('r1', 'lenax-flow__transcribe-async', { file: '/files/meeting_4min.mp3' }),
      response('r1', start),
      request('r2', 'lenax-flow__transcribe-status', { taskId: 'tx_abc' }),
      response('r2', poll68),
      request('r3', 'lenax-flow__transcribe-status', { taskId: 'tx_abc' }),
      response('r3', poll96),
      request('r4', 'lenax-flow__transcribe-status', { taskId: 'tx_abc' }),
      response('r4', poolDone),
    ];

    const { boxes, claimedKeys } = collectProgressBoxes(messages);
    expect(boxes.size).toBe(1);
    const box = boxes.get('tx_abc')!;
    expect(box.pollCount).toBe(4);
    expect(box.raw).toHaveLength(4);
    expect(box.latest.status).toBe('done');
    expect(box.anchorIndex).toBe(7);
    expect(box.requestIds).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(box.seed.title).toBe('meeting_4min.mp3');
    expect(box.seed.audioSekunden).toBe(600);
    expect(box.seed.geschaetzteGesamtSek).toBe(2445);

    for (const id of ['r1', 'r2', 'r3', 'r4']) expect(claimedKeys.has(id)).toBe(true);
  });

  it('nimmt den Dateinamen aus einer url-Eingabe', () => {
    const messages: Message[] = [
      request('r1', 'lenax-flow__transcribe-async', { url: 'https://host/audio/call.wav?x=1' }),
      response('r1', start),
    ];
    const box = collectProgressBoxes(messages).boxes.get('tx_abc')!;
    expect(box.seed.title).toBe('call.wav');
  });

  it('nutzt die Tool-Request-ID als Fallback-Key ohne taskId', () => {
    const messages: Message[] = [
      request('solo', 'some__tool', {}),
      response('solo', { status: 'running', fortschrittProzent: 40, phase: 'laeuft' }),
    ];
    const { boxes, claimedKeys } = collectProgressBoxes(messages);
    expect(boxes.has('solo')).toBe(true);
    expect(boxes.get('solo')!.taskId).toBeUndefined();
    expect(claimedKeys.has('solo')).toBe(true);
  });

  it('ignoriert Tool-Ergebnisse ohne Fortschritt', () => {
    const messages: Message[] = [
      request('r1', 'some__tool', {}),
      response('r1', { foo: 'bar', ergebnis: 42 }),
    ];
    const { boxes, claimedKeys } = collectProgressBoxes(messages);
    expect(boxes.size).toBe(0);
    expect(claimedKeys.size).toBe(0);
  });
});
