import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { useReviewKeyboard } from '../src/renderer/components/review/useReviewKeyboard.js';

// Bare-key vs. modified-key routing in the review keyboard handler.
//
// The document-level handler owns single-key review shortcuts (digits select an
// alternative; a/i/r/x/m confirm/ignore/etc.). Those must NOT fire — and must
// NOT preventDefault — when Cmd/Ctrl/Alt is held, or the DOM preventDefault
// beats the Electron menu accelerators to the punch (Cmd+1..5 switch pipeline
// steps) and the accelerator never runs. These tests pin that guard.

function Harness({ handlers }) {
  useReviewKeyboard(handlers, { isActive: () => true });
  return null;
}

function makeHandlers() {
  return {
    navigate: vi.fn(),
    maxAlternatives: () => 5,
    selectAlternative: vi.fn(),
    openSuffixDialog: vi.fn(),
    confirmEnter: vi.fn(),
    acceptAll: vi.fn(),
    confirmKey: vi.fn(),
    ignore: vi.fn(),
    focusInput: vi.fn(),
    skipImage: vi.fn(),
    addManualFace: vi.fn(),
    undo: vi.fn(),
    deleteFile: vi.fn(),
    undoDelete: vi.fn(),
    escape: vi.fn(),
  };
}

/** Dispatch a keydown on document and report whether default was prevented. */
function press(key, init = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => cleanup());

describe('useReviewKeyboard bare-key guard', () => {
  it('bare "1" selects the first alternative and prevents default', () => {
    const h = makeHandlers();
    render(<Harness handlers={h} />);

    const event = press('1');

    expect(h.selectAlternative).toHaveBeenCalledTimes(1);
    expect(h.selectAlternative).toHaveBeenCalledWith(0);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Cmd+"1" falls through: no selection, no preventDefault', () => {
    const h = makeHandlers();
    render(<Harness handlers={h} />);

    const event = press('1', { metaKey: true });

    expect(h.selectAlternative).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('Ctrl+"1" and Alt+"1" also fall through', () => {
    const h = makeHandlers();
    render(<Harness handlers={h} />);

    const ctrl = press('1', { ctrlKey: true });
    const alt = press('1', { altKey: true });

    expect(h.selectAlternative).not.toHaveBeenCalled();
    expect(ctrl.defaultPrevented).toBe(false);
    expect(alt.defaultPrevented).toBe(false);
  });

  it('bare letter shortcuts still fire', () => {
    const h = makeHandlers();
    render(<Harness handlers={h} />);

    press('a');
    press('i');
    press('r');
    press('x');
    press('m');

    expect(h.confirmKey).toHaveBeenCalledTimes(1);
    expect(h.ignore).toHaveBeenCalledTimes(1);
    expect(h.focusInput).toHaveBeenCalledTimes(1);
    expect(h.skipImage).toHaveBeenCalledTimes(1);
    expect(h.addManualFace).toHaveBeenCalledTimes(1);
  });

  it('Cmd/Ctrl/Alt + letter shortcuts fall through without firing', () => {
    const h = makeHandlers();
    render(<Harness handlers={h} />);

    const cmdA = press('a', { metaKey: true });
    press('i', { ctrlKey: true });
    press('r', { altKey: true });

    expect(h.confirmKey).not.toHaveBeenCalled();
    expect(h.ignore).not.toHaveBeenCalled();
    expect(h.focusInput).not.toHaveBeenCalled();
    expect(cmdA.defaultPrevented).toBe(false);
  });

  it('Shift+Cmd+A still triggers acceptAll (modifier combo has its own branch)', () => {
    const h = makeHandlers();
    render(<Harness handlers={h} />);

    const event = press('a', { metaKey: true, shiftKey: true });

    expect(h.acceptAll).toHaveBeenCalledTimes(1);
    expect(h.confirmKey).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});
