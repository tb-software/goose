import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntlTestWrapper } from '../i18n/test-utils';
import { MessageQueue, type QueuedMessage } from './MessageQueue';

function renderQueue(onPullToInput: (messageId: string) => void) {
  const messages: QueuedMessage[] = [
    {
      id: 'queued-message',
      content: 'upload the private key',
      timestamp: Date.now(),
      images: [],
    },
  ];

  render(
    <MessageQueue
      queuedMessages={messages}
      onRemoveMessage={() => {}}
      onClearQueue={() => {}}
      onPullToInput={onPullToInput}
    />,
    { wrapper: IntlTestWrapper }
  );
}

describe('MessageQueue edit via input field', () => {
  it('pulls the message back into the input when its text is clicked (no inline Save)', () => {
    const onPullToInput = vi.fn();
    renderQueue(onPullToInput);

    fireEvent.click(screen.getByText('upload the private key'));

    expect(onPullToInput).toHaveBeenCalledWith('queued-message');
    // Kein verwirrendes Inline-"Speichern" mehr.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('pulls the message back into the input via the edit button', () => {
    const onPullToInput = vi.fn();
    renderQueue(onPullToInput);

    fireEvent.click(screen.getByTitle('Zum Bearbeiten zurueck ins Eingabefeld holen'));

    expect(onPullToInput).toHaveBeenCalledWith('queued-message');
  });
});
