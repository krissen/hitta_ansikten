/**
 * CullingContextMenu - right-click menu for a file row / grid cell.
 *
 * Extracted verbatim from CullingModule. Presentational: it renders the menu at
 * the cursor and forwards each action to the callbacks the shell owns (the
 * cull-loop, inline rename, navigation and Lightroom hand-off). Renders nothing
 * when `menu` is null.
 */

import React from 'react';

export function CullingContextMenu({
  menu,
  setMenu,
  guardedNavigate,
  setCurrentIndex,
  files,
  viewMode,
  pageStep,
  beginEdit,
  trashIndex,
  undoTrash,
  openRawInLightroom,
}) {
  if (!menu) return null;
  return (
    <ul
      className="culling-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <li onClick={() => { setMenu(null); guardedNavigate(() => setCurrentIndex((i) => Math.max(i - 1, 0))); }}>
        {/* In the grid ↑/↓ move by rows, so the prev/next hint is just ←/→ there. */}
        <span>Föregående</span><span className="culling-menu-keys"><kbd>←</kbd>{viewMode !== 'grid' && <kbd>↑</kbd>}</span>
      </li>
      <li onClick={() => { setMenu(null); guardedNavigate(() => setCurrentIndex((i) => Math.min(i + 1, files.length - 1))); }}>
        <span>Nästa</span><span className="culling-menu-keys"><kbd>→</kbd>{viewMode !== 'grid' && <kbd>↓</kbd>}</span>
      </li>
      <li onClick={() => { setMenu(null); guardedNavigate(() => setCurrentIndex((i) => Math.max(i - pageStep, 0))); }}>
        <span>Hoppa bakåt</span><span className="culling-menu-keys"><kbd>⌥</kbd><kbd>←</kbd></span>
      </li>
      <li onClick={() => { setMenu(null); guardedNavigate(() => setCurrentIndex((i) => Math.min(i + pageStep, files.length - 1))); }}>
        <span>Hoppa framåt</span><span className="culling-menu-keys"><kbd>⌥</kbd><kbd>→</kbd></span>
      </li>
      <li className="culling-menu-sep" role="separator" />
      <li onClick={() => {
        setMenu(null);
        const idx = files.findIndex((f) => f.path === menu.path);
        if (idx >= 0) beginEdit(idx);
      }}>
        <span>Byt namn</span><span className="culling-menu-keys"><kbd>Enter</kbd></span>
      </li>
      <li onClick={() => {
        setMenu(null);
        const idx = files.findIndex((f) => f.path === menu.path);
        if (idx >= 0) trashIndex(idx);
      }}>
        <span>Gallra</span><span className="culling-menu-keys"><kbd>X</kbd><kbd>⌘</kbd><kbd>⌫</kbd></span>
      </li>
      <li onClick={() => { setMenu(null); undoTrash(); }}>
        <span>Ångra senaste</span><span className="culling-menu-keys"><kbd>⌘</kbd><kbd>Z</kbd></span>
      </li>
      <li className="culling-menu-sep" role="separator" />
      <li onClick={() => { const p = menu.path; setMenu(null); openRawInLightroom(p); }}>
        <span>Öppna i Lightroom</span><span className="culling-menu-keys"><kbd>L</kbd></span>
      </li>
    </ul>
  );
}

export default CullingContextMenu;
