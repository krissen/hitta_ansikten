import { describe, it, expect } from 'vitest';
import { queueReducer, insertItems, initialQueueState } from '../src/renderer/components/fileQueue/queueReducer.js';

// Direct unit coverage for the pure queue reducer. The full-mount fence
// (fileQueueModule.test.jsx) exercises these transitions through the component;
// these pin the state math — especially the currentIndex adjustments that the
// fence does not drive.

const item = (id, over = {}) => ({
  id,
  filePath: `/p/${id}.NEF`,
  fileName: `${id}.NEF`,
  status: 'pending',
  isAlreadyProcessed: false,
  ...over,
});

const state = (queue, currentIndex = -1) => ({ queue, currentIndex });

describe('insertItems', () => {
  it('appends by default and dedupes by filePath', () => {
    const q = [item('a')];
    const out = insertItems(q, [item('a'), item('b')], 'end');
    expect(out.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('prepends for position start', () => {
    const out = insertItems([item('a')], [item('b')], 'start');
    expect(out.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('natural-sorts for position alphabetical', () => {
    const out = insertItems(
      [item('IMG_10', { fileName: 'IMG_10.NEF' })],
      [item('IMG_2', { fileName: 'IMG_2.NEF' })],
      'alphabetical',
    );
    expect(out.map(i => i.fileName)).toEqual(['IMG_2.NEF', 'IMG_10.NEF']);
  });
});

describe('queueReducer', () => {
  it('restore replaces the queue and resets currentIndex', () => {
    const next = queueReducer(state([item('x')], 3), { type: 'restore', queue: [item('a')] });
    expect(next).toEqual({ queue: [item('a')], currentIndex: -1 });
  });

  it('add inserts deduped items', () => {
    const next = queueReducer(state([item('a')]), { type: 'add', items: [item('b')], position: 'end' });
    expect(next.queue.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('sort natural-sorts', () => {
    const next = queueReducer(
      state([item('b', { fileName: 'b.NEF' }), item('a', { fileName: 'a.NEF' })]),
      { type: 'sort' },
    );
    expect(next.queue.map(i => i.fileName)).toEqual(['a.NEF', 'b.NEF']);
  });

  describe('removeById currentIndex adjustment', () => {
    const q = [item('a'), item('b'), item('c')];
    it('decrements index when removing before the active item', () => {
      const next = queueReducer(state(q, 2), { type: 'removeById', id: 'a' });
      expect(next.queue.map(i => i.id)).toEqual(['b', 'c']);
      expect(next.currentIndex).toBe(1);
    });
    it('clears index when removing the active item', () => {
      const next = queueReducer(state(q, 1), { type: 'removeById', id: 'b' });
      expect(next.currentIndex).toBe(-1);
    });
    it('leaves index when removing after the active item', () => {
      const next = queueReducer(state(q, 0), { type: 'removeById', id: 'c' });
      expect(next.currentIndex).toBe(0);
    });
  });

  it('removePaths drops matching paths, leaves index', () => {
    const next = queueReducer(
      state([item('a'), item('b')], 1),
      { type: 'removePaths', paths: new Set(['/p/a.NEF']) },
    );
    expect(next.queue.map(i => i.id)).toEqual(['b']);
    expect(next.currentIndex).toBe(1);
  });

  it('clear empties and resets index', () => {
    expect(queueReducer(state([item('a')], 0), { type: 'clear' }))
      .toEqual({ queue: [], currentIndex: -1 });
  });

  it('clearDone drops completed and already-processed (fix-mode off)', () => {
    const q = [
      item('done', { status: 'completed' }),
      item('proc', { isAlreadyProcessed: true }),
      item('pending'),
    ];
    const next = queueReducer(state(q, 2), { type: 'clearDone', fixMode: false, visibleIds: null });
    expect(next.queue.map(i => i.id)).toEqual(['pending']);
    expect(next.currentIndex).toBe(-1);
  });

  it('clearDone keeps already-processed when fix-mode on', () => {
    const q = [item('done', { status: 'completed' }), item('proc', { isAlreadyProcessed: true })];
    const next = queueReducer(state(q), { type: 'clearDone', fixMode: true, visibleIds: null });
    expect(next.queue.map(i => i.id)).toEqual(['proc']);
  });

  it('clearDone only clears visible done items when a filter is active', () => {
    const q = [item('a', { status: 'completed' }), item('b', { status: 'completed' })];
    const next = queueReducer(state(q), {
      type: 'clearDone', fixMode: false, visibleIds: new Set(['a']),
    });
    expect(next.queue.map(i => i.id)).toEqual(['b']);
  });

  it('clearSelected drops selected ids and resets index', () => {
    const next = queueReducer(
      state([item('a'), item('b')], 1),
      { type: 'clearSelected', selectedIds: new Set(['a']) },
    );
    expect(next.queue.map(i => i.id)).toEqual(['b']);
    expect(next.currentIndex).toBe(-1);
  });

  it('setActive marks the index active and demotes the old active', () => {
    const q = [item('a', { status: 'active' }), item('b')];
    const next = queueReducer(state(q, 0), { type: 'setActive', index: 1 });
    expect(next.queue[0].status).toBe('pending');
    expect(next.queue[1].status).toBe('active');
    expect(next.currentIndex).toBe(1);
  });

  it('clearProcessedFlag un-marks isAlreadyProcessed at an index', () => {
    const q = [item('a', { isAlreadyProcessed: true })];
    const next = queueReducer(state(q), { type: 'clearProcessedFlag', index: 0 });
    expect(next.queue[0].isAlreadyProcessed).toBe(false);
  });

  it('setReviewed stamps status and reviewedFaces by path', () => {
    const next = queueReducer(
      state([item('a')]),
      { type: 'setReviewed', path: '/p/a.NEF', status: 'completed', reviewedFaces: [{ n: 1 }] },
    );
    expect(next.queue[0]).toMatchObject({ status: 'completed', reviewedFaces: [{ n: 1 }] });
  });

  it('markProcessed sets isAlreadyProcessed once', () => {
    const next = queueReducer(state([item('a')]), { type: 'markProcessed', path: '/p/a.NEF' });
    expect(next.queue[0].isAlreadyProcessed).toBe(true);
  });

  it('markMissing marks the file missing', () => {
    const next = queueReducer(state([item('a')]), { type: 'markMissing', path: '/p/a.NEF' });
    expect(next.queue[0]).toMatchObject({ status: 'missing', error: 'File not found' });
  });

  it('markProcessedByNames marks by fileName and no-ops when nothing changes', () => {
    const s = state([item('a'), item('b', { isAlreadyProcessed: true })]);
    const next = queueReducer(s, { type: 'markProcessedByNames', names: new Set(['a.NEF']) });
    expect(next.queue[0].isAlreadyProcessed).toBe(true);
    const same = queueReducer(s, { type: 'markProcessedByNames', names: new Set(['b.NEF']) });
    expect(same).toBe(s); // b already processed -> identity, no re-render
  });

  it('applyRename updates filePath and fileName', () => {
    const next = queueReducer(
      state([item('a')]),
      { type: 'applyRename', renamedMap: { '/p/a.NEF': '/p/a_Alice.NEF' } },
    );
    expect(next.queue[0]).toMatchObject({ filePath: '/p/a_Alice.NEF', fileName: 'a_Alice.NEF' });
  });

  it('insertAt re-inserts at an index, and is a no-op if already present', () => {
    const next = queueReducer(state([item('a'), item('c')]), { type: 'insertAt', item: item('b'), index: 1 });
    expect(next.queue.map(i => i.id)).toEqual(['a', 'b', 'c']);
    const same = queueReducer(next, { type: 'insertAt', item: item('b'), index: 0 });
    expect(same).toBe(next);
  });

  it('setIndex sets currentIndex and no-ops when unchanged', () => {
    const s = state([item('a')], 0);
    expect(queueReducer(s, { type: 'setIndex', index: 2 }).currentIndex).toBe(2);
    expect(queueReducer(s, { type: 'setIndex', index: 0 })).toBe(s);
  });

  it('ignores unknown actions', () => {
    const s = state([item('a')], 0);
    expect(queueReducer(s, { type: 'nope' })).toBe(s);
  });

  it('initialQueueState is empty', () => {
    expect(initialQueueState).toEqual({ queue: [], currentIndex: -1 });
  });
});
