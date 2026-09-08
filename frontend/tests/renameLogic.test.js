import { describe, it, expect } from 'vitest';
import {
  basename,
  selectRenamePaths,
  countRenameEligible,
  buildPreviewLookup,
  buildRenamedMap,
  applyRenameToQueue,
  remapPathKeys,
  renameSummaryCounts,
} from '../src/renderer/components/fileQueue/renameLogic.js';

// Pure-logic unit coverage for the face-name rename flow extracted from
// FileQueueModule. These mirror the exact transforms the useNefRename hook uses.

const q = (over) => ({
  id: over.id,
  filePath: over.filePath,
  fileName: over.filePath.split('/').pop(),
  status: over.status || 'pending',
  isAlreadyProcessed: over.isAlreadyProcessed || false,
});

describe('basename', () => {
  it('returns the last path segment', () => {
    expect(basename('/a/b/c.NEF')).toBe('c.NEF');
    expect(basename('bare.NEF')).toBe('bare.NEF');
  });
});

describe('selectRenamePaths', () => {
  const queue = [
    q({ id: '1', filePath: '/p/done.NEF', status: 'completed' }),
    q({ id: '2', filePath: '/p/pending.NEF', status: 'pending' }),
    q({ id: '3', filePath: '/p/proc.NEF', isAlreadyProcessed: true }),
  ];

  it('includes completed and already-processed (fix-mode off), excludes pending', () => {
    const paths = selectRenamePaths(queue, {
      fixMode: false,
      dirtyPaths: new Set(),
    });
    expect(paths).toEqual(['/p/done.NEF', '/p/proc.NEF']);
  });

  it('excludes already-processed when fix-mode is on', () => {
    const paths = selectRenamePaths(queue, {
      fixMode: true,
      dirtyPaths: new Set(),
    });
    expect(paths).toEqual(['/p/done.NEF']);
  });

  it('holds out dirty paths', () => {
    const paths = selectRenamePaths(queue, {
      fixMode: false,
      dirtyPaths: new Set(['/p/done.NEF']),
    });
    expect(paths).toEqual(['/p/proc.NEF']);
  });

  it('an explicit selection wins over the visible filter', () => {
    const paths = selectRenamePaths(queue, {
      fixMode: false,
      dirtyPaths: new Set(),
      selectedIds: new Set(['3']),
      visibleIds: new Set(['1']),
    });
    expect(paths).toEqual(['/p/proc.NEF']);
  });

  it('a visible filter narrows when there is no selection', () => {
    const paths = selectRenamePaths(queue, {
      fixMode: false,
      dirtyPaths: new Set(),
      visibleIds: new Set(['1']),
    });
    expect(paths).toEqual(['/p/done.NEF']);
  });

  it('countRenameEligible matches the path count', () => {
    expect(
      countRenameEligible(queue, { fixMode: false, dirtyPaths: new Set() }),
    ).toBe(2);
  });
});

describe('buildPreviewLookup', () => {
  it('keys by original_path with defaulted persons/sidecars', () => {
    const lookup = buildPreviewLookup([
      {
        original_path: '/p/a.NEF',
        new_name: 'a_Alice.NEF',
        status: 'ok',
        persons: ['Alice'],
      },
      { original_path: '/p/b.NEF', new_name: 'b.NEF', status: 'skip' },
    ]);
    expect(lookup['/p/a.NEF']).toEqual({
      newName: 'a_Alice.NEF',
      status: 'ok',
      persons: ['Alice'],
      sidecars: [],
    });
    expect(lookup['/p/b.NEF']).toEqual({
      newName: 'b.NEF',
      status: 'skip',
      persons: [],
      sidecars: [],
    });
  });

  it('tolerates undefined items', () => {
    expect(buildPreviewLookup(undefined)).toEqual({});
  });
});

describe('buildRenamedMap + applyRenameToQueue', () => {
  it('maps original->new and updates filePath + fileName', () => {
    const map = buildRenamedMap([
      { original: '/p/a.NEF', new: '/p/a_Alice.NEF' },
    ]);
    expect(map).toEqual({ '/p/a.NEF': '/p/a_Alice.NEF' });

    const queue = [
      q({ id: '1', filePath: '/p/a.NEF' }),
      q({ id: '2', filePath: '/p/b.NEF' }),
    ];
    const next = applyRenameToQueue(queue, map);
    expect(next[0]).toMatchObject({
      filePath: '/p/a_Alice.NEF',
      fileName: 'a_Alice.NEF',
    });
    expect(next[1]).toBe(queue[1]); // unchanged reference
  });
});

describe('remapPathKeys', () => {
  it('re-keys renamed entries and drops the old keys', () => {
    const statusMap = {
      '/p/a.NEF': { status: 'x' },
      '/p/keep.NEF': { status: 'y' },
    };
    const out = remapPathKeys(statusMap, { '/p/a.NEF': '/p/a_Alice.NEF' });
    expect(out['/p/a_Alice.NEF']).toEqual({ status: 'x' });
    expect(out['/p/a.NEF']).toBeUndefined();
    expect(out['/p/keep.NEF']).toEqual({ status: 'y' });
  });
});

describe('renameSummaryCounts', () => {
  it('counts renamed/skipped/errors with safe defaults', () => {
    expect(
      renameSummaryCounts({ renamed: [1, 2], skipped: [3], errors: [] }),
    ).toEqual({ renamedCount: 2, skippedCount: 1, errorCount: 0 });
    expect(renameSummaryCounts({})).toEqual({
      renamedCount: 0,
      skippedCount: 0,
      errorCount: 0,
    });
    expect(renameSummaryCounts(null)).toEqual({
      renamedCount: 0,
      skippedCount: 0,
      errorCount: 0,
    });
  });
});
