/**
 * ConfirmContext — promise-based confirmation dialogs.
 *
 * `useConfirm()` returns an async `confirm(options)` that resolves to `true`
 * (confirmed) or `false` (cancelled / dismissed / unmounted). This keeps call
 * sites a one-line replacement for the native `window.confirm()`:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ message: 'Radera personen?', variant: 'danger' })) { … }
 *
 * Rendered once near the app root (beside ToastProvider) so a single dialog
 * instance serves every module.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ConfirmDialog } from '../components/shared/ConfirmDialog.jsx';

const ConfirmContext = createContext(null);

/**
 * @typedef {object} ConfirmOptions
 * @property {string} [title] - Optional heading.
 * @property {React.ReactNode} message - Prompt text (required).
 * @property {string} [confirmLabel] - Confirm button label.
 * @property {string} [cancelLabel] - Cancel button label.
 * @property {'default'|'danger'} [variant] - Confirm button emphasis.
 */

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { options } while open, else null
  // Holds the pending promise's resolver so confirm/cancel can settle it.
  const resolveRef = useRef(null);

  const settle = useCallback((result) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    if (resolve) resolve(result);
  }, []);

  const confirm = useCallback((options) => {
    // If a previous prompt is somehow still pending, resolve it false first so
    // its awaiter is never left hanging.
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ options: options || {} });
    });
  }, []);

  // On unmount, resolve any in-flight prompt as false so awaiters don't hang.
  useEffect(() => {
    return () => {
      if (resolveRef.current) {
        resolveRef.current(false);
        resolveRef.current = null;
      }
    };
  }, []);

  const options = state?.options || {};

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={state != null}
        title={options.title}
        message={options.message}
        confirmLabel={options.confirmLabel}
        cancelLabel={options.cancelLabel}
        variant={options.variant}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * Hook returning the `confirm(options) → Promise<boolean>` function.
 * @returns {(options: ConfirmOptions) => Promise<boolean>}
 */
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return confirm;
}

export default ConfirmContext;
