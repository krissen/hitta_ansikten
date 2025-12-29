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
  const autoScrollRef = useRef(true);
  const entriesRef = useRef(null);
  const originalConsoleRef = useRef(null);

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

  /**
   * Clear all logs
   */
  const clearLogs = useCallback(() => {
    setLogs([]);
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
   * Console capture - intercept console methods
   */
  useEffect(() => {
    // Only capture if not already captured
    if (originalConsoleRef.current) return;

    const original = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };
    originalConsoleRef.current = original;

    const formatArgs = (args) => {
      return args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
    };

    console.log = function(...args) {
      original.log(...args);
      // Skip LogViewer's own logs to prevent loops
      const message = formatArgs(args);
      if (!message.startsWith('[LogViewer]')) {
        addLogEntry('info', message, null, 'frontend');
      }
    };

    console.warn = function(...args) {
      original.warn(...args);
      addLogEntry('warn', formatArgs(args), null, 'frontend');
    };

    console.error = function(...args) {
      original.error(...args);
      addLogEntry('error', formatArgs(args), null, 'frontend');
    };

    // Add welcome message
    original.log('[LogViewer] Initialized - watching backend + frontend logs');

    // Cleanup - restore original console methods
    return () => {
      if (originalConsoleRef.current) {
        console.log = originalConsoleRef.current.log;
        console.warn = originalConsoleRef.current.warn;
        console.error = originalConsoleRef.current.error;
        originalConsoleRef.current.log('[LogViewer] Cleanup - restored console methods');
        originalConsoleRef.current = null;
      }
    };
  }, [addLogEntry]);

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

  /**
   * Filter logs
   */
  const filteredLogs = logs.filter(log => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (filterSource !== 'all' && log.source !== filterSource) return false;
    return true;
  });

  return (
    <div className="log-viewer">
      <div className="log-header">
        <h3>Logs</h3>
        <div className="log-controls">
          <select
            className="log-filter"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
          >
            <option value="all">All Sources</option>
            <option value="backend">Backend</option>
            <option value="frontend">Frontend</option>
          </select>
          <select
            className="log-filter"
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
          <button className="btn-clear" onClick={clearLogs}>
            Clear
          </button>
        </div>
      </div>

      <div
        ref={entriesRef}
        className="log-entries"
        onScroll={handleScroll}
      >
        {filteredLogs.length === 0 ? (
          <div className="log-empty">
            {logs.length === 0
              ? 'Waiting for log entries...'
              : 'No log entries match the current filter'}
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
