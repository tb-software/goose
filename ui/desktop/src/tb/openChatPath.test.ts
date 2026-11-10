import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveChatPathVerified } from './openChatPath';

function setResolver(fn: ((raw: string) => unknown) | undefined) {
  (window as unknown as { electron?: { tbResolveFile?: unknown } }).electron = fn
    ? { tbResolveFile: fn }
    : {};
}

afterEach(() => {
  setResolver(undefined);
  vi.restoreAllMocks();
});

describe('resolveChatPathVerified', () => {
  it('nimmt den verifizierten Pfad aus dem Main-Prozess, wenn vorhanden', async () => {
    setResolver(async () => ({ ok: true, path: 'C:\\echt\\tief\\report.md', reason: 'found' }));
    const out = await resolveChatPathVerified('report.md', 'C:\\work');
    expect(out).toBe('C:\\echt\\tief\\report.md');
  });

  it('faellt auf die synchrone Vermutung zurueck, wenn der Resolver nichts findet', async () => {
    setResolver(async () => ({ ok: false, path: null, reason: 'missing' }));
    const out = await resolveChatPathVerified('report.md', 'C:\\work');
    expect(out).toBe('C:\\work\\report.md');
  });

  it('faellt auf die synchrone Vermutung zurueck, wenn der Resolver wirft (offline)', async () => {
    setResolver(() => {
      throw new Error('kein IPC');
    });
    const out = await resolveChatPathVerified('unterordner/report.md', 'C:\\work');
    expect(out).toBe('C:\\work\\unterordner\\report.md');
  });

  it('gibt null, wenn weder Resolver noch Vermutung einen Pfad liefern', async () => {
    setResolver(async () => ({ ok: false, path: null, reason: 'missing' }));
    const out = await resolveChatPathVerified('nur fliesstext ohne datei', null);
    expect(out).toBeNull();
  });
});
