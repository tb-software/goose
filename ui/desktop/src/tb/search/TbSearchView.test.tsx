import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { PreviewProvider } from '../preview/PreviewContext';
import { TbSearchView } from './TbSearchView';

describe('TbSearchView', () => {
  beforeEach(() => {
    (window as unknown as { electron: unknown }).electron = {
      listRecentDirs: vi.fn().mockResolvedValue(['C:\\proj']),
      tbSearch: vi.fn().mockResolvedValue({
        ok: true,
        truncated: false,
        results: [
          { path: 'C:\\proj\\a\\hallo.txt', name: 'hallo.txt', rel: 'a\\hallo.txt', root: 'C:\\proj' },
        ],
      }),
    };
  });

  it('sucht (debounced) und zeigt Treffer', async () => {
    render(
      <PreviewProvider>
        <TbSearchView />
      </PreviewProvider>
    );
    const input = screen.getByPlaceholderText(/Dateien suchen/);
    fireEvent.change(input, { target: { value: 'hallo' } });
    expect(await screen.findByText('hallo.txt')).toBeTruthy();
    expect(window.electron.tbSearch).toHaveBeenCalled();
  });

  it('sucht nicht bei weniger als 2 Zeichen', async () => {
    render(
      <PreviewProvider>
        <TbSearchView />
      </PreviewProvider>
    );
    const input = screen.getByPlaceholderText(/Dateien suchen/);
    fireEvent.change(input, { target: { value: 'h' } });
    await new Promise((r) => setTimeout(r, 320));
    expect(window.electron.tbSearch).not.toHaveBeenCalled();
  });
});
