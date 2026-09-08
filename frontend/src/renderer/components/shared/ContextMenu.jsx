/**
 * ContextMenu - generic right-click menu (cursor-positioned popover).
 *
 * Presentational and data-driven: renders `items` at `menu.x`/`menu.y` and
 * renders nothing when `menu` is null. Pair with the `useContextMenu` hook,
 * which owns the open/dismiss state. Each item click closes the menu first,
 * then invokes the item's `onClick` with the full `menu` payload.
 *
 * items: Array<{ key, label, onClick(menu) } | { key, separator: true }>
 */

import React from 'react';
import './shared.css';

export function ContextMenu({ menu, items, onClose }) {
  if (!menu) return null;
  return (
    <ul
      className="ctx-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) =>
        item.separator ? (
          <li key={item.key} className="ctx-menu-sep" role="separator" />
        ) : (
          <li
            key={item.key}
            onClick={() => {
              onClose();
              item.onClick?.(menu);
            }}
          >
            {item.label}
          </li>
        ),
      )}
    </ul>
  );
}

export default ContextMenu;
