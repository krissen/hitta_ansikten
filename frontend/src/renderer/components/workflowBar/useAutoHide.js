import { useCallback, useEffect, useRef, useState } from 'react';

/** Inactivity delay (ms) before the WorkflowBar slides away. */
export const WORKFLOW_BAR_HIDE_DELAY = 3000;

/**
 * Autohide state machine for the WorkflowBar.
 *
 * The bar starts revealed. When autohide is `enabled` and nothing is `paused`,
 * an inactivity timer hides it after `delay` ms. Activity — a step change, an
 * explicit {@link reveal} (hover on the top edge), or unpausing — shows it again
 * and restarts the timer. `paused` (an open dropdown, keyboard focus inside the
 * bar, or the pointer resting on it) freezes the timer so the row can never
 * slide out from under an open menu or mid tab-navigation.
 *
 * When `enabled` is false the bar is always revealed and no timer runs — this is
 * the "alltid synlig" opt-out (preference workspace.workflowBarAutoHide = false).
 *
 * @param {object} params
 * @param {boolean} params.enabled - Autohide on. When false the bar stays put.
 * @param {boolean} params.paused - Freeze the timer (dropdown open / focus / hover).
 * @param {string|null} params.activeStep - Current step; a change reveals the bar.
 * @param {number} [params.delay] - Inactivity delay in ms.
 * @returns {{ revealed: boolean, reveal: () => void }}
 */
export function useWorkflowBarAutoHide({
  enabled,
  paused,
  activeStep,
  delay = WORKFLOW_BAR_HIDE_DELAY,
}) {
  const [revealed, setRevealed] = useState(true);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reveal = useCallback(() => setRevealed(true), []);

  // Opt-out: whenever autohide is disabled, force the bar back into view.
  useEffect(() => {
    if (!enabled) setRevealed(true);
  }, [enabled]);

  // A step change is activity from any source (WorkflowBar click, Cmd+1..5,
  // in-app hand-off, enterStep) — surface the bar so the user sees where the
  // active step landed, then let the timer take over again.
  // Deliberately keyed on activeStep only: the step transition is the reveal
  // trigger, not `enabled` changing.
  useEffect(() => {
    if (enabled) setRevealed(true);
  }, [activeStep]);

  // Single scheduler: (re)arm the hide timer whenever an input that governs it
  // changes. Runs only while enabled, unpaused and currently revealed; any other
  // combination leaves the bar as-is with no pending timer.
  useEffect(() => {
    clear();
    if (enabled && !paused && revealed) {
      timerRef.current = setTimeout(() => setRevealed(false), delay);
    }
    return clear;
  }, [enabled, paused, revealed, delay, clear]);

  return { revealed, reveal };
}
