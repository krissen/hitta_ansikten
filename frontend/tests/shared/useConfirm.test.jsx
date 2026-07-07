import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from '../../src/renderer/context/ConfirmContext.jsx';

afterEach(cleanup);

// Harness: exposes the promise-based confirm() so tests can trigger a prompt and
// await its resolution while driving the dialog through the DOM.
function makeHarness(defaultOptions = { message: 'Säker?' }) {
  const captured = { confirm: null, last: null };
  function Trigger() {
    const confirm = useConfirm();
    captured.confirm = (opts = defaultOptions) => {
      const p = confirm(opts);
      captured.last = p;
      return p;
    };
    return null;
  }
  const utils = render(
    <ConfirmProvider>
      <Trigger />
    </ConfirmProvider>,
  );
  return { ...utils, captured };
}

describe('useConfirm / ConfirmProvider', () => {
  it('resolves true when the confirm button is clicked', async () => {
    const { captured, container } = makeHarness();
    let promise;
    act(() => {
      promise = captured.confirm({ message: 'Radera?' });
    });
    // Dialog is now open with the message.
    expect(container.querySelector('.modal__message').textContent).toBe('Radera?');
    fireEvent.click(container.querySelector('.btn--primary'));
    await expect(promise).resolves.toBe(true);
  });

  it('resolves false when the cancel button is clicked', async () => {
    const { captured, container } = makeHarness();
    let promise;
    act(() => {
      promise = captured.confirm();
    });
    fireEvent.click(container.querySelector('.btn--secondary'));
    await expect(promise).resolves.toBe(false);
  });

  it('Enter resolves true, the cancel event resolves false', async () => {
    const { captured, container } = makeHarness();
    let p1;
    act(() => {
      p1 = captured.confirm();
    });
    fireEvent.keyDown(container.querySelector('dialog'), { key: 'Enter' });
    await expect(p1).resolves.toBe(true);

    let p2;
    act(() => {
      p2 = captured.confirm();
    });
    fireEvent(container.querySelector('dialog'), new Event('cancel', { cancelable: true }));
    await expect(p2).resolves.toBe(false);
  });

  it('renders the confirm button as danger for the danger variant', () => {
    const { captured, container } = makeHarness();
    act(() => {
      captured.confirm({ message: 'Radera permanent?', variant: 'danger' });
    });
    const confirmBtn = container.querySelector('.modal__footer .btn--danger');
    expect(confirmBtn).not.toBeNull();
    expect(container.querySelector('.modal__footer .btn--primary')).toBeNull();
  });

  it('uses primary (not danger) for the default variant', () => {
    const { captured, container } = makeHarness();
    act(() => {
      captured.confirm({ message: 'Fortsätt?' });
    });
    expect(container.querySelector('.modal__footer .btn--primary')).not.toBeNull();
    expect(container.querySelector('.modal__footer .btn--danger')).toBeNull();
  });

  it('resolves false when the provider unmounts with a prompt pending', async () => {
    const { captured, unmount } = makeHarness();
    let promise;
    act(() => {
      promise = captured.confirm();
    });
    unmount();
    await expect(promise).resolves.toBe(false);
  });

  it('honours custom confirm/cancel labels', () => {
    const { captured, container } = makeHarness();
    act(() => {
      captured.confirm({ message: 'x', confirmLabel: 'Ja då', cancelLabel: 'Nej tack' });
    });
    expect(container.querySelector('.btn--primary').textContent).toBe('Ja då');
    expect(container.querySelector('.btn--secondary').textContent).toBe('Nej tack');
  });
});
