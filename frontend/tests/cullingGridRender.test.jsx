import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { CullingGrid } from '../src/renderer/components/CullingGrid.jsx';

// The grid renders one cell per file, marks the selected cell, and — when a
// player is highlighted — flags matching cells (from the filename) and dims the
// rest. Thumbnails are fetched lazily; here fetch is stubbed to reject so cells
// fall back to the placeholder (we assert on structure/classes, not images).

const FILES = [
  { path: '/p/260601_120000_Alice,_Bob.jpg', basename: '260601_120000_Alice,_Bob.jpg' },
  { path: '/p/260601_120100_Alice.jpg', basename: '260601_120100_Alice.jpg' },
  { path: '/p/260601_120200_Carol.jpg', basename: '260601_120200_Carol.jpg' },
];

let originalFetch;

beforeEach(() => {
  // Save/restore the real global — vi.restoreAllMocks() doesn't revert a plain
  // `global.fetch = ...` assignment, which would leak into other test files.
  originalFetch = global.fetch;
  global.fetch = vi.fn(async () => { throw new Error('no network in test'); });
});

afterEach(() => {
  global.fetch = originalFetch;
});

function renderGrid(props = {}) {
  const gridRef = { current: null };
  const result = render(
    <CullingGrid
      files={FILES}
      currentIndex={1}
      highlightPlayer=""
      gridRef={gridRef}
      onSelect={() => {}}
      onOpen={() => {}}
      onContextMenu={() => {}}
      {...props}
    />
  );
  return { ...result, gridRef };
}

describe('CullingGrid', () => {
  it('renders one cell per file with data-idx', () => {
    const { container } = renderGrid();
    const cells = container.querySelectorAll('.culling-grid-cell');
    expect(cells.length).toBe(3);
    expect(container.querySelector('[data-idx="0"]')).toBeTruthy();
    expect(container.querySelector('[data-idx="2"]')).toBeTruthy();
  });

  it('marks the current index as selected', () => {
    const { container } = renderGrid({ currentIndex: 1 });
    const selected = container.querySelectorAll('.culling-grid-cell.selected');
    expect(selected.length).toBe(1);
    expect(selected[0].getAttribute('data-idx')).toBe('1');
  });

  it('exposes a listbox with option cells and an active descendant', () => {
    const { container } = renderGrid({ currentIndex: 1 });
    const list = container.querySelector('.culling-grid');
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.getAttribute('aria-activedescendant')).toBe('culling-grid-cell-1');
    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBe(3);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
  });

  it('highlights cells containing the player and dims the rest', () => {
    const { container } = renderGrid({ highlightPlayer: 'Alice' });
    const cells = container.querySelectorAll('.culling-grid-cell');
    // Alice is in files 0 and 1 → highlighted; file 2 (Carol) → dimmed.
    expect(cells[0].classList.contains('highlight')).toBe(true);
    expect(cells[1].classList.contains('highlight')).toBe(true);
    expect(cells[2].classList.contains('highlight')).toBe(false);
    expect(cells[2].classList.contains('dimmed')).toBe(true);
    expect(cells[0].classList.contains('dimmed')).toBe(false);
  });

  it('applies no highlight/dim when no player is highlighted', () => {
    const { container } = renderGrid({ highlightPlayer: '' });
    expect(container.querySelectorAll('.culling-grid-cell.highlight').length).toBe(0);
    expect(container.querySelectorAll('.culling-grid-cell.dimmed').length).toBe(0);
  });
});
