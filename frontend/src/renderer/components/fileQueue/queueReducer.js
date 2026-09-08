/**
 * queueReducer - pure reducer for the FileQueueModule working set.
 *
 * State: { queue: Array, currentIndex: number }. Every queue mutation the module
 * performs is expressed as an action here so the transitions are pure and
 * unit-testable in isolation; the shell and its hooks own only the surrounding
 * side effects (preprocessing enqueue, toasts, viewer clear, backend calls).
 *
 * Actions (enumerated from the module's setQueue/setCurrentIndex call sites):
 *   restore              - replace the queue wholesale (localStorage restore)
 *   add                  - append/prepend/sort-insert deduped items
 *   sort                 - natural-sort the queue
 *   removeById           - drop one item by id, adjusting currentIndex
 *   removePaths          - drop items whose filePath is in a Set
 *   clear                - empty the queue, reset currentIndex
 *   clearDone            - drop completed / already-processed (scoped by filter)
 *   clearSelected        - drop checkbox-selected items
 *   setActive            - mark index active (demote the old active), set index
 *   clearProcessedFlag   - un-mark isAlreadyProcessed at an index (force reprocess)
 *   setReviewed          - stamp a reviewed file's status + reviewedFaces
 *   markProcessed        - mark a file (by path) as already processed
 *   markMissing          - mark a file (by path) missing
 *   markProcessedByNames - mark items whose fileName is in a processed-name Set
 *   applyRename          - update filePath/fileName from a renamed map
 *   insertAt             - re-insert an item at an index (trash rollback / undo)
 *   setIndex             - set currentIndex directly
 */

import { naturalSortCompare } from './queueUtils.js';
import { applyRenameToQueue } from './renameLogic.js';

/** @typedef {{ queue: Array, currentIndex: number }} QueueState */

export const initialQueueState = { queue: [], currentIndex: -1 };

/**
 * Insert new items into a queue, deduped by filePath, honoring position.
 * @param {Array} queue
 * @param {Array} items - already-built queue items
 * @param {string} position - 'start' | 'sorted' | 'alphabetical' | 'end'/default
 * @returns {Array}
 */
export function insertItems(queue, items, position) {
  const existingPaths = new Set(queue.map((item) => item.filePath));
  const uniqueNew = items.filter((item) => !existingPaths.has(item.filePath));
  if (position === 'start') {
    return [...uniqueNew, ...queue];
  }
  if (position === 'sorted' || position === 'alphabetical') {
    return [...queue, ...uniqueNew].sort(naturalSortCompare);
  }
  return [...queue, ...uniqueNew];
}

/**
 * @param {QueueState} state
 * @param {object} action
 * @returns {QueueState}
 */
export function queueReducer(state, action) {
  switch (action.type) {
    case 'restore':
      return { queue: action.queue, currentIndex: -1 };

    case 'add':
      return {
        ...state,
        queue: insertItems(state.queue, action.items, action.position),
      };

    case 'sort':
      return { ...state, queue: [...state.queue].sort(naturalSortCompare) };

    case 'removeById': {
      const removedIndex = state.queue.findIndex(
        (item) => item.id === action.id,
      );
      const queue = state.queue.filter((item) => item.id !== action.id);
      let currentIndex = state.currentIndex;
      if (removedIndex < state.currentIndex)
        currentIndex = state.currentIndex - 1;
      else if (removedIndex === state.currentIndex) currentIndex = -1;
      return { queue, currentIndex };
    }

    case 'removePaths':
      return {
        ...state,
        queue: state.queue.filter((item) => !action.paths.has(item.filePath)),
      };

    case 'clear':
      return { queue: [], currentIndex: -1 };

    case 'clearDone': {
      const { fixMode, visibleIds } = action;
      const isDone = (item) => {
        if (item.status === 'completed') return true;
        if (!fixMode && item.isAlreadyProcessed) return true;
        return false;
      };
      const queue = state.queue.filter((item) => {
        if (!isDone(item)) return true;
        // When a filter is active, only clear visible done items.
        if (visibleIds && !visibleIds.has(item.id)) return true;
        return false;
      });
      return { queue, currentIndex: -1 };
    }

    case 'clearSelected':
      return {
        queue: state.queue.filter((item) => !action.selectedIds.has(item.id)),
        currentIndex: -1,
      };

    case 'setActive':
      return {
        queue: state.queue.map((q, i) => ({
          ...q,
          status:
            i === action.index
              ? 'active'
              : q.status === 'active'
                ? 'pending'
                : q.status,
        })),
        currentIndex: action.index,
      };

    case 'clearProcessedFlag':
      return {
        ...state,
        queue: state.queue.map((q, i) =>
          i === action.index ? { ...q, isAlreadyProcessed: false } : q,
        ),
      };

    case 'setReviewed':
      return {
        ...state,
        queue: state.queue.map((item) =>
          item.filePath === action.path
            ? {
                ...item,
                status: action.status,
                reviewedFaces: action.reviewedFaces || [],
              }
            : item,
        ),
      };

    case 'markProcessed':
      return {
        ...state,
        queue: state.queue.map((item) =>
          item.filePath === action.path && !item.isAlreadyProcessed
            ? { ...item, isAlreadyProcessed: true }
            : item,
        ),
      };

    case 'markMissing':
      return {
        ...state,
        queue: state.queue.map((item) =>
          item.filePath === action.path
            ? { ...item, status: 'missing', error: 'File not found' }
            : item,
        ),
      };

    case 'markProcessedByNames': {
      let hasChanges = false;
      const queue = state.queue.map((item) => {
        if (action.names.has(item.fileName) && !item.isAlreadyProcessed) {
          hasChanges = true;
          return { ...item, isAlreadyProcessed: true };
        }
        return item;
      });
      return hasChanges ? { ...state, queue } : state;
    }

    case 'applyRename':
      return {
        ...state,
        queue: applyRenameToQueue(state.queue, action.renamedMap),
      };

    case 'insertAt': {
      if (state.queue.some((item) => item.filePath === action.item.filePath))
        return state;
      const queue = [...state.queue];
      queue.splice(Math.min(action.index, queue.length), 0, action.item);
      return { ...state, queue };
    }

    case 'setIndex':
      return state.currentIndex === action.index
        ? state
        : { ...state, currentIndex: action.index };

    default:
      return state;
  }
}
