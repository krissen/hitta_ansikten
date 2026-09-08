/**
 * CullingGrid - Lightroom-like thumbnail/overview mode for the culling module.
 *
 * A scrollable contact sheet over the same `files` + `currentIndex` the loupe
 * (single-image) view uses, so navigation, culling and undo all operate on the
 * shared selection. Thumbnails come from the backend overview endpoint via
 * useGridThumbnail. Per-player highlight is derived client-side from filenames
 * (namesInBasename) — no backend data needed for the marking.
 *
 * Kept deliberately presentational: keyboard handling, mode switching and the
 * column-count geometry live in the parent (CullingModule).
 */

import React, { useEffect } from 'react';
import { t } from '../../i18n/index.js';
import { useGridThumbnail } from '../shared/grid-thumbnail-cache.js';
import { namesInBasename } from './culling-names.js';

// Longest-edge px fetched from the backend. Larger than the display cell so the
// thumbnails stay crisp; the CSS min column width is smaller (see CullingModule.css).
const THUMB_FETCH_SIZE = 256;

function GridCell({
  file,
  index,
  selected,
  highlighted,
  dimmed,
  onSelect,
  onOpen,
  onContextMenu,
}) {
  // Fingerprint (mtime+size, from the backend list payload) so an in-place
  // re-export busts this cell's cached thumbnail — mirrors the loupe's
  // `${mtimeMs}-${size}`. Absent field → no fingerprint (prior behavior).
  const fingerprint =
    file.mtime_ms != null ? `${file.mtime_ms}-${file.size}` : undefined;
  const { url, error } = useGridThumbnail(
    file.path,
    THUMB_FETCH_SIZE,
    fingerprint,
  );
  const cls = [
    'culling-grid-cell',
    selected ? 'selected' : '',
    highlighted ? 'highlight' : '',
    dimmed ? 'dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      data-idx={index}
      id={`culling-grid-cell-${index}`}
      role="option"
      aria-selected={selected}
      aria-label={file.basename}
      onClick={() => onSelect(index)}
      onDoubleClick={() => onOpen(index)}
      onContextMenu={(e) => onContextMenu(e, index, file)}
      title={file.basename}
    >
      {url ? (
        <img
          className="culling-grid-img"
          src={url}
          alt={file.basename}
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className="culling-grid-placeholder">{error ? '⚠' : ''}</div>
      )}
      <div className="culling-grid-caption">{file.basename}</div>
    </div>
  );
}

export function CullingGrid({
  files,
  currentIndex,
  highlightPlayer,
  onSelect,
  onOpen,
  onContextMenu,
  gridRef,
}) {
  // Keep the focused cell visible as the selection moves (arrow nav, advance).
  useEffect(() => {
    const grid = gridRef?.current;
    if (!grid || currentIndex < 0) return;
    const cell = grid.querySelector(`[data-idx="${currentIndex}"]`);
    if (cell && typeof cell.scrollIntoView === 'function') {
      cell.scrollIntoView({ block: 'nearest' });
    }
  }, [currentIndex, files, gridRef]);

  const highlightActive = !!highlightPlayer;

  // Listbox pattern: the container is the focusable control and tracks the
  // active cell via aria-activedescendant, matching the container-level keyboard
  // model (arrows/Enter/Esc handled in CullingModule when culling is active).
  return (
    <div
      className="culling-grid"
      ref={gridRef}
      tabIndex={0}
      role="listbox"
      aria-label={t('culling.grid.overviewLabel')}
      aria-activedescendant={
        currentIndex >= 0 ? `culling-grid-cell-${currentIndex}` : undefined
      }
    >
      {files.map((f, i) => {
        // Prefer the backend-parsed names (kept in sync with the stats column);
        // fall back to parsing the basename if a file object lacks them.
        const names = f.names || namesInBasename(f.basename);
        const matches = highlightActive && names.includes(highlightPlayer);
        return (
          <GridCell
            key={f.path}
            file={f}
            index={i}
            selected={i === currentIndex}
            highlighted={matches}
            dimmed={highlightActive && !matches}
            onSelect={onSelect}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
          />
        );
      })}
    </div>
  );
}

export default CullingGrid;
