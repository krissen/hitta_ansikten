import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  useWorkflowBarAutoHide,
  WORKFLOW_BAR_HIDE_DELAY,
} from '../src/renderer/components/workflowBar/useAutoHide.js';

function setup(initial) {
  const props = {
    enabled: true,
    paused: false,
    activeStep: null,
    delay: WORKFLOW_BAR_HIDE_DELAY,
    ...initial,
  };
  const hook = renderHook((p) => useWorkflowBarAutoHide(p), {
    initialProps: props,
  });
  return hook;
}

describe('useWorkflowBarAutoHide', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts revealed and hides after the inactivity delay', () => {
    const { result } = setup();
    expect(result.current.revealed).toBe(true);
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY));
    expect(result.current.revealed).toBe(false);
  });

  it('reveal() shows the bar again and restarts the timer', () => {
    const { result } = setup();
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY));
    expect(result.current.revealed).toBe(false);

    act(() => result.current.reveal());
    expect(result.current.revealed).toBe(true);
    // Timer restarted: still shown just before the delay, hidden at it.
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY - 1));
    expect(result.current.revealed).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.revealed).toBe(false);
  });

  it('does not hide while paused (open dropdown / focus / hover)', () => {
    const { result } = setup({ paused: true });
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY * 3));
    expect(result.current.revealed).toBe(true);
  });

  it('restarts the hide timer when it unpauses', () => {
    const { result, rerender } = setup({ paused: true });
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY * 2));
    expect(result.current.revealed).toBe(true);

    rerender({ enabled: true, paused: false, activeStep: null });
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY));
    expect(result.current.revealed).toBe(false);
  });

  it('a step change reveals a hidden bar and restarts the timer', () => {
    const { result, rerender } = setup({ activeStep: 'review' });
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY));
    expect(result.current.revealed).toBe(false);

    rerender({ enabled: true, paused: false, activeStep: 'culling' });
    expect(result.current.revealed).toBe(true);
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY));
    expect(result.current.revealed).toBe(false);
  });

  it('when disabled the bar stays revealed and never runs a timer', () => {
    const { result } = setup({ enabled: false });
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY * 3));
    expect(result.current.revealed).toBe(true);
  });

  it('disabling an already-hidden bar forces it back into view', () => {
    const { result, rerender } = setup();
    act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY));
    expect(result.current.revealed).toBe(false);

    rerender({ enabled: false, paused: false, activeStep: null });
    expect(result.current.revealed).toBe(true);
  });

  describe('content gate', () => {
    it('never hides while there is no content behind the bar', () => {
      const { result } = setup({ hasContent: false });
      act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY * 3));
      expect(result.current.revealed).toBe(true);
    });

    it('starts the hide timer when content appears (false → true)', () => {
      const { result, rerender } = setup({ hasContent: false });
      act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY * 2));
      expect(result.current.revealed).toBe(true);

      // A view opens → autohide becomes active and the timer arms.
      rerender({
        enabled: true,
        paused: false,
        activeStep: null,
        hasContent: true,
      });
      act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY));
      expect(result.current.revealed).toBe(false);
    });

    it('losing content forces an already-hidden bar back into view', () => {
      const { result, rerender } = setup({ hasContent: true });
      act(() => vi.advanceTimersByTime(WORKFLOW_BAR_HIDE_DELAY));
      expect(result.current.revealed).toBe(false);

      // Last view closes (welcome card returns) → the bar must not stay hidden.
      rerender({
        enabled: true,
        paused: false,
        activeStep: null,
        hasContent: false,
      });
      expect(result.current.revealed).toBe(true);
    });
  });
});
