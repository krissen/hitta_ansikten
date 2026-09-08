/**
 * useDropdownPosition - Calculate dropdown position with flip logic
 *
 * Renders dropdown below input if space available, otherwise above.
 */

import { useState, useEffect } from 'react';

/**
 * Hook for calculating dropdown position with flip logic.
 * Renders dropdown below input if space available, otherwise above.
 * @param {boolean} open - Whether dropdown is open
 * @param {HTMLElement|null} anchorEl - The input element to anchor to
 * @param {Object} options - Configuration options
 * @returns {Object} Style object for the dropdown
 */
export function useDropdownPosition(
  open,
  anchorEl,
  { maxHeight = 200, gap = 4 } = {},
) {
  const [style, setStyle] = useState({ display: 'none' });

  useEffect(() => {
    if (!open || !anchorEl) {
      setStyle({ display: 'none' });
      return;
    }

    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      const spaceBelow = viewportHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;

      const placeAbove = spaceBelow < maxHeight && spaceAbove > spaceBelow;
      const availableHeight = placeAbove
        ? Math.min(spaceAbove, maxHeight)
        : Math.min(spaceBelow, maxHeight);

      const newStyle = {
        position: 'fixed',
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        maxHeight: `${availableHeight}px`,
        zIndex: 10001,
      };

      if (placeAbove) {
        newStyle.bottom = `${viewportHeight - rect.top + gap}px`;
        newStyle.top = 'auto';
      } else {
        newStyle.top = `${rect.bottom + gap}px`;
        newStyle.bottom = 'auto';
      }

      setStyle(newStyle);
    };

    updatePosition();

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, anchorEl, maxHeight, gap]);

  return style;
}

export default useDropdownPosition;
