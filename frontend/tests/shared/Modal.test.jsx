import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { Modal } from '../../src/renderer/components/shared/Modal.jsx';

afterEach(cleanup);

describe('Modal', () => {
  it('opens the native dialog when open and closes it when not', () => {
    const { container, rerender } = render(
      <Modal open onClose={() => {}} title="Titel">
        <p>Kropp</p>
      </Modal>,
    );
    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBe(true);

    rerender(
      <Modal open={false} onClose={() => {}} title="Titel">
        <p>Kropp</p>
      </Modal>,
    );
    expect(dialog.open).toBe(false);
  });

  it('wires aria-labelledby to the title heading', () => {
    const { container } = render(
      <Modal open onClose={() => {}} title="Bekräfta">
        <p>x</p>
      </Modal>,
    );
    const dialog = container.querySelector('dialog');
    const title = container.querySelector('.modal__title');
    expect(title.textContent).toBe('Bekräfta');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('has no aria-labelledby when there is no title', () => {
    const { container } = render(
      <Modal open onClose={() => {}}>
        <p>x</p>
      </Modal>,
    );
    expect(container.querySelector('dialog').hasAttribute('aria-labelledby')).toBe(false);
  });

  it('calls onClose on the native cancel event (Esc)', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose} title="t">
        <p>x</p>
      </Modal>,
    );
    fireEvent(container.querySelector('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click (dialog element itself) but not on content clicks', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose} title="t">
        <p>x</p>
      </Modal>,
    );
    const dialog = container.querySelector('dialog');
    fireEvent.click(container.querySelector('.modal__content'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on backdrop click when closeOnBackdrop is false', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose} closeOnBackdrop={false} title="t">
        <p>x</p>
      </Modal>,
    );
    fireEvent.click(container.querySelector('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses initialFocusRef on open', () => {
    function Harness() {
      const ref = useRef(null);
      return (
        <Modal open onClose={() => {}} initialFocusRef={ref} title="t">
          <button ref={ref} data-testid="target">OK</button>
        </Modal>
      );
    }
    const { getByTestId } = render(<Harness />);
    expect(document.activeElement).toBe(getByTestId('target'));
  });

  it('shields keydowns from document-level listeners (global shortcut layer)', () => {
    const docListener = vi.fn();
    document.addEventListener('keydown', docListener);
    try {
      const { container } = render(
        <Modal open onClose={() => {}} title="t">
          <input data-testid="field" />
        </Modal>,
      );
      fireEvent.keyDown(container.querySelector('[data-testid="field"]'), { key: 'a' });
      expect(docListener).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', docListener);
    }
  });

  it('runs a consumer onKeyDown after the shield', () => {
    const onKeyDown = vi.fn();
    const { container } = render(
      <Modal open onClose={() => {}} onKeyDown={onKeyDown} title="t">
        <input data-testid="field" />
      </Modal>,
    );
    fireEvent.keyDown(container.querySelector('[data-testid="field"]'), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
