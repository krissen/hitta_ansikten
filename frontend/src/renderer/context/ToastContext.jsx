/**
 * ToastContext - Global toast notification system
 *
 * Provides toast notifications that are visible regardless of which tab is active.
 * Toasts stack from bottom-right with smooth animations.
 * StartupStatus is integrated as a sticky toast at the bottom of the stack.
 *
 * Variants: 'success' | 'error' | 'info' | 'warning' (styled against the
 * existing --color-* tokens; see flexlayout-overrides.css). The container is an
 * aria-live="polite" status region; error toasts announce assertively via
 * role="alert". See docs/dev/accessibility.md "Status feedback".
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';
import { StartupStatus } from '../components/StartupStatus.jsx';
import { IconButton } from '../components/shared/IconButton.jsx';
import { t } from '../../i18n/index.js';

// Create the context
const ToastContext = createContext(null);

/**
 * ToastProvider - Wrap your app with this to enable global toasts
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  /**
   * Show a toast.
   *
   * Backwards-compatible signature — both call styles are supported:
   *   showToast(message, 'error', 4000)                      // legacy positional
   *   showToast(message, { type: 'error', duration: 4000 })  // options object
   *
   * @param {string} message - Toast text (Swedish, supplied by caller).
   * @param {('success'|'error'|'info'|'warning')|{type?:string, duration?:number}} [typeOrOptions='success']
   *        Variant string (legacy) or an options object.
   * @param {number} [durationArg=5000] - Duration in ms (legacy positional only;
   *        ignored when an options object is passed). Clamped to a 3s minimum.
   * @returns {number} The toast id (usable with dismissToast).
   */
  const showToast = useCallback(
    (message, typeOrOptions = 'success', durationArg) => {
      let type;
      let duration;
      if (typeOrOptions !== null && typeof typeOrOptions === 'object') {
        type =
          typeOrOptions.type === undefined ? 'success' : typeOrOptions.type;
        duration =
          typeOrOptions.duration === undefined ? 5000 : typeOrOptions.duration;
      } else {
        type = typeOrOptions === undefined ? 'success' : typeOrOptions;
        duration = durationArg === undefined ? 5000 : durationArg;
      }

      const id = ++toastIdRef.current;
      const minDuration = 3000;
      const actualDuration = Math.max(duration, minDuration);
      setToasts((prev) => [...prev, { id, message, type, exiting: false }]);

      setTimeout(() => {
        setToasts((prev) =>
          prev.map((toast) =>
            toast.id === id ? { ...toast, exiting: true } : toast,
          ),
        );
        setTimeout(() => {
          setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, 300);
      }, actualDuration);

      return id;
    },
    [],
  );

  const dismissToast = useCallback((id) => {
    // Start exit animation
    setToasts((prev) =>
      prev.map((toast) =>
        toast.id === id ? { ...toast, exiting: true } : toast,
      ),
    );
    // Remove after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 300);
  }, []);

  const value = { showToast, dismissToast, toasts };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div
      className="global-toast-container"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      <StartupStatus />
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`global-toast ${toast.type} ${toast.exiting ? 'exiting' : ''}`}
          // Errors announce assertively; other variants inherit the polite
          // container. A per-item role also overrides the region for that node.
          role={toast.type === 'error' ? 'alert' : undefined}
          // Click anywhere on the pill dismisses (legacy behaviour); the
          // IconButton is the keyboard/AT-accessible path for the same action.
          onClick={() => onDismiss(toast.id)}
          title={t('common.dismiss')}
        >
          <span className="global-toast__message">{toast.message}</span>
          <IconButton
            icon="close"
            label={t('common.dismiss')}
            variant="ghost"
            size="sm"
            className="global-toast__dismiss"
            onClick={(e) => {
              // The pill's own onClick already dismisses; stop the bubble so
              // dismiss isn't invoked twice for one click.
              e.stopPropagation();
              onDismiss(toast.id);
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * useToast - Hook to access toast functionality
 */
export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  return context.showToast;
}

export default ToastContext;
