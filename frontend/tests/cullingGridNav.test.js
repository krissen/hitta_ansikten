import { describe, it, expect } from 'vitest';
import { gridNavTarget } from '../src/renderer/components/culling-grid-nav.js';

// A 4-column grid over 10 items (indices 0..9):
//   0 1 2 3
//   4 5 6 7
//   8 9
const COLS = 4;
const N = 10;

describe('gridNavTarget', () => {
  it('returns -1 for an empty grid', () => {
    expect(gridNavTarget(0, 4, 0, 'right')).toBe(-1);
  });

  it('selects the first cell from no selection (any direction)', () => {
    expect(gridNavTarget(-1, COLS, N, 'right')).toBe(0);
    expect(gridNavTarget(-1, COLS, N, 'down')).toBe(0);
    expect(gridNavTarget(-1, COLS, N, 'left')).toBe(0);
    expect(gridNavTarget(-1, COLS, N, 'up')).toBe(0);
  });

  it('moves right/left by one, clamped at the ends', () => {
    expect(gridNavTarget(5, COLS, N, 'right')).toBe(6);
    expect(gridNavTarget(5, COLS, N, 'left')).toBe(4);
    expect(gridNavTarget(9, COLS, N, 'right')).toBe(9); // last item, stays
    expect(gridNavTarget(0, COLS, N, 'left')).toBe(0); // first item, stays
  });

  it('moves down/up by one row (±cols)', () => {
    expect(gridNavTarget(1, COLS, N, 'down')).toBe(5);
    expect(gridNavTarget(5, COLS, N, 'up')).toBe(1);
  });

  it('stays put when a vertical move would leave the grid (preserves column)', () => {
    expect(gridNavTarget(1, COLS, N, 'up')).toBe(1); // top row, no row above
    expect(gridNavTarget(7, COLS, N, 'down')).toBe(7); // 7+4=11 out of range, stays
    expect(gridNavTarget(9, COLS, N, 'down')).toBe(9);
  });

  it('descends into a partial last row when it exists', () => {
    expect(gridNavTarget(5, COLS, N, 'down')).toBe(9); // 5+4=9 exists
    expect(gridNavTarget(4, COLS, N, 'down')).toBe(8);
  });

  it('pages horizontally by PAGE_STEP, clamped', () => {
    expect(gridNavTarget(0, COLS, 30, 'right', true)).toBe(10);
    expect(gridNavTarget(25, COLS, 30, 'right', true)).toBe(29);
    expect(gridNavTarget(5, COLS, 30, 'left', true)).toBe(0);
  });

  it('pages vertically by cols*PAGE_ROWS, staying put on overflow', () => {
    // 30 items, 4 cols: index 0 + 4*3 = 12 exists
    expect(gridNavTarget(0, COLS, 30, 'down', true)).toBe(12);
    expect(gridNavTarget(12, COLS, 30, 'up', true)).toBe(0);
    // near the bottom, a full page down overflows → stay
    expect(gridNavTarget(25, COLS, 30, 'down', true)).toBe(25);
  });

  it('guards a zero/NaN column count as 1', () => {
    expect(gridNavTarget(3, 0, N, 'down')).toBe(4);
    expect(gridNavTarget(3, NaN, N, 'down')).toBe(4);
  });
});
