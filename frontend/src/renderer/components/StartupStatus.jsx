import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { apiClient } from '../shared/api-client.js';
import { debugError } from '../shared/debug.js';
import { Icon } from './Icon.jsx';
import { t } from '../../i18n/index.js';
import './StartupStatus.css';

const STATUS_ICONS = {
  pending: 'circle',
  loading: 'refresh',
  ready: 'check',
  error: 'warning'
};

const STATE_CLASS = {
  pending: 'is-pending',
  loading: 'is-loading',
  ready: 'is-ready',
  error: 'is-error'
};

// Built at render time (not module load) so t() resolves against the active
// locale. A module-level object would freeze the strings at import, before any
// locale switch could take effect.
function createInitialStatus() {
  return {
    items: {
      backend: { state: 'loading', message: t('startupStatus.status.connecting') },
      database: { state: 'pending', message: t('startupStatus.status.waiting') },
      mlModels: { state: 'pending', message: t('startupStatus.status.waiting') }
    },
    allReady: false,
    hasError: false
  };
}

export function StartupStatus() {
  const { isConnected, api } = useBackend();
  // Same timing rationale: resolve the labels in render, not at module load.
  const COMPONENT_LABELS = {
    backend: t('startupStatus.labels.backend'),
    database: t('startupStatus.labels.database'),
    mlModels: t('startupStatus.labels.mlModels')
  };
  const [status, setStatus] = useState(createInitialStatus);
  const [dismissed, setDismissed] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const readyTimerRef = useRef(null);
  const fetchedRef = useRef(false);

  const handleStatusUpdate = useCallback((data) => {
    setStatus(data);

    if (data.allReady && !readyTimerRef.current) {
      readyTimerRef.current = setTimeout(() => {
        setFadeOut(true);
        setTimeout(() => setDismissed(true), 500);
      }, 2000);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setFadeOut(true);
    setTimeout(() => setDismissed(true), 500);
  }, []);

  useEffect(() => {
    if (dismissed) return;

    apiClient.onWSEvent('startup-status', handleStatusUpdate);

    return () => {
      apiClient.offWSEvent('startup-status', handleStatusUpdate);
      if (readyTimerRef.current) {
        clearTimeout(readyTimerRef.current);
      }
    };
  }, [dismissed, handleStatusUpdate]);

  useEffect(() => {
    if (dismissed || !isConnected) return;

    setStatus(prev => ({
      ...prev,
      items: {
        ...prev.items,
        backend: { state: 'ready', message: t('startupStatus.status.connected') }
      }
    }));

    if (fetchedRef.current) return;
    fetchedRef.current = true;
    api.get('/api/v1/startup/status')
      .then(handleStatusUpdate)
      .catch(err => debugError('StartupStatus', 'Failed to fetch status', err));
  }, [isConnected, dismissed, api, handleStatusUpdate]);

  if (dismissed) return null;

  const { items, allReady, hasError } = status;
  const anyLoading = Object.values(items).some(item =>
    item.state === 'loading' || item.state === 'pending'
  );
  const startupDone = allReady || (!anyLoading && hasError);

  let headerText = t('startupStatus.status.starting');
  if (allReady) headerText = t('startupStatus.status.ready');
  else if (startupDone && hasError) headerText = t('startupStatus.status.error');

  return (
    <div
      className={`startup-status ${fadeOut ? 'fade-out' : ''} ${allReady ? 'all-ready' : ''} ${startupDone && hasError ? 'has-error' : ''}`}
      onClick={handleDismiss}
      title={t('startupStatus.dismiss')}
    >
      <div className="startup-status-header">
        {headerText}
      </div>
      <div className="startup-status-items text-text-secondary" role="status" aria-live="polite">
        {Object.entries(items).map(([key, item]) => (
          <div key={key} className={`startup-item ${STATE_CLASS[item.state] || ''}`}>
            <span className={`startup-icon ${STATE_CLASS[item.state] || ''}`}>
              <Icon name={STATUS_ICONS[item.state]} size={14} />
            </span>
            <span className="startup-label">
              {COMPONENT_LABELS[key] || key}
            </span>
            <span className={`startup-message ${STATE_CLASS[item.state] || ''}`}>
              {item.message}
            </span>
            {item.state === 'error' && item.error && (
              <span className="startup-error-detail" title={item.error}>
                <Icon name="info" size={12} />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default StartupStatus;
