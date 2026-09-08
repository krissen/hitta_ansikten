import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import {
  ToastProvider,
  useToast,
} from '../../src/renderer/context/ToastContext.jsx';

// StartupStatus pulls in BackendContext/api-client; stub it so the ToastProvider
// can render in isolation.
vi.mock('../../src/renderer/components/StartupStatus.jsx', () => ({
  StartupStatus: () => null,
}));

afterEach(cleanup);

// Test harness: exposes showToast via a button click so we drive it through the
// real provider/context path.
function Harness({ onReady }) {
  const showToast = useToast();
  onReady(showToast);
  return null;
}

function renderWithToast() {
  let showToast;
  const utils = render(
    <ToastProvider>
      <Harness
        onReady={(fn) => {
          showToast = fn;
        }}
      />
    </ToastProvider>,
  );
  return { ...utils, showToast };
}

describe('Toast (ToastProvider)', () => {
  it('renders a toast with the variant class', () => {
    const { container, showToast } = renderWithToast();
    act(() => {
      showToast('Klart', 'success');
    });
    const toast = container.querySelector('.global-toast');
    expect(toast).not.toBeNull();
    expect(toast.classList.contains('success')).toBe(true);
    expect(toast.textContent).toContain('Klart');
  });

  it('supports all four variants', () => {
    const { container, showToast } = renderWithToast();
    act(() => {
      showToast('a', 'success');
      showToast('b', 'error');
      showToast('c', 'info');
      showToast('d', 'warning');
    });
    const toasts = container.querySelectorAll('.global-toast');
    expect(toasts.length).toBe(4);
    expect(container.querySelector('.global-toast.success')).not.toBeNull();
    expect(container.querySelector('.global-toast.error')).not.toBeNull();
    expect(container.querySelector('.global-toast.info')).not.toBeNull();
    expect(container.querySelector('.global-toast.warning')).not.toBeNull();
  });

  it('accepts the backwards-compatible positional signature (message, type, duration)', () => {
    const { container, showToast } = renderWithToast();
    act(() => {
      showToast('Fel', 'error', 4000);
    });
    const toast = container.querySelector('.global-toast');
    expect(toast.classList.contains('error')).toBe(true);
    expect(toast.textContent).toContain('Fel');
  });

  it('accepts the options-object signature (message, { type, duration })', () => {
    const { container, showToast } = renderWithToast();
    act(() => {
      showToast('Info', { type: 'info', duration: 3500 });
    });
    const toast = container.querySelector('.global-toast');
    expect(toast.classList.contains('info')).toBe(true);
    expect(toast.textContent).toContain('Info');
  });

  it('defaults to the success variant when no type is given', () => {
    const { container, showToast } = renderWithToast();
    act(() => {
      showToast('Standard');
    });
    expect(
      container.querySelector('.global-toast').classList.contains('success'),
    ).toBe(true);
  });

  it('is a polite status region; error toasts announce as alert', () => {
    const { container, showToast } = renderWithToast();
    const region = container.querySelector('.global-toast-container');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');

    act(() => {
      showToast('ok', 'success');
      showToast('trasig', 'error');
    });
    const success = container.querySelector('.global-toast.success');
    const error = container.querySelector('.global-toast.error');
    expect(success.hasAttribute('role')).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
  });

  it('dismisses via the IconButton dismiss control', () => {
    vi.useFakeTimers();
    try {
      const { container, showToast } = renderWithToast();
      act(() => {
        showToast('stäng mig', 'info');
      });
      const dismiss = container.querySelector('.global-toast__dismiss');
      expect(dismiss).not.toBeNull();
      act(() => {
        fireEvent.click(dismiss);
      });
      // Exit animation delay (300ms) then removal.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(container.querySelector('.global-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dismisses on a click anywhere on the toast itself (legacy behaviour)', () => {
    vi.useFakeTimers();
    try {
      const { container, showToast } = renderWithToast();
      act(() => {
        showToast('klicka mig', 'info');
      });
      const toast = container.querySelector('.global-toast');
      act(() => {
        fireEvent.click(toast);
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(container.querySelector('.global-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not bubble the dismiss-button click to the pill (no double dismiss)', () => {
    // React delegates events, so we assert at the React level: a synthetic
    // click on the dismiss button must not reach ancestor React handlers
    // (which is exactly the path a second onDismiss call would take via the
    // pill's own onClick), while a click on the pill itself does bubble.
    vi.useFakeTimers();
    try {
      let showToast;
      const ancestorClick = vi.fn();
      const { container } = render(
        <div onClick={ancestorClick}>
          <ToastProvider>
            <Harness
              onReady={(fn) => {
                showToast = fn;
              }}
            />
          </ToastProvider>
        </div>,
      );
      act(() => {
        showToast('en gång', 'info');
      });

      act(() => {
        fireEvent.click(container.querySelector('.global-toast__dismiss'));
      });
      // stopPropagation on the button halts the synthetic bubble before the
      // pill's (and any ancestor's) React onClick.
      expect(ancestorClick).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(container.querySelector('.global-toast')).toBeNull();

      // Sanity: a click on the pill itself does bubble (no stopPropagation).
      act(() => {
        showToast('två', 'info');
      });
      act(() => {
        fireEvent.click(container.querySelector('.global-toast'));
      });
      expect(ancestorClick).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-dismisses after the (clamped) duration elapses', () => {
    vi.useFakeTimers();
    try {
      const { container, showToast } = renderWithToast();
      act(() => {
        showToast('försvinn', 'info', 3000);
      });
      expect(container.querySelector('.global-toast')).not.toBeNull();
      // Duration (3000, min-clamped) + exit animation (300).
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(container.querySelector('.global-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps sub-minimum durations to 3s', () => {
    vi.useFakeTimers();
    try {
      const { container, showToast } = renderWithToast();
      act(() => {
        showToast('kort', 'info', 500);
      });
      // Not gone before the 3s minimum.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelector('.global-toast')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(container.querySelector('.global-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
