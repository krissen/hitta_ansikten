/**
 * Statistics Dashboard Module
 *
 * Real-time dashboard showing face detection statistics.
 * Equivalent to analysera_ansikten.py --dashboard mode.
 */

export default {
  id: 'statistics-dashboard',
  title: 'Statistics Dashboard',
  defaultSize: { width: 900, height: 700 },
  preferredSize: {
    width: 500,         // Preferred width in pixels
    minWidth: 300,      // Minimum width
    maxWidth: null,     // No maximum
    flexGrow: 0.5       // Grows moderately
  },
  defaultLayout: {
    row: 2,             // Secondary row (bottom)
    col: 1,             // First column
    colSpan: 'full',    // Full width (spans all columns)
    ratio: 1.0,         // 100% of row width
    rowRatio: 0.3       // 30% of total height
  },

  /**
   * Initialize statistics dashboard module
   * @param {HTMLElement} container - Module container
   * @param {object} api - Module API
   * @returns {Promise<Function>} Cleanup function
   */
  async init(container, api) {
    console.log('[StatsDashboard] Initializing...');

    // Module state
    let refreshInterval = null;
    let autoRefresh = true;
    let refreshRate = 5000; // 5 seconds default

    // Create UI
    container.innerHTML = `
      <div class="stats-dashboard">
        <div class="stats-header">
          <h3>Statistics Dashboard</h3>
          <div class="stats-controls">
            <label>
              <input type="checkbox" class="auto-refresh-toggle" checked />
              Auto-refresh
            </label>
            <select class="refresh-rate">
              <option value="2000">2s</option>
              <option value="5000" selected>5s</option>
              <option value="10000">10s</option>
            </select>
            <button class="btn-refresh">Refresh Now</button>
          </div>
        </div>

        <div class="stats-body">
          <!-- Attempt Statistics Table -->
          <div class="stats-section">
            <h4>Attempt Statistics</h4>
            <div class="attempt-stats-container">
              <div class="loading">Loading...</div>
            </div>
          </div>

          <!-- Top Faces Grid -->
          <div class="stats-section">
            <h4>Top Faces (19 most common + Ignored)</h4>
            <div class="top-faces-container">
              <div class="loading">Loading...</div>
            </div>
          </div>

          <!-- Recent Images -->
          <div class="stats-section">
            <h4>Recent Images</h4>
            <div class="recent-images-container">
              <div class="loading">Loading...</div>
            </div>
          </div>

          <!-- Recent Logs -->
          <div class="stats-section">
            <h4>Recent Log Lines</h4>
            <div class="recent-logs-container">
              <div class="loading">Loading...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .stats-dashboard {
        height: 100%;
        display: flex;
        flex-direction: column;
        padding: 12px;
        overflow-y: auto;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .stats-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 8px;
        border-bottom: 2px solid #e0e0e0;
      }

      .stats-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }

      .stats-controls {
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 13px;
      }

      .stats-controls label {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }

      .stats-controls select {
        padding: 4px 8px;
        border: 1px solid #ccc;
        border-radius: 3px;
        font-size: 13px;
      }

      .btn-refresh {
        padding: 4px 12px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 13px;
      }

      .btn-refresh:hover {
        background: #1976D2;
      }

      .stats-body {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .stats-section {
        background: #f9f9f9;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 12px;
      }

      .stats-section h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 600;
        color: #388E3C;
      }

      .loading {
        text-align: center;
        padding: 20px;
        color: #999;
        font-size: 13px;
      }

      .error {
        text-align: center;
        padding: 20px;
        color: #f44336;
        font-size: 13px;
      }

      /* Attempt Stats Table */
      .attempt-stats-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .attempt-stats-table th {
        background: #388E3C;
        color: white;
        padding: 6px 8px;
        text-align: left;
        font-weight: 600;
        font-size: 12px;
      }

      .attempt-stats-table th.num {
        text-align: right;
      }

      .attempt-stats-table td {
        padding: 4px 8px;
        border-bottom: 1px solid #e0e0e0;
      }

      .attempt-stats-table td.num {
        text-align: right;
        font-family: monospace;
      }

      .attempt-stats-table tr:hover {
        background: #f0f0f0;
      }

      /* Top Faces Grid */
      .top-faces-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        font-size: 12px;
      }

      .face-cell {
        padding: 4px 8px;
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .face-cell.ignored {
        background: #FFF3E0;
        border-color: #FFB74D;
      }

      /* Recent Images List */
      .recent-images-list {
        font-size: 12px;
      }

      .image-entry {
        padding: 6px 0;
        border-bottom: 1px solid #e0e0e0;
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .image-entry:last-child {
        border-bottom: none;
      }

      .image-filename {
        font-weight: 500;
        color: #333;
        flex-shrink: 0;
      }

      .image-names {
        color: #666;
        font-style: italic;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Recent Logs */
      .recent-logs-list {
        font-size: 11px;
        font-family: monospace;
      }

      .log-entry {
        padding: 4px 0;
        border-bottom: 1px solid #e0e0e0;
        white-space: pre-wrap;
        word-break: break-all;
      }

      .log-entry:last-child {
        border-bottom: none;
      }

      .log-entry.info {
        color: #388E3C;
      }

      .log-entry.warning {
        color: #F57C00;
      }

      .log-entry.error {
        color: #D32F2F;
      }
    `;
    container.appendChild(style);

    // Get DOM elements
    const attemptStatsContainer = container.querySelector('.attempt-stats-container');
    const topFacesContainer = container.querySelector('.top-faces-container');
    const recentImagesContainer = container.querySelector('.recent-images-container');
    const recentLogsContainer = container.querySelector('.recent-logs-container');
    const autoRefreshToggle = container.querySelector('.auto-refresh-toggle');
    const refreshRateSelect = container.querySelector('.refresh-rate');
    const btnRefresh = container.querySelector('.btn-refresh');

    /**
     * Fetch statistics from backend
     */
    async function fetchStatistics() {
      try {
        console.log('[StatsDashboard] Fetching statistics...');
        const data = await api.http.get('/api/statistics/summary');

        renderAttemptStats(data.attempt_stats);
        renderTopFaces(data.top_faces, data.ignored_count, data.ignored_total, data.ignored_fraction);
        renderRecentImages(data.recent_images);
        renderRecentLogs(data.recent_logs);

        console.log('[StatsDashboard] Statistics updated');
      } catch (err) {
        console.error('[StatsDashboard] Failed to fetch statistics:', err);
        showError(attemptStatsContainer, 'Failed to load statistics: ' + err.message);
      }
    }

    /**
     * Render attempt statistics table
     */
    function renderAttemptStats(stats) {
      if (!stats || stats.length === 0) {
        attemptStatsContainer.innerHTML = '<div class="error">No attempt statistics available</div>';
        return;
      }

      const table = document.createElement('table');
      table.className = 'attempt-stats-table';

      // Table header
      table.innerHTML = `
        <thead>
          <tr>
            <th>Backend & Settings</th>
            <th class="num">Used</th>
            <th class="num">Total</th>
            <th class="num">Hit %</th>
            <th class="num">Avg Faces</th>
            <th class="num">Avg Time</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector('tbody');

      // Table rows
      stats.forEach(stat => {
        const row = document.createElement('tr');

        // Format backend/settings column
        let settings;
        if (stat.backend === 'dlib') {
          settings = `${stat.backend}, up=${stat.upsample}, ${stat.scale_label} (${stat.scale_px}px)`;
        } else {
          settings = `${stat.backend}, ${stat.scale_label} (${stat.scale_px}px)`;
        }

        row.innerHTML = `
          <td>${settings}</td>
          <td class="num">${stat.used_count}</td>
          <td class="num">${stat.total_count}</td>
          <td class="num">${stat.hit_rate.toFixed(1)}%</td>
          <td class="num">${stat.avg_faces.toFixed(2)}</td>
          <td class="num">${stat.avg_time.toFixed(2)}s</td>
        `;

        tbody.appendChild(row);
      });

      attemptStatsContainer.innerHTML = '';
      attemptStatsContainer.appendChild(table);
    }

    /**
     * Render top faces grid (4 columns x 5 rows)
     */
    function renderTopFaces(faces, ignoredCount, ignoredTotal, ignoredFraction) {
      const grid = document.createElement('div');
      grid.className = 'top-faces-grid';

      // Prepare items: faces + ignored
      const items = [...faces];

      // Pad to 19 items
      while (items.length < 19) {
        items.push({ name: '', face_count: 0 });
      }

      // Add ignored as 20th item
      const ignoredText = ignoredTotal > 0
        ? `(${ignoredCount}/${ignoredTotal}, ${(ignoredFraction * 100).toFixed(1)}%)`
        : '(0)';
      items.push({ name: 'Ignored', face_count: ignoredText, isIgnored: true });

      // Column-major order (fill columns top to bottom, left to right)
      const numCols = 4;
      const numRows = 5;
      const gridItems = new Array(numCols * numRows);

      for (let col = 0; col < numCols; col++) {
        for (let row = 0; row < numRows; row++) {
          const idx = col * numRows + row;
          if (idx < items.length) {
            gridItems[row * numCols + col] = items[idx];
          }
        }
      }

      // Render cells
      gridItems.forEach(item => {
        if (!item) return;

        const cell = document.createElement('div');
        cell.className = 'face-cell';
        if (item.isIgnored) {
          cell.classList.add('ignored');
        }

        if (item.name) {
          if (item.name === 'Ignored') {
            cell.textContent = `${item.name} ${item.face_count}`;
          } else {
            cell.textContent = `${item.name} (${item.face_count})`;
          }
        } else {
          cell.textContent = '—';
        }

        grid.appendChild(cell);
      });

      topFacesContainer.innerHTML = '';
      topFacesContainer.appendChild(grid);
    }

    /**
     * Render recent images list
     */
    function renderRecentImages(images) {
      if (!images || images.length === 0) {
        recentImagesContainer.innerHTML = '<div class="error">No recent images</div>';
        return;
      }

      const list = document.createElement('div');
      list.className = 'recent-images-list';

      images.forEach(img => {
        const entry = document.createElement('div');
        entry.className = 'image-entry';

        const filename = document.createElement('span');
        filename.className = 'image-filename';
        filename.textContent = img.filename;

        const names = document.createElement('span');
        names.className = 'image-names';
        names.textContent = img.person_names.length > 0
          ? img.person_names.join(', ')
          : '—';

        entry.appendChild(filename);
        entry.appendChild(names);
        list.appendChild(entry);
      });

      recentImagesContainer.innerHTML = '';
      recentImagesContainer.appendChild(list);
    }

    /**
     * Render recent log lines
     */
    function renderRecentLogs(logs) {
      if (!logs || logs.length === 0) {
        recentLogsContainer.innerHTML = '<div class="error">No recent logs</div>';
        return;
      }

      const list = document.createElement('div');
      list.className = 'recent-logs-list';

      logs.forEach(log => {
        const entry = document.createElement('div');
        entry.className = `log-entry ${log.level}`;
        entry.textContent = log.message;
        list.appendChild(entry);
      });

      recentLogsContainer.innerHTML = '';
      recentLogsContainer.appendChild(list);
    }

    /**
     * Show error message
     */
    function showError(container, message) {
      container.innerHTML = `<div class="error">${message}</div>`;
    }

    /**
     * Start auto-refresh interval
     */
    function startAutoRefresh() {
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(fetchStatistics, refreshRate);
      console.log(`[StatsDashboard] Auto-refresh started (${refreshRate}ms)`);
    }

    /**
     * Stop auto-refresh interval
     */
    function stopAutoRefresh() {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        console.log('[StatsDashboard] Auto-refresh stopped');
      }
    }

    // Event listeners
    autoRefreshToggle.addEventListener('change', (e) => {
      autoRefresh = e.target.checked;
      if (autoRefresh) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    });

    refreshRateSelect.addEventListener('change', (e) => {
      refreshRate = parseInt(e.target.value, 10);
      if (autoRefresh) {
        startAutoRefresh(); // Restart with new rate
      }
    });

    btnRefresh.addEventListener('click', () => {
      fetchStatistics();
    });

    // Initial fetch
    fetchStatistics();

    // Start auto-refresh if enabled
    if (autoRefresh) {
      startAutoRefresh();
    }

    // Cleanup function
    return () => {
      console.log('[StatsDashboard] Cleaning up...');
      stopAutoRefresh();
    };
  },

  /**
   * Get current state for persistence
   * @returns {object} Serializable state
   */
  getState() {
    return {};
  },

  /**
   * Restore state from persistence
   * @param {object} state - Saved state
   */
  setState(state) {
    // No state to restore
  }
};
