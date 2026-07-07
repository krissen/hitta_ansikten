/**
 * Live per-player stats panel for the culling workspace.
 *
 * Extracted verbatim from CullingModule. Renders the Räkna spelare-style table
 * (name · count · % · Δ% · distribution bar) plus the collapsible "excluded"
 * groups, and owns the loupe/grid click-vs-doubleclick debounce.
 */

import React, { useEffect, useRef } from 'react';

const EXCLUDED_LABELS = {
  tranare: 'Tränare',
  grupp: 'Gruppbilder',
  publik: 'Publik',
  below_threshold: 'Under tröskeln',
};

/** Collapsible groups for names the count excludes (coaches, group photos,
 *  audience, below-threshold) — visible but separated from the live counts,
 *  matching the Räkna spelare page. */
function CullingExcluded({ excluded }) {
  if (!excluded) return null;
  const groups = Object.entries(EXCLUDED_LABELS).filter(
    ([key]) => excluded[key] && excluded[key].length > 0
  );
  if (groups.length === 0) return null;
  return (
    <div className="culling-stats-excluded">
      {groups.map(([key, label]) => (
        <details key={key} className="culling-stats-group">
          <summary>{label} ({excluded[key].length})</summary>
          <ul>
            {excluded[key].map((e) => (
              <li key={e.name}>{e.name}: {e.count} ({e.pct}%)</li>
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
 *
 * Row clicks are mode-dependent (`mode`): in the loupe a single click filters
 * the list to the player (`onSelect`); in the grid a single click highlights the
 * player's thumbnails (`onSelect`) while a double click filters (`onActivate`).
 * The single click is debounced in grid mode so a double click can cancel it.
 */
export function CullingStats({ stats, selected, onSelect, onActivate, mode, width }) {
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
    Object.keys(EXCLUDED_LABELS).some((k) => excluded[k] && excluded[k].length > 0);
  return (
    <div className="culling-stats" style={{ flex: `0 0 ${width}px` }}>
      <div className="culling-stats-header">
        <span>Spelare</span>
        {stats?.baseline != null && (
          <span className="culling-stats-baseline" title="Baslinje (median)">
            ~{Math.round(stats.baseline)}
          </span>
        )}
      </div>
      {players.length === 0 && !hasExcluded ? (
        <div className="culling-stats-empty">—</div>
      ) : (
        <div className="culling-stats-scroll">
          {players.length > 0 && (
          <table className="culling-stats-table">
            <thead>
              <tr>
                <th>Namn</th>
                <th className="num">Antal</th>
                <th className="num">%</th>
                <th className="num">Δ%</th>
                <th className="bar-col">Fördelning</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr
                  key={p.name}
                  className={`culling-stat-row${onSelect ? ' clickable' : ''}${p.name === selected ? ' active row-selected' : ''}`}
                  onClick={onSelect ? () => handleRowClick(p.name === selected ? '' : p.name) : undefined}
                  onDoubleClick={mode === 'grid' && onActivate ? () => handleRowDouble(p.name) : undefined}
                  title={
                    !onSelect
                      ? `${p.name}: ${p.count}`
                      : mode === 'grid'
                        ? `Markera ${p.name} · dubbelklicka för att filtrera`
                        : `Filtrera på ${p.name}`
                  }
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
              ))}
            </tbody>
          </table>
          )}
          <CullingExcluded excluded={excluded} />
        </div>
      )}
    </div>
  );
}

export default CullingStats;
