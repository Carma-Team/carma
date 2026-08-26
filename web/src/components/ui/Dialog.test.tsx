import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from './Dialog';

// jsdom does not fully implement <dialog> modal semantics, so the native
// showModal/close methods are stubbed here — the point of these tests is to
// verify *our* open/close wiring, not the browser's dialog implementation.
describe('Dialog', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal as unknown as () => void;
    HTMLDialogElement.prototype.close = close as unknown as (returnValue?: string) => void;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls showModal when opened', () => {
    render(
      <Dialog open title="Confirm" closeLabel="Close" onClose={() => {}}>
        Body content
      </Dialog>,
    );

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" closeLabel="Close" onClose={onClose}>
        Body content
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls close() rather than showModal() again when open flips to false', () => {
    const { rerender } = render(
      <Dialog open title="Confirm" closeLabel="Close" onClose={() => {}}>
        Body content
      </Dialog>,
    );

    rerender(
      <Dialog open={false} title="Confirm" closeLabel="Close" onClose={() => {}}>
        Body content
      </Dialog>,
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the native cancel event fires (Escape key)', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" closeLabel="Close" onClose={onClose}>
        Body content
      </Dialog>,
    );

    const dialogEl = document.querySelector('dialog')!;
    dialogEl.dispatchEvent(new Event('cancel', { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
