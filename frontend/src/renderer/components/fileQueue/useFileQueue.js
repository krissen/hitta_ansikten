/**
 * useFileQueue - owns the queue working set (queue + currentIndex) as a reducer.
 *
 * Wraps queueReducer with useReducer, keeps a synced queueRef for callbacks that
 * must read the latest queue without re-subscribing, and exposes a set of bound
 * action dispatchers so callers never touch dispatch/action shapes directly.
 *
 * The queue-status emit effect and the localStorage restore/persist effects stay
 * in the shell: they bridge state owned by sibling hooks (preprocessing status,
 * the rename preview toggle, auto-advance / fix-mode), so they cannot live here
 * without re-introducing that coupling.
 */

import { useReducer, useRef, useMemo } from 'react';
import { queueReducer, initialQueueState } from './queueReducer.js';

export function useFileQueue() {
  const [{ queue, currentIndex }, dispatch] = useReducer(queueReducer, initialQueueState);

  // Keep the current queue in a ref for callbacks (synced every render).
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // Bound action dispatchers. Stable across renders (dispatch identity is stable).
  const actions = useMemo(() => ({
    restore: (nextQueue) => dispatch({ type: 'restore', queue: nextQueue }),
    add: (items, position) => dispatch({ type: 'add', items, position }),
    sort: () => dispatch({ type: 'sort' }),
    removeById: (id) => dispatch({ type: 'removeById', id }),
    removePaths: (paths) => dispatch({ type: 'removePaths', paths }),
    clear: () => dispatch({ type: 'clear' }),
    clearDone: (fixMode, visibleIds) => dispatch({ type: 'clearDone', fixMode, visibleIds }),
    clearSelected: (selectedIds) => dispatch({ type: 'clearSelected', selectedIds }),
    setActive: (index) => dispatch({ type: 'setActive', index }),
    clearProcessedFlag: (index) => dispatch({ type: 'clearProcessedFlag', index }),
    setReviewed: (path, status, reviewedFaces) =>
      dispatch({ type: 'setReviewed', path, status, reviewedFaces }),
    markProcessed: (path) => dispatch({ type: 'markProcessed', path }),
    markMissing: (path) => dispatch({ type: 'markMissing', path }),
    markProcessedByNames: (names) => dispatch({ type: 'markProcessedByNames', names }),
    applyRename: (renamedMap) => dispatch({ type: 'applyRename', renamedMap }),
    insertAt: (item, index) => dispatch({ type: 'insertAt', item, index }),
    setIndex: (index) => dispatch({ type: 'setIndex', index }),
  }), []);

  return { queue, currentIndex, queueRef, actions };
}
