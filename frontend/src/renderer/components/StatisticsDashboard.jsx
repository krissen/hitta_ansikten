/**
 * StatisticsDashboard - React component for face detection statistics
 *
 * Features:
 * - Auto-refresh with configurable interval
 * - Attempt statistics table
 * - Top faces grid (4x5)
 * - Recent images list
 * - Recent log lines (from frontend debug buffer)
 * - Configurable sections via preferences
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useAutoRefresh } from '../hooks/useAutoRefresh.js';
import { debug, debugError, getLogBuffer } from '../shared/debug.js';
import { preferences } from '../workspace/preferences.js';
import { t } from '../../i18n/index.js';
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

  // Dashboard preferences
  const [dashboardPrefs, setDashboardPrefs] = useState(() => preferences.get('dashboard') || {});

  // Refresh interval from prefs (stable reference)
  const refreshInterval = dashboardPrefs.refreshInterval ?? 5000;
  const initialAutoRefresh = dashboardPrefs.autoRefresh ?? true;

  /**
   * Get logs from frontend debug buffer (same source as LogViewer)
   */
  const getLogsFromBuffer = useCallback(() => {
    const logLineCount = dashboardPrefs.logLineCount ?? 5;
    const buffer = getLogBuffer();
    // Get last N entries
    const logs = buffer.slice(-logLineCount).map(entry => ({
      level: entry.level || 'info',
      message: `[${entry.category}] ${entry.args?.join(' ') || entry.message || ''}`,
      timestamp: entry.timestamp
    }));
    setRecentLogs(logs);
  }, [dashboardPrefs.logLineCount]);

  /**
   * Fetch statistics from backend
   */
  const fetchStatistics = useCallback(async () => {
    debug('Statistics', `Fetching summary... (interval=${refreshInterval}ms)`);
    try {
      const data = await api.get('/api/v1/statistics/summary');

      setAttemptStats(data.attempt_stats || []);
      setTopFaces(data.top_faces || []);
      setIgnoredStats({
        count: data.ignored_count || 0,
        total: data.ignored_total || 0,
        fraction: data.ignored_fraction || 0
      });
      setRecentImages(data.recent_images || []);
      // Logs now come from frontend buffer, not backend
      getLogsFromBuffer();
      setError(null);
      setIsLoading(false);
    } catch (err) {
      debugError('Statistics', 'Failed to fetch statistics:', err);
      setError(err.message);
      setIsLoading(false);
    }
  }, [api, getLogsFromBuffer]);

  // Use auto-refresh hook - use returned controls instead of separate state
  const { isEnabled: autoRefresh, setEnabled: setAutoRefresh, refresh } = useAutoRefresh(fetchStatistics, {
    interval: refreshInterval,
    initialEnabled: initialAutoRefresh,
    refreshOnMount: true
  });

  // Local state for refresh rate selector (to update interval)
  const [refreshRate, setRefreshRate] = useState(refreshInterval);

  // Listen for preference changes
  useEffect(() => {
    const handlePrefsChanged = () => {
      const newPrefs = preferences.get('dashboard') || {};
      setDashboardPrefs(newPrefs);
    };
    window.addEventListener('preferences-changed', handlePrefsChanged);
    return () => window.removeEventListener('preferences-changed', handlePrefsChanged);
  }, []);

  // Check which sections to show (defaults to true for backwards compatibility)
  const showAttemptStats = dashboardPrefs.showAttemptStats !== false;
  const showTopFaces = dashboardPrefs.showTopFaces !== false;
  const showRecentImages = dashboardPrefs.showRecentImages !== false;
  const showRecentLogs = dashboardPrefs.showRecentLogs === true; // Default false

  return (
    <div className="module-container stats-dashboard">
      <div className="module-header">
        <h3 className="module-title">{t('statistics.title')}</h3>
        <div className="button-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            {t('statistics.autoRefresh')}
          </label>
          <select
            className="form-select"
            value={refreshRate}
            onChange={(e) => setRefreshRate(parseInt(e.target.value, 10))}
          >
            <option value="2000">2s</option>
            <option value="5000">5s</option>
            <option value="10000">10s</option>
            <option value="30000">30s</option>
          </select>
          <button className="btn-secondary" onClick={refresh}>
            {t('statistics.refreshNow')}
          </button>
        </div>
      </div>

      <div className="module-body stats-body">
        {error && <div className="status-message error">{t('statistics.errorPrefix')} {error}</div>}

        {/* Attempt Statistics Table */}
        {showAttemptStats && (
          <AttemptStatsSection stats={attemptStats} isLoading={isLoading} />
        )}

        {/* Top Faces Grid */}
        {showTopFaces && (
          <TopFacesSection
            faces={topFaces}
            ignoredStats={ignoredStats}
            isLoading={isLoading}
          />
        )}

        {/* Recent Images */}
        {showRecentImages && (
          <RecentImagesSection images={recentImages} isLoading={isLoading} />
        )}

        {/* Recent Logs (disabled by default - use LogViewer module) */}
        {showRecentLogs && (
          <RecentLogsSection logs={recentLogs} isLoading={isLoading} />
        )}

        {/* Show message if all sections are hidden */}
        {!showAttemptStats && !showTopFaces && !showRecentImages && !showRecentLogs && (
          <div className="empty-state">
            {t('statistics.emptyState.line1')}<br/>
            {t('statistics.emptyState.line2')}
          </div>
        )}
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
      <div className="section-card">
        <h4 className="section-title">{t('statistics.sections.attemptStats')}</h4>
        <div className="empty-state compact">{t('statistics.loading')}</div>
      </div>
    );
  }

  if (!stats || stats.length === 0) {
    return (
      <div className="section-card">
        <h4 className="section-title">{t('statistics.sections.attemptStats')}</h4>
        <div className="empty-state compact">{t('statistics.empty.attemptStats')}</div>
      </div>
    );
  }

  return (
    <div className="section-card">
      <h4 className="section-title">{t('statistics.sections.attemptStats')}</h4>
      <table className="attempt-stats-table">
        <thead>
          <tr>
            <th>{t('statistics.table.backendSettings')}</th>
            <th className="num">{t('statistics.table.attempts')}</th>
            <th className="num">{t('statistics.table.chosen')}</th>
            <th className="num">{t('statistics.table.hitRate')}</th>
            <th className="num">{t('statistics.table.avgFaces')}</th>
            <th className="num">{t('statistics.table.avgTime')}</th>
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
                <td className="num">{stat.total_count}</td>
                <td className="num">{stat.used_count}</td>
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
      <div className="section-card">
        <h4 className="section-title">{t('statistics.sections.topFaces', { count: 19 })}</h4>
        <div className="empty-state compact">{t('statistics.loading')}</div>
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
    <div className="section-card">
      <h4 className="section-title">{t('statistics.sections.topFaces', { count: 19 })}</h4>
      <div className="top-faces-grid">
        {gridItems.map((item, idx) => {
          if (!item) return <div key={idx} className="face-cell">—</div>;

          const className = `face-cell ${item.isIgnored ? 'ignored' : ''}`;
          let content = '—';

          if (item.name) {
            if (item.name === 'Ignored') {
              content = `${t('statistics.ignored')} ${item.face_count}`;
            } else {
              // Show count and percentage (e.g., "Elton (259, 15%)")
              const pct = item.percentage !== undefined ? `, ${item.percentage}%` : '';
              content = `${item.name} (${item.face_count}${pct})`;
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
      <div className="section-card">
        <h4 className="section-title">{t('statistics.sections.recentImages')}</h4>
        <div className="empty-state compact">{t('statistics.loading')}</div>
      </div>
    );
  }

  if (!images || images.length === 0) {
    return (
      <div className="section-card">
        <h4 className="section-title">{t('statistics.sections.recentImages')}</h4>
        <div className="empty-state compact">{t('statistics.empty.recentImages')}</div>
      </div>
    );
  }

  return (
    <div className="section-card">
      <h4 className="section-title">{t('statistics.sections.recentImages')}</h4>
      <div className="recent-images-list">
        {images.map((img, idx) => (
          <div key={idx} className={`image-entry ${img.source === 'ansikten' ? 'source-ansikten' : 'source-cli'}`}>
            <span className="image-filename">
              {img.filename}
              {img.source === 'cli' && <span className="source-badge cli">CLI</span>}
            </span>
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
      <div className="section-card">
        <h4 className="section-title">{t('statistics.sections.recentLogs')}</h4>
        <div className="empty-state compact">{t('statistics.loading')}</div>
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="section-card">
        <h4 className="section-title">{t('statistics.sections.recentLogs')}</h4>
        <div className="empty-state compact">{t('statistics.empty.recentLogs')}</div>
      </div>
    );
  }

  return (
    <div className="section-card">
      <h4 className="section-title">{t('statistics.sections.recentLogs')}</h4>
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
