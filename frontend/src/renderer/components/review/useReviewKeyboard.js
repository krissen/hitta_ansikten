/**
 * useReviewKeyboard - Document-level keyboard routing for the review flow.
 *
 * Owns the review module's keydown listener: the active-gate, the
 * input-field/blocking-module guards, and the key → handler routing
 * (including preventDefault semantics). The semantic branch bodies stay
 * with the caller as handler callbacks, since they read module state
 * (faces, active index, input refs).
 *
 * The latest handlers/options are kept in refs so the document listener is
 * attached exactly once and never sees stale closures.
 */

import { useEffect, useRef } from 'react';

/**
 * @param {Object} handlers - Gesture callbacks (all optional-safe, but the
 *   review module provides all of them):
 * @param {(direction: number) => void} handlers.navigate - ArrowDown (+1) / ArrowUp (-1).
 * @param {() => number} handlers.maxAlternatives - How many digit slots are active;
 *   digits above this fall through unconsumed.
 * @param {(altIndex: number) => void} handlers.selectAlternative - Digit 1..max → index 0..max-1.
 * @param {() => void} handlers.openSuffixDialog - Alt+Enter (works from inputs too).
 * @param {(e: KeyboardEvent, isInput: boolean) => void} handlers.confirmEnter - Plain Enter.
 * @param {() => void} handlers.acceptAll - Shift+Cmd+A.
 * @param {() => void} handlers.confirmKey - 'a' outside inputs.
 * @param {() => void} handlers.ignore - 'i' outside inputs.
 * @param {() => void} handlers.focusInput - 'r' outside inputs.
 * @param {() => void} handlers.skipImage - 'x' outside inputs.
 * @param {() => void} handlers.addManualFace - 'm' outside inputs.
 * @param {() => void} handlers.undo - Cmd+Z outside inputs.
 * @param {() => void} handlers.deleteFile - Cmd+Backspace outside inputs.
 * @param {() => void} handlers.undoDelete - Cmd+Shift+Backspace outside inputs.
 * @param {(e: KeyboardEvent, isInput: boolean) => void} handlers.escape - Escape.
 * @param {Object} options
 * @param {() => boolean} options.isActive - Gate evaluated per keydown; when it
 *   returns false the event is ignored. Today this wraps node.isVisible();
 *   the gate's source is a parameter precisely so it can be swapped (e.g. to
 *   an active-tabset check) without touching the routing.
 */
export function useReviewKeyboard(handlers, { isActive }) {
  const handlersRef = useRef(handlers);
  const isActiveRef = useRef(isActive);
  handlersRef.current = handlers;
  isActiveRef.current = isActive;

  useEffect(() => {
    const handleKeyboard = (e) => {
      // Skip keyboard handling when the gate says the module isn't active
      // (e.g. its tab is hidden in FlexLayout).
      if (!isActiveRef.current()) return;

      const h = handlersRef.current;

      const activeEl = document.activeElement;
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      // Modules that own their own keyboard opt out of the review shortcuts by
      // marking their root with `data-keyboard-scope="isolated"`. Replaces the
      // former hardcoded `.log-viewer, .preferences-module, …` selector list:
      // an explicit, discoverable contract (grep the attribute) that can't
      // silently rot when a module's root class is renamed. (The old list's
      // `.database-management` had already gone stale — that root is
      // `.db-management` — so DatabaseManagement was no longer being shielded.)
      const inBlockingModule = activeEl?.closest('[data-keyboard-scope="isolated"]') != null;

      if (inBlockingModule) {
        return;
      }

      if (e.key === 'ArrowDown' && !isInput) {
        e.preventDefault();
        h.navigate(1);
        return;
      }

      if (e.key === 'ArrowUp' && !isInput) {
        e.preventDefault();
        h.navigate(-1);
        return;
      }

      // Bare-key shortcuts (digits, letters) must ignore modified presses so
      // Cmd/Ctrl/Alt combos fall through to the Electron menu accelerators
      // (e.g. Cmd+1..5 switch pipeline steps, menu.js). Without this guard the
      // DOM preventDefault below fires before the accelerator, so the menu
      // command never runs — and the plain-key action wrongly triggers too.
      const bareKey = !e.metaKey && !e.ctrlKey && !e.altKey;

      // Number keys - select alternative (1-N) for current face
      const maxAlt = h.maxAlternatives();
      const keyNum = parseInt(e.key, 10);
      if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= maxAlt && !isInput && bareKey) {
        e.preventDefault();
        h.selectAlternative(keyNum - 1);
        return;
      }

      // Alt+Enter - open the manual filename-suffix dialog. Handled before the
      // plain-Enter branch and works even with focus in a name input, since
      // Alt+Enter is not a normal text-entry gesture.
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault();
        h.openSuffixDialog();
        return;
      }

      // Enter to confirm (works both in input and outside)
      if (e.key === 'Enter') {
        e.preventDefault();
        h.confirmEnter(e, isInput);
        return;
      }

      // Shift+Cmd+A to accept all suggestions
      if ((e.key === 'a' || e.key === 'A') && e.shiftKey && e.metaKey) {
        e.preventDefault();
        h.acceptAll();
        return;
      }

      // A to confirm
      if ((e.key === 'a' || e.key === 'A') && !isInput && bareKey) {
        e.preventDefault();
        h.confirmKey();
        return;
      }

      // I to ignore
      if ((e.key === 'i' || e.key === 'I') && !isInput && bareKey) {
        e.preventDefault();
        h.ignore();
        return;
      }

      // R to focus input
      if ((e.key === 'r' || e.key === 'R') && !isInput && bareKey) {
        e.preventDefault();
        h.focusInput();
        return;
      }

      // X to skip image (save pending and advance)
      if ((e.key === 'x' || e.key === 'X') && !isInput && bareKey) {
        e.preventDefault();
        h.skipImage();
        return;
      }

      // M to add manual face
      if ((e.key === 'm' || e.key === 'M') && !isInput && bareKey) {
        e.preventDefault();
        h.addManualFace();
        return;
      }

      // Cmd+Z to undo last face action
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !isInput) {
        e.preventDefault();
        h.undo();
        return;
      }

      // Cmd+Backspace - soft-delete the current file to trash (Finder convention).
      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !isInput) {
        e.preventDefault();
        h.deleteFile();
        return;
      }

      // Cmd+Shift+Backspace - undo the last delete-to-trash.
      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey) && e.shiftKey && !isInput) {
        e.preventDefault();
        h.undoDelete();
        return;
      }

      // Escape - cancel detection if running, else blur input or discard changes
      if (e.key === 'Escape') {
        e.preventDefault();
        h.escape(e, isInput);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
  }, []);
}

export default useReviewKeyboard;
