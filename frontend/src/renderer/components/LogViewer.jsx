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
import { getLogBuffer, clearLogBuffer } from '../shared/debug.js';
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

  /**
   * Clear all logs
   */
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
   * Poll log buffer for new entries
   * This approach avoids console interception issues and captures all debug() logs
   */
  useEffect(() => {
    // Load initial logs from buffer
    const initialLogs = getLogBuffer();
    if (initialLogs.length > 0) {
      setLogs(initialLogs);
      lastBufferLengthRef.current = initialLogs.length;
    }

    // Poll for new entries every 100ms
    const pollInterval = setInterval(() => {
      const buffer = getLogBuffer();
      if (buffer.length > lastBufferLengthRef.current) {
        // Get only new entries
        const newEntries = buffer.slice(lastBufferLengthRef.current);
        setLogs(prev => [...prev, ...newEntries]);
        lastBufferLengthRef.current = buffer.length;
      }
    }, 100);

    console.log('[LogViewer] Initialized - polling debug buffer');

    return () => {
      clearInterval(pollInterval);
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
