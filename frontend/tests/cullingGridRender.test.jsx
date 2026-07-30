import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { settle } from './helpers/settle.js';
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
  // Never-resolving so useGridThumbnail doesn't fire an async state update after
  // the assertions (which would warn about updates outside act()). These tests
  // only assert structure/classes, not the loaded image.
  global.fetch = vi.fn(() => new Promise(() => {}));
});

afterEach(async () => {
  // Drain before the mocks go away. React commits the DOM before it runs
  // passive effects, so a wait that settles on rendered output can return with
  // an effect still pending; it then commits during teardown — after
  // vi.restoreAllMocks() here, and inside Testing Library's cleanup, which
  // Vitest's reverse hook order runs after this hook. The transport is gone by
  // then, and the effect throws where no test can see it. Draining here settles
  // those effects while their mocks still work. Same hazard that took dev red
  // through fileQueueModule.test.jsx.
  await settle();
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

  it('sends the mtime/size fingerprint as the thumbnail cache-buster', () => {
    // Distinct paths from the shared FILES so the singleton grid cache doesn't
    // serve a prior test's cached entry (which would skip the fetch we assert on).
    const files = [
      { path: '/fp/260601_130000_Fp.jpg', basename: '260601_130000_Fp.jpg', mtime_ms: 1700, size: 2048 },
      { path: '/fp/260601_130100_NoFp.jpg', basename: '260601_130100_NoFp.jpg' },
    ];
    renderGrid({ files, currentIndex: 0, highlightPlayer: '' });
    const urls = global.fetch.mock.calls.map((c) => String(c[0]));
    const withFp = urls.find((u) => u.includes('260601_130000_Fp'));
    const noFp = urls.find((u) => u.includes('260601_130100_NoFp'));
    expect(withFp).toBeTruthy();
    expect(withFp).toContain('v=1700-2048');
    // A file the backend couldn't stat (no mtime_ms) carries no cache-buster.
    expect(noFp).toBeTruthy();
    expect(noFp).not.toContain('v=');
  });
});
