import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Microtasks mehrfach leeren (tbResolveFile -> await -> .then-Kette), ohne auf echte Timer zu warten.
async function flushMicrotasks(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
import MarkdownContent from './MarkdownContent';
import { WorkingDirProvider } from '../tb/WorkingDirContext';
import { PreviewProvider } from '../tb/preview/PreviewContext';
import { IntlTestWrapper } from '../i18n/test-utils';

// Der verifizierte Pfad (Main-Resolver) weicht bewusst vom genannten ab (liegt im Unterordner),
// damit der Test zeigt: die Infokarte zeigt den ECHTEN, verifizierten Pfad - nicht nur den Linktext.
const VERIFIED = 'C:\\Proj\\unterordner\\report.html';

function renderMd(content: string, workingDir = 'C:\\Proj') {
  return render(
    <IntlTestWrapper>
      <WorkingDirProvider value={workingDir}>
        <PreviewProvider>
          <MarkdownContent content={content} />
        </PreviewProvider>
      </WorkingDirProvider>
    </IntlTestWrapper>
  );
}

describe('MarkdownContent Pfad-Infokarte', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (window as unknown as { electron: unknown }).electron = {
      tbResolveFile: vi.fn().mockResolvedValue({ ok: true, path: VERIFIED }),
      showItemInFolder: vi.fn().mockResolvedValue({ ok: true, kind: 'file' }),
      tbReadFile: vi.fn(),
      tbWatchFile: vi.fn(),
      tbUnwatchFile: vi.fn(),
      onTbFileChanged: vi.fn(() => vi.fn()),
    };
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('Inline-Pfad: Tooltip = voller Pfad, KEIN "Klick"-Text', () => {
    renderMd('siehe `C:\\Proj\\report.html` dazu');
    const code = screen.getByText('C:\\Proj\\report.html');
    // Tooltip zeigt den vollen Pfad, nicht mehr "Klick ...".
    expect(code.getAttribute('title')).toContain('C:\\Proj\\report.html');
    expect(code.getAttribute('title') ?? '').not.toMatch(/klick/i);
  });

  it('Hover zeigt die Infokarte mit dem VERIFIZIERTEN vollen Pfad und Aktionen', async () => {
    renderMd('siehe `C:\\Proj\\report.html` dazu');
    const code = screen.getByText('C:\\Proj\\report.html');

    await act(async () => {
      fireEvent.mouseEnter(code);
      vi.advanceTimersByTime(260); // Hover-Verzoegerung (220 ms) ueberschreiten
      await flushMicrotasks(); // tbResolveFile + .then-Kette
    });

    // Der verifizierte Pfad (Unterordner!) steht sichtbar in der Karte.
    expect(screen.getByText(VERIFIED)).toBeTruthy();
    expect(screen.getByText('Vollständigen Pfad kopieren')).toBeTruthy();
    expect(screen.getByText('Im Explorer anzeigen')).toBeTruthy();
  });

  it('Rechtsklick oeffnet die Karte sofort; "Im Explorer" ruft showItemInFolder', async () => {
    renderMd('siehe `C:\\Proj\\report.html` dazu');
    const code = screen.getByText('C:\\Proj\\report.html');

    await act(async () => {
      fireEvent.contextMenu(code);
      await flushMicrotasks();
    });

    const explorerBtn = screen.getByText('Im Explorer anzeigen');
    await act(async () => {
      fireEvent.mouseDown(explorerBtn);
      await flushMicrotasks();
    });

    // revealLocalPath -> showItemInFolder mit dem verifizierten Pfad.
    expect(window.electron.showItemInFolder as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    const calledWith = (window.electron.showItemInFolder as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(calledWith).toBe(VERIFIED);
  });
});
