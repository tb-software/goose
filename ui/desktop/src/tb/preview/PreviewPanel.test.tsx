import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useEffect } from 'react';
import { render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { PreviewProvider, usePreview } from './PreviewContext';
import { PreviewPanel } from './PreviewPanel';

const Opener: React.FC<{ path: string }> = ({ path }) => {
  const p = usePreview();
  useEffect(() => {
    p?.open(path);
  }, [path, p]);
  return null;
};

function renderWithPath(path: string) {
  return render(
    <PreviewProvider>
      <Opener path={path} />
      <PreviewPanel />
    </PreviewProvider>
  );
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    (window as unknown as { electron: unknown }).electron = {
      tbReadFile: vi.fn(),
      showItemInFolder: vi.fn(),
    };
  });

  it('rendert Text-Dateien als Klartext', async () => {
    (window.electron.tbReadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      encoding: 'utf8',
      data: 'hallo welt',
      mime: 'text/plain',
    });
    renderWithPath('C:\\tmp\\note.txt');
    expect(await screen.findByText('hallo welt')).toBeTruthy();
    expect(window.electron.tbReadFile).toHaveBeenCalledWith('C:\\tmp\\note.txt');
  });

  it('rendert Bilder als data-URL', async () => {
    (window.electron.tbReadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      encoding: 'base64',
      data: 'QUJD',
      mime: 'image/png',
    });
    renderWithPath('C:\\tmp\\pic.png');
    const img = await screen.findByRole('img');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,QUJD');
  });

  it('zeigt Fallback fuer unbekannten Typ und liest die Datei NICHT', () => {
    renderWithPath('C:\\tmp\\archive.zip');
    expect(screen.getByText(/Keine Vorschau/)).toBeTruthy();
    expect(window.electron.tbReadFile).not.toHaveBeenCalled();
  });
});
