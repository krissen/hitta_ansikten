/**
 * useAnchoredDropdown — open/dismiss state for a button-anchored popover.
 *
 * Extracted from the WorkflowBar's "Verktyg" menu once the chip dropdown became a
 * second popover in the same bar (Nagelfar PR-2 note a): both need identical
 * dismiss behavior — outside-click and Escape close the menu — so the logic lives
 * once here instead of copied per popover.
 *
 * Returns a `ref` to put on the popover's wrapper (the toggle + menu container);
 * a click outside that wrapper closes the menu. Bind `toggle` to the button and
 * read `open` to render the menu.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useAnchoredDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  return { open, setOpen, toggle, close, ref };
}

export default useAnchoredDropdown;
