import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'react-toastify';
import { copyAbsolutePath } from './copyPath';

describe('copyAbsolutePath', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leerer/nuller/whitespace Pfad = no-op (kein Copy, kein Toast)', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    await copyAbsolutePath('');
    await copyAbsolutePath(null);
    await copyAbsolutePath(undefined);
    await copyAbsolutePath('   ');
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('kopiert den getrimmten absoluten Pfad + Erfolgs-Toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await copyAbsolutePath('  C:\\Projekte\\Bericht.md  ');
    expect(writeText).toHaveBeenCalledWith('C:\\Projekte\\Bericht.md');
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Fallback über execCommand, wenn die Clipboard-API wirft', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.assign(navigator, { clipboard: { writeText } });
    const exec = vi.fn().mockReturnValue(true);
    // execCommand existiert in jsdom nicht zuverlässig -> mocken.
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    await copyAbsolutePath('C:\\x\\y.txt');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
