/**
 * ToastContext - Global toast notification system
 *
 * Provides toast notifications that are visible regardless of which tab is active.
 * Toasts stack from bottom-right with smooth animations.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// Create the context
const ToastContext = createContext(null);

/**
 * ToastProvider - Wrap your app with this to enable global toasts
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message, type = 'success', duration = 4000) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type, exiting: false }]);

    // Auto-remove after duration
    setTimeout(() => {
      // Mark as exiting first (for fade-out animation)
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
      // Remove after animation
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300);
    }, duration);
  }, []);

  const value = { showToast, toasts };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  );
}

/**
 * ToastContainer - Renders the toast stack (fixed position, always visible)
 */
function ToastContainer({ toasts }) {
  if (toasts.length === 0) return null;

  return (
    <div className="global-toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`global-toast ${t.type} ${t.exiting ? 'exiting' : ''}`}
        >
          {t.message}
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
