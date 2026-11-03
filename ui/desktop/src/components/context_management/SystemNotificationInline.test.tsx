import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { SystemNotificationInline } from './SystemNotificationInline';

const notif = (msg: string) => ({ msg, notificationType: 'inlineMessage' as const });

describe('SystemNotificationInline', () => {
  it('kurze einzeilige Meldung: unveraendert, kein Aufklapp-Knopf', () => {
    render(<SystemNotificationInline notification={notif('Modell gewechselt zu auto:chat')} />);
    expect(screen.getByText('Modell gewechselt zu auto:chat')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lange mehrzeilige Fehlermeldung: Kernaussage sichtbar, Details erst nach Klick', () => {
    const msg =
      'Fehler beim Modell auto:chat\nHTTP 500 vom Proxy\nmodel=qwen3.8-27b-tbs.gguf nicht erreichbar';
    render(<SystemNotificationInline notification={notif(msg)} />);

    // Kernaussage = erste Zeile, sichtbar; Detail (Flotten-Modell) zunaechst verborgen.
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Fehler beim Modell auto:chat');
    expect(screen.queryByText(/qwen3\.8-27b-tbs\.gguf/)).toBeNull();

    fireEvent.click(button);

    // Nach dem Aufklappen ist der volle Text (inkl. Flotten-Modell) lesbar.
    expect(screen.getByText(/qwen3\.8-27b-tbs\.gguf/)).toBeInTheDocument();
  });

  it('sehr lange einzeilige Meldung wird gekuerzt und aufklappbar', () => {
    const msg = 'A'.repeat(300);
    render(<SystemNotificationInline notification={notif(msg)} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('…');
    expect(button.textContent!.length).toBeLessThan(msg.length);
  });
});
