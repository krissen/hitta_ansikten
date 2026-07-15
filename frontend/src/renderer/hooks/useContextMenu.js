/**
 * useContextMenu - open/dismiss state for a cursor-positioned context menu.
 *
 * `openMenu(event, payload)` prevents the native menu and stores
 * `{ x, y, ...payload }`; render the menu (e.g. the shared <ContextMenu>) from
 * `menu` and pass `closeMenu` as its onClose. The dismiss behavior mirrors the
 * culling menu: any click, a fresh right-click elsewhere, scroll, resize, or
 * Escape closes it.
 */

import { useCallback, useEffect, useState } from 'react';

export function useContextMenu() {
  const [menu, setMenu] = useState(null);

  const openMenu = useCallback((e, payload = {}) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, ...payload });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    // Esc closes the menu authoritatively: swallow it so it can't also reach
    // other document handlers while the menu is open.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  return { menu, openMenu, closeMenu };
}

export default useContextMenu;
