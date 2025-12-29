/**
 * StatisticsDashboard - React component for face detection statistics
 *
 * Features:
 * - Auto-refresh with configurable interval
 * - Attempt statistics table
 * - Top faces grid (4x5)
 * - Recent images list
 * - Recent log lines
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';
import './StatisticsDashboard.css';

/**
 * StatisticsDashboard Component
 */
export function StatisticsDashboard() {
  const { api } = useBackend();

  // State
  const [attemptStats, setAttemptStats] = useState(null);
  const [topFaces, setTopFaces] = useState([]);
  const [ignoredStats, setIgnoredStats] = useState({ count: 0, total: 0, fraction: 0 });
  const [recentImages, setRecentImages] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Auto-refresh settings
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshRate, setRefreshRate] = useState(5000);

  /**
   * Fetch statistics from backend
   */
  const fetchStatistics = useCallback(async () => {
    try {
      const data = await api.get('/api/statistics/summary');

      setAttemptStats(data.attempt_stats || []);
      setTopFaces(data.top_faces || []);
      setIgnoredStats({
        count: data.ignored_count || 0,
        total: data.ignored_total || 0,
        fraction: data.ignored_fraction || 0
      });
      setRecentImages(data.recent_images || []);
      setRecentLogs(data.recent_logs || []);
      setError(null);
      setIsLoading(false);
    } catch (err) {
      console.error('[StatsDashboard] Failed to fetch statistics:', err);
      setError(err.message);
      setIsLoading(false);
    }
  }, [api]);

  // Use auto-refresh hook
  useAutoRefresh(fetchStatistics, refreshRate, autoRefresh);

  // Initial fetch
  useEffect(() => {
    fetchStatistics();
  }, [fetchStatistics]);

  return (
    <div className="stats-dashboard">
      <div className="stats-header">
        <h3>Statistics Dashboard</h3>
        <div className="stats-controls">
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <select
            value={refreshRate}
            onChange={(e) => setRefreshRate(parseInt(e.target.value, 10))}
          >
            <option value="2000">2s</option>
            <option value="5000">5s</option>
            <option value="10000">10s</option>
          </select>
          <button className="btn-refresh" onClick={fetchStatistics}>
            Refresh Now
          </button>
        </div>
      </div>

      <div className="stats-body">
        {error && <div className="stats-error">Error: {error}</div>}

        {/* Attempt Statistics Table */}
        <AttemptStatsSection stats={attemptStats} isLoading={isLoading} />

        {/* Top Faces Grid */}
        <TopFacesSection
          faces={topFaces}
          ignoredStats={ignoredStats}
          isLoading={isLoading}
        />

        {/* Recent Images */}
        <RecentImagesSection images={recentImages} isLoading={isLoading} />

        {/* Recent Logs */}
        <RecentLogsSection logs={recentLogs} isLoading={isLoading} />
      </div>
    </div>
  );
}

/**
 * Attempt Statistics Section
 */
function AttemptStatsSection({ stats, isLoading }) {
  if (isLoading) {
    return (
      <div className="stats-section">
        <h4>Attempt Statistics</h4>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!stats || stats.length === 0) {
    return (
      <div className="stats-section">
        <h4>Attempt Statistics</h4>
        <div className="empty">No attempt statistics available</div>
      </div>
    );
  }

  return (
    <div className="stats-section">
      <h4>Attempt Statistics</h4>
      <table className="attempt-stats-table">
        <thead>
          <tr>
            <th>Backend &amp; Settings</th>
            <th className="num">Used</th>
            <th className="num">Total</th>
            <th className="num">Hit %</th>
            <th className="num">Avg Faces</th>
            <th className="num">Avg Time</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((stat, idx) => {
            const settings = stat.backend === 'dlib'
              ? `${stat.backend}, up=${stat.upsample}, ${stat.scale_label} (${stat.scale_px}px)`
              : `${stat.backend}, ${stat.scale_label} (${stat.scale_px}px)`;

            return (
              <tr key={idx}>
                <td>{settings}</td>
                <td className="num">{stat.used_count}</td>
                <td className="num">{stat.total_count}</td>
                <td className="num">{stat.hit_rate.toFixed(1)}%</td>
                <td className="num">{stat.avg_faces.toFixed(2)}</td>
                <td className="num">{stat.avg_time.toFixed(2)}s</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Top Faces Grid Section
 */
function TopFacesSection({ faces, ignoredStats, isLoading }) {
  if (isLoading) {
    return (
      <div className="stats-section">
        <h4>Top Faces (19 most common + Ignored)</h4>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  // Prepare items: faces + padding + ignored
  const items = [...faces];
  while (items.length < 19) {
    items.push({ name: '', face_count: 0 });
  }

  // Add ignored as 20th item
  const ignoredText = ignoredStats.total > 0
    ? `(${ignoredStats.count}/${ignoredStats.total}, ${(ignoredStats.fraction * 100).toFixed(1)}%)`
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

  return (
    <div className="stats-section">
      <h4>Top Faces (19 most common + Ignored)</h4>
      <div className="top-faces-grid">
        {gridItems.map((item, idx) => {
          if (!item) return <div key={idx} className="face-cell">—</div>;

          const className = `face-cell ${item.isIgnored ? 'ignored' : ''}`;
          let content = '—';

          if (item.name) {
            if (item.name === 'Ignored') {
              content = `${item.name} ${item.face_count}`;
            } else {
              content = `${item.name} (${item.face_count})`;
            }
          }

          return (
            <div key={idx} className={className}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Recent Images Section
 */
function RecentImagesSection({ images, isLoading }) {
  if (isLoading) {
    return (
      <div className="stats-section">
        <h4>Recent Images</h4>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!images || images.length === 0) {
    return (
      <div className="stats-section">
        <h4>Recent Images</h4>
        <div className="empty">No recent images</div>
      </div>
    );
  }

  return (
    <div className="stats-section">
      <h4>Recent Images</h4>
      <div className="recent-images-list">
        {images.map((img, idx) => (
          <div key={idx} className="image-entry">
            <span className="image-filename">{img.filename}</span>
            <span className="image-names">
              {img.person_names && img.person_names.length > 0
                ? img.person_names.join(', ')
                : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Recent Logs Section
 */
function RecentLogsSection({ logs, isLoading }) {
  if (isLoading) {
    return (
      <div className="stats-section">
        <h4>Recent Log Lines</h4>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="stats-section">
        <h4>Recent Log Lines</h4>
        <div className="empty">No recent logs</div>
      </div>
    );
  }

  return (
    <div className="stats-section">
      <h4>Recent Log Lines</h4>
      <div className="recent-logs-list">
        {logs.map((log, idx) => (
          <div key={idx} className={`stats-log-entry ${log.level}`}>
            {log.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default StatisticsDashboard;
