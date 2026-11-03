import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'react-toastify';
import { copyAbsolutePath, extractPath } from './copyPath';

describe('extractPath', () => {
  it('erkennt einen Windows-Pfad mit Leerzeichen vollstaendig', () => {
    expect(extractPath('Read Image source: C:\\Temp\\screenshot - 2026_11_02 11-25-19.jpg')).toBe(
      'C:\\Temp\\screenshot - 2026_11_02 11-25-19.jpg'
    );
  });

  it('nimmt den laengsten Treffer bei mehreren Pfaden', () => {
    expect(extractPath('C:\\a\\x.md vs D:\\lange\\tiefe\\datei mit namen.pdf')).toBe(
      'D:\\lange\\tiefe\\datei mit namen.pdf'
    );
  });

  it('erkennt Unix-Pfade weiterhin', () => {
    expect(extractPath('siehe /var/log/app.log hier')).toBe('/var/log/app.log');
  });

  it('kein Pfad -> null', () => {
    expect(extractPath('nur normaler Text, Version 1.2.3')).toBeNull();
  });
});

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
