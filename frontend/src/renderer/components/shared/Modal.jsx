/**
 * Modal — shared dialog base built on the native `<dialog>` element.
 *
 * Native `<dialog showModal()>` gives the platform's top-layer rendering (always
 * above the FlexLayout tabsets, no z-index wars), focus trapping, the `::backdrop`
 * pseudo-element and `Esc`-to-close (the native `cancel` event) for free. Prefer
 * this over ad-hoc fixed-overlay divs.
 *
 * Keyboard shielding — IMPORTANT
 * ------------------------------
 * The app's global shortcut layers (e.g. `useReviewKeyboard`) attach *native*
 * `document.addEventListener('keydown', …)` listeners. A native `<dialog>` does
 * NOT stop keydown from bubbling to `document`, so without protection a key typed
 * in a modal (e.g. "a"/"i"/"x" or a digit in a text field) would also fire a
 * review shortcut. React roots its delegated listeners on the app container
 * (below `document`); a React `onKeyDown` calling `stopPropagation()` also calls
 * `nativeEvent.stopPropagation()`, which halts the bubble *before* it reaches the
 * `document`-level listeners. So a single `onKeyDown` on the dialog that stops
 * propagation is the minimal, robust shield for every consumer — it supersedes
 * the per-component `stopPropagation` the old review dialogs each carried. Esc is
 * unaffected: the browser fires the separate `cancel` event regardless.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the dialog is shown (drives showModal/close).
 * @param {Function} props.onClose - Called on Esc (native cancel) and backdrop click.
 * @param {React.ReactNode} [props.title] - Optional heading; wired to aria-labelledby.
 * @param {React.ReactNode} [props.footer] - Optional footer content (typically buttons).
 * @param {'sm'|'md'|'lg'} [props.size='md'] - Width preset.
 * @param {React.RefObject<HTMLElement>} [props.initialFocusRef] - Element to focus on open.
 * @param {boolean} [props.closeOnBackdrop=true] - Whether clicking the backdrop closes.
 * @param {string} [props.className] - Extra classes appended to the dialog element.
 * @param {(e: React.KeyboardEvent) => void} [props.onKeyDown] - Extra keydown handler
 *   (runs after the propagation shield; use for Enter-to-confirm etc.).
 * @param {string} [props.ariaLabel] - Accessible name used when no `title` is
 *   rendered (otherwise the dialog is announced unnamed).
 * @param {React.ReactNode} props.children - Dialog body content.
 * @returns {JSX.Element}
 */

import React, { useEffect, useId, useRef } from 'react';
import './shared.css';

export function Modal({
  open,
  onClose,
  title,
  footer,
  size = 'md',
  initialFocusRef,
  closeOnBackdrop = true,
  className = '',
  onKeyDown,
  ariaLabel,
  children,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();

  // Drive the native dialog from the `open` prop. showModal() puts the dialog in
  // the top layer; close() removes it. Guard against double-calls (showModal on
  // an already-open dialog throws).
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      // Focus: caller-provided target, else let the platform autofocus the first
      // focusable child (native showModal behaviour).
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      }
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, initialFocusRef]);

  // Esc → native `cancel`. Prevent the default close so React's `open` prop stays
  // the single source of truth, then delegate to onClose.
  const handleCancel = (e) => {
    e.preventDefault();
    onClose?.();
  };

  // Shield app-global document keydown listeners (see file header), then run any
  // consumer handler (e.g. Enter-to-confirm).
  const handleKeyDown = (e) => {
    e.stopPropagation();
    onKeyDown?.(e);
  };

  // A click whose target is the dialog element itself lands on the backdrop
  // region (content lives in an inner wrapper, so inner clicks target children).
  const handleClick = (e) => {
    if (closeOnBackdrop && e.target === dialogRef.current) {
      onClose?.();
    }
  };

  const classes = ['modal', `modal--${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <dialog
      ref={dialogRef}
      className={classes}
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel : undefined}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      <div className="modal__content">
        {title && (
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
        )}
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </dialog>
  );
}

export default Modal;
