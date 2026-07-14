/**
 * Live per-player stats panel for the culling workspace.
 *
 * Extracted verbatim from CullingModule. Renders the Räkna spelare-style table
 * (name · count · % · Δ% · distribution bar) plus the collapsible "excluded"
 * groups, and owns the loupe/grid click-vs-doubleclick debounce.
 */

import React, { useEffect, useRef } from 'react';
import { t } from '../../../i18n/index.js';

const EXCLUDED_KEYS = ['tranare', 'grupp', 'publik', 'below_threshold'];

/** Collapsible groups for names the count excludes (coaches, group photos,
 *  audience, below-threshold) — visible but separated from the live counts,
 *  matching the Räkna spelare page. Items are clickable (filter/highlight the
 *  person, same hand-off as the player rows) and right-clickable
 *  (session/permanent reclassification menu) when the callbacks are given. */
function CullingExcluded({ excluded, onSelect, onNameContextMenu }) {
  if (!excluded) return null;
  const groups = EXCLUDED_KEYS.filter(
    (key) => excluded[key] && excluded[key].length > 0
  );
  if (groups.length === 0) return null;
  return (
    <div className="culling-stats-excluded">
      {groups.map((key) => (
        <details key={key} className="culling-stats-group">
          <summary>{t('culling.stats.groupSummary', { label: t(`culling.stats.excludedLabels.${key}`), count: excluded[key].length })}</summary>
          <ul>
            {excluded[key].map((e) => (
              <li
                key={e.name}
                className={onSelect ? 'clickable' : undefined}
                onClick={onSelect ? () => onSelect(e.name) : undefined}
                onContextMenu={onNameContextMenu ? (ev) => onNameContextMenu(ev, e.name, key) : undefined}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onKeyDown={onSelect ? (ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    onSelect(e.name);
                  }
                } : undefined}
              >
                {t('culling.stats.excludedItem', { name: e.name, count: e.count, pct: e.pct })}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

/**
 * Live per-player count for the current scope, shown left of the file list.
 * Mirrors the Räkna spelare table (name · count · % · Δ% · distribution bar)
 * so the same numbers are in front of the user while culling. `stats` is the
 * /players/count response (or null); `selected` highlights the active player;
 * `width` is the column's pixel width (resizable via the stats divider).
 * `baseline`/`onBaselineChange` back the median/mean select in the header — the
 * shared counting setting, so changing it here also changes Räkna spelare.
 *
 * Row clicks are mode-dependent (`mode`): in the loupe a single click filters
 * the list to the player (`onSelect`); in the grid a single click highlights the
 * player's thumbnails (`onSelect`) while a double click filters (`onActivate`).
 * The single click is debounced in grid mode so a double click can cancel it.
 *
 * Rows are keyboard-operable (role="button" + tabIndex + Enter/Space) per the
 * house clickable-non-button pattern (accessibility.md §2). CullingModule's
 * capture-phase Enter/Esc handler yields to a focused role="button" so a keyed
 * Enter here filters instead of starting a rename.
 */
export function CullingStats({ stats, selected, onSelect, onActivate, mode, width, baseline, onBaselineChange, onNameContextMenu }) {
  const players = stats?.players || [];
  const maxCount = players.reduce((m, p) => Math.max(m, p.count), 1);
  const clickTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(clickTimerRef.current), []);
  // Cancel a pending single-click when the mode changes, so a debounced grid
  // highlight can't fire after the user has switched to the loupe.
  useEffect(() => {
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
  }, [mode]);

  // Loupe: fire immediately (no double-click role). Grid: debounce so a double
  // click (filter) can cancel the pending single click (highlight).
  const handleRowClick = (name) => {
    if (mode !== 'grid') { onSelect?.(name); return; }
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onSelect?.(name);
    }, 200);
  };
  const handleRowDouble = (name) => {
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    onActivate?.(name);
  };
  // Show excluded groups even when no player clears the threshold (small folders,
  // or after culling everyone below min_images) — otherwise the section this
  // change is meant to surface would be hidden behind the empty "—".
  const excluded = stats?.excluded || null;
  const hasExcluded = !!excluded &&
    EXCLUDED_KEYS.some((k) => excluded[k] && excluded[k].length > 0);
  return (
    <div className="culling-stats" style={{ flex: `0 0 ${width}px` }}>
      <div className="culling-stats-header">
        <span>{t('culling.stats.header')}</span>
        {onBaselineChange && (
          <select
            className="form-select culling-stats-baseline-select"
            value={baseline || 'median'}
            onChange={(e) => onBaselineChange(e.target.value)}
            title={t('culling.stats.baselineSelectTitle')}
            aria-label={t('culling.stats.baselineSelectLabel')}
          >
            <option value="median">{t('culling.stats.baselineMedian')}</option>
            <option value="mean">{t('culling.stats.baselineMean')}</option>
          </select>
        )}
        {stats?.baseline != null && (
          <span className="culling-stats-baseline" title={t('culling.stats.baselineTitle')}>
            ~{Math.round(stats.baseline)}
          </span>
        )}
      </div>
      {players.length === 0 && !hasExcluded ? (
        <div className="culling-stats-empty">{t('culling.stats.empty')}</div>
      ) : (
        <div className="culling-stats-scroll">
          {players.length > 0 && (
          <table className="culling-stats-table">
            <thead>
              <tr>
                <th>{t('culling.stats.columns.name')}</th>
                <th className="num">{t('culling.stats.columns.count')}</th>
                <th className="num">{t('culling.stats.columns.pct')}</th>
                <th className="num">{t('culling.stats.columns.delta')}</th>
                <th className="bar-col">{t('culling.stats.columns.distribution')}</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const title = !onSelect
                  ? t('culling.stats.rowTitle.count', { name: p.name, count: p.count })
                  : mode === 'grid'
                    ? t('culling.stats.rowTitle.gridSelect', { name: p.name })
                    : t('culling.stats.rowTitle.loupeFilter', { name: p.name });
                const activate = onSelect
                  ? () => handleRowClick(p.name === selected ? '' : p.name)
                  : undefined;
                return (
                <tr
                  key={p.name}
                  className={`culling-stat-row${onSelect ? ' clickable' : ''}${p.name === selected ? ' active row-selected' : ''}`}
                  onClick={activate}
                  onDoubleClick={mode === 'grid' && onActivate ? () => handleRowDouble(p.name) : undefined}
                  role={onSelect ? 'button' : undefined}
                  tabIndex={onSelect ? 0 : undefined}
                  aria-label={onSelect ? title : undefined}
                  onKeyDown={onSelect ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      activate?.();
                    }
                  } : undefined}
                  onContextMenu={onNameContextMenu ? (e) => onNameContextMenu(e, p.name, 'players') : undefined}
                  title={title}
                >
                  <td className="culling-stat-name">{p.name}</td>
                  <td className="num">{p.count}</td>
                  <td className="num">{p.pct}%</td>
                  <td className={`num delta delta-${p.level || 'ok'}`}>
                    {p.delta_pct > 0 ? '+' : ''}{p.delta_pct}%
                  </td>
                  <td className="bar-col">
                    <div className="culling-bar-track">
                      <div
                        className={`culling-bar-fill level-${p.level || 'ok'}`}
                        style={{ width: `${(p.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          )}
          <CullingExcluded
            excluded={excluded}
            onSelect={onSelect ? (name) => handleRowClick(name === selected ? '' : name) : undefined}
            onNameContextMenu={onNameContextMenu}
          />
        </div>
      )}
    </div>
  );
}

export default CullingStats;
