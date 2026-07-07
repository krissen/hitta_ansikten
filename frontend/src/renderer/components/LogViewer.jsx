/**
 * LogViewer - React component for real-time log streaming
 *
 * Features:
 * - Displays log entries with color coding
 * - Filters by log level and source
 * - Auto-scrolls to bottom
 * - Captures frontend console logs
 * - Receives backend logs via WebSocket
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { getLogBuffer, clearLogBuffer, debug } from '../shared/debug.js';
import { t } from '../../i18n/index.js';
import './LogViewer.css';

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('sv-SE');
}

/**
 * LogViewer Component
 */
export function LogViewer() {
  const [logs, setLogs] = useState([]);
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const autoScrollRef = useRef(true);
  const entriesRef = useRef(null);
  const lastBufferLengthRef = useRef(0);

  /**
   * Add a log entry
   */
  const addLogEntry = useCallback((level, message, timestamp = null, source = 'backend') => {
    const entry = {
      id: Date.now() + Math.random(),
      level,
      message,
      timestamp: timestamp || new Date().toISOString(),
      source
    };

    setLogs(prev => [...prev, entry]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    clearLogBuffer();
    lastBufferLengthRef.current = 0;
  }, []);

  /**
   * Handle scroll to detect manual scrolling
   */
  const handleScroll = useCallback(() => {
    if (!entriesRef.current) return;
    const el = entriesRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 10;
    autoScrollRef.current = isAtBottom;
  }, []);

  /**
   * Auto-scroll to bottom when new logs arrive
   */
  useEffect(() => {
    if (autoScrollRef.current && entriesRef.current) {
      entriesRef.current.scrollTop = entriesRef.current.scrollHeight;
    }
  }, [logs]);

  /**
   * Listen for new log entries via CustomEvent from debug buffer
   */
  useEffect(() => {
    // Load initial logs from buffer
    const initialLogs = getLogBuffer();
    if (initialLogs.length > 0) {
      setLogs(initialLogs);
      lastBufferLengthRef.current = initialLogs.length;
    }

    // React to new entries via event (replaces 100ms polling)
    const handleBufferChanged = () => {
      const buffer = getLogBuffer();
      if (buffer.length > lastBufferLengthRef.current) {
        const newEntries = buffer.slice(lastBufferLengthRef.current);
        setLogs(prev => [...prev, ...newEntries]);
        lastBufferLengthRef.current = buffer.length;
      }
    };

    window.addEventListener('debug-buffer-changed', handleBufferChanged);
    debug('LogViewer', 'Initialized - listening for debug buffer events');

    return () => {
      window.removeEventListener('debug-buffer-changed', handleBufferChanged);
    };
  }, []);

  /**
   * WebSocket subscriptions for backend logs
   */
  useWebSocket('log-entry', useCallback((data) => {
    const { level, message, timestamp } = data;
    addLogEntry(level || 'info', message, timestamp, 'backend');
  }, [addLogEntry]));

  useWebSocket('detection-progress', useCallback((data) => {
    addLogEntry('info', `Detection progress: ${data.percentage}%`, data.timestamp, 'backend');
  }, [addLogEntry]));

  useWebSocket('face-detected', useCallback((data) => {
    addLogEntry('info', `Face detected: ${data.faceId} (confidence: ${data.confidence})`, data.timestamp, 'backend');
  }, [addLogEntry]));

  const filteredLogs = logs.filter(log => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (filterSource !== 'all' && log.source !== filterSource) return false;
    return true;
  });

  const formatLogsForClipboard = (logsToFormat) => {
    return logsToFormat.map(entry => {
      const time = formatTime(entry.timestamp);
      const source = entry.source === 'frontend' ? 'FE' : 'BE';
      const level = entry.level.toUpperCase().padEnd(5);
      return `[${time}] [${source}] ${level} ${entry.message}`;
    }).join('\n');
  };

  const copyLogs = async () => {
    const text = formatLogsForClipboard(filteredLogs);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        const container = entriesRef.current;
        if (container && container.contains(document.activeElement)) {
          e.preventDefault();
          copyLogs();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="module-container log-viewer" data-keyboard-scope="isolated">
      <div className="module-header">
        <h3 className="module-title">{t('logs.title')}</h3>
        <div className="button-group">
          <select
            className="form-select"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
          >
            <option value="all">{t('logs.source.all')}</option>
            <option value="backend">{t('logs.source.backend')}</option>
            <option value="frontend">{t('logs.source.frontend')}</option>
          </select>
          <select
            className="form-select"
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
          >
            <option value="all">{t('logs.level.all')}</option>
            <option value="debug">{t('logs.level.debug')}</option>
            <option value="info">{t('logs.level.info')}</option>
            <option value="warn">{t('logs.level.warning')}</option>
            <option value="error">{t('logs.level.error')}</option>
          </select>
          <button type="button" className="btn-secondary" onClick={copyLogs}>
            {copyFeedback ? t('logs.copied') : t('logs.copy')}
          </button>
          <button type="button" className="btn-secondary" onClick={clearLogs}>
            {t('logs.clear')}
          </button>
        </div>
      </div>

      <div
        ref={entriesRef}
        className="module-body log-entries"
        onScroll={handleScroll}
      >
        {filteredLogs.length === 0 ? (
          <div className="empty-state">
            {logs.length === 0
              ? t('logs.empty.waiting')
              : t('logs.empty.noMatch')}
          </div>
        ) : (
          filteredLogs.map(entry => (
            <div key={entry.id} className={`log-entry ${entry.level}`}>
              <span className="log-timestamp">[{formatTime(entry.timestamp)}]</span>
              <span className={`log-source ${entry.source}`}>
                [{entry.source === 'frontend' ? 'FE' : 'BE'}]
              </span>
              <span className={`log-level ${entry.level}`}>
                {entry.level.toUpperCase()}
              </span>
              <span
                className="log-message"
                dangerouslySetInnerHTML={{ __html: escapeHtml(entry.message) }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LogViewer;
