/**
 * Pure 2-D navigation for the culling thumbnail grid.
 *
 * left/right move by one cell (or PAGE_STEP when paging); up/down move by one
 * row (± cols, or ± cols*PAGE_ROWS when paging). Horizontal moves clamp to the
 * ends; vertical moves stay put when the target would fall outside the grid, so
 * the column is preserved (matching a contact-sheet's feel). Extracted from the
 * component so the geometry is unit-testable.
 */

const PAGE_STEP = 10; // horizontal page jump (cells)
const PAGE_ROWS = 3; // vertical page jump (rows)

/**
 * @param {number} index - current focused index (may be -1 for "none")
 * @param {number} cols - number of columns currently laid out (>= 1)
 * @param {number} count - number of items in the grid
 * @param {'left'|'right'|'up'|'down'} dir
 * @param {boolean} [page=false] - Alt/page navigation
 * @returns {number} target index, clamped to [0, count-1] (or -1 if empty)
 */
export function gridNavTarget(index, cols, count, dir, page = false) {
  if (count <= 0) return -1;
  // From no selection, the first keypress lands on the first cell rather than
  // moving off it (e.g. Right shouldn't skip index 0).
  if (index < 0) return 0;
  const i = Math.min(index, count - 1);
  const c = Math.max(1, Math.floor(cols) || 1);

  switch (dir) {
    case 'left':
      return Math.max(0, i - (page ? PAGE_STEP : 1));
    case 'right':
      return Math.min(count - 1, i + (page ? PAGE_STEP : 1));
    case 'up': {
      const t = i - c * (page ? PAGE_ROWS : 1);
      return t >= 0 ? t : i;
    }
    case 'down': {
      const t = i + c * (page ? PAGE_ROWS : 1);
      return t <= count - 1 ? t : i;
    }
    default:
      return i;
  }
}
