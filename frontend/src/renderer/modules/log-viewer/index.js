/**
 * Log Viewer Module
 *
 * Real-time backend log streaming via WebSocket.
 * - Displays log entries with color coding
 * - Auto-scrolls to bottom
 * - Filter by log level
 */

export default {
  id: 'log-viewer',
  title: 'Backend Logs',
  defaultSize: { width: 600, height: 400 },

  /**
   * Initialize Log Viewer Module
   * @param {HTMLElement} container - Module container
   * @param {object} api - Module API
   * @returns {Promise<Function>} Cleanup function
   */
  async init(container, api) {
    console.log('[LogViewer] Initializing...');

    // Module state
    const logs = [];
    let autoScroll = true;
    let filterLevel = 'all'; // 'all', 'info', 'warn', 'error'
    let filterSource = 'all'; // 'all', 'backend', 'frontend'

    // Create UI
    container.innerHTML = `
      <div class="log-viewer">
        <div class="log-header">
          <h3>Logs</h3>
          <div class="log-controls">
            <select class="log-source-filter">
              <option value="all">All Sources</option>
              <option value="backend">Backend</option>
              <option value="frontend">Frontend</option>
            </select>
            <select class="log-level-filter">
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
            <button class="btn-clear">Clear</button>
          </div>
        </div>
        <div class="log-entries"></div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .log-viewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1e1e1e;
        color: #d4d4d4;
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 12px;
      }

      .log-header {
        padding: 12px 16px;
        background: #252526;
        border-bottom: 1px solid #3e3e42;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .log-header h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: #cccccc;
      }

      .log-controls {
        display: flex;
        gap: 8px;
      }

      .log-filter {
        padding: 4px 8px;
        background: #3c3c3c;
        border: 1px solid #3e3e42;
        border-radius: 3px;
        color: #cccccc;
        font-size: 11px;
        cursor: pointer;
      }

      .log-filter:focus {
        outline: 1px solid #007acc;
      }

      .btn-clear {
        padding: 4px 12px;
        background: #3c3c3c;
        border: 1px solid #3e3e42;
        border-radius: 3px;
        color: #cccccc;
        font-size: 11px;
        cursor: pointer;
      }

      .btn-clear:hover {
        background: #464647;
      }

      .log-entries {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }

      .log-entry {
        padding: 4px 8px;
        margin-bottom: 2px;
        border-left: 3px solid transparent;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .log-entry.info {
        border-left-color: #4ec9b0;
      }

      .log-entry.warn {
        border-left-color: #dcdcaa;
        background: rgba(220, 220, 170, 0.1);
      }

      .log-entry.error {
        border-left-color: #f48771;
        background: rgba(244, 135, 113, 0.1);
      }

      .log-timestamp {
        color: #858585;
        margin-right: 8px;
      }

      .log-level {
        display: inline-block;
        width: 50px;
        margin-right: 8px;
        font-weight: 600;
      }

      .log-level.info {
        color: #4ec9b0;
      }

      .log-level.warn {
        color: #dcdcaa;
      }

      .log-level.error {
        color: #f48771;
      }

      .log-message {
        color: #d4d4d4;
      }

      .log-empty {
        text-align: center;
        padding: 32px;
        color: #858585;
      }
    `;
    container.appendChild(style);

    // Get DOM elements
    const entriesEl = container.querySelector('.log-entries');
    const filterEl = container.querySelector('.log-filter');
    const clearBtn = container.querySelector('.btn-clear');

    /**
     * Add log entry
     */
    function addLogEntry(level, message, timestamp = null, source = 'backend') {
      const entry = {
        level,
        message,
        timestamp: timestamp || new Date().toISOString(),
        source
      };

      logs.push(entry);

      // Apply filters
      if (filterLevel !== 'all' && level !== filterLevel) {
        return;
      }
      if (filterSource !== 'all' && source !== filterSource) {
        return;
      }

      renderLogEntry(entry);

      // Auto-scroll to bottom
      if (autoScroll) {
        entriesEl.scrollTop = entriesEl.scrollHeight;
      }
    }

    /**
     * Render single log entry
     */
    function renderLogEntry(entry) {
      const entryEl = document.createElement('div');
      entryEl.className = `log-entry ${entry.level}`;

      const time = new Date(entry.timestamp).toLocaleTimeString('sv-SE');

      entryEl.innerHTML = `
        <span class="log-timestamp">[${time}]</span>
        <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>
        <span class="log-message">${escapeHtml(entry.message)}</span>
      `;

      entriesEl.appendChild(entryEl);
    }

    /**
     * Render all log entries
     */
    function renderAllEntries() {
      entriesEl.innerHTML = '';

      const filtered = filterLevel === 'all'
        ? logs
        : logs.filter(log => log.level === filterLevel);

      if (filtered.length === 0) {
        entriesEl.innerHTML = '<div class="log-empty">No log entries</div>';
        return;
      }

      filtered.forEach(entry => renderLogEntry(entry));

      // Scroll to bottom
      if (autoScroll) {
        entriesEl.scrollTop = entriesEl.scrollHeight;
      }
    }

    /**
     * Clear all logs
     */
    function clearLogs() {
      logs.length = 0;
      entriesEl.innerHTML = '<div class="log-empty">No log entries</div>';
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Event listeners
    filterEl.addEventListener('change', (e) => {
      filterLevel = e.target.value;
      renderAllEntries();
    });

    clearBtn.addEventListener('click', () => {
      clearLogs();
    });

    // Detect manual scroll (disable auto-scroll if user scrolls up)
    entriesEl.addEventListener('scroll', () => {
      const isAtBottom = entriesEl.scrollHeight - entriesEl.scrollTop <= entriesEl.clientHeight + 10;
      autoScroll = isAtBottom;
    });

    // Subscribe to WebSocket log events
    api.ws.on('log-entry', (data) => {
      const { level, message, timestamp } = data;
      addLogEntry(level, message, timestamp);
    });

    // Listen for face detection progress
    api.ws.on('detection-progress', (data) => {
      addLogEntry('info', `Detection progress: ${data.percentage}%`, data.timestamp);
    });

    // Listen for face detected events
    api.ws.on('face-detected', (data) => {
      addLogEntry('info', `Face detected: ${data.faceId} (confidence: ${data.confidence})`, data.timestamp);
    });

    // Initial empty state
    entriesEl.innerHTML = '<div class="log-empty">Waiting for log entries...</div>';

    // Add a welcome message
    addLogEntry('info', 'Log viewer initialized - watching backend events');

    console.log('[LogViewer] Initialized successfully');

    // Cleanup function
    return () => {
      console.log('[LogViewer] Cleaning up...');
      // WebSocket event handlers will be cleaned up by workspace
    };
  },

  /**
   * Get module state for persistence
   */
  getState() {
    return {};
  },

  /**
   * Restore module state
   */
  setState(state) {
    // State restoration logic
  }
};
