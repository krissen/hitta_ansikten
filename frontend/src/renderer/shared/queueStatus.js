// Shared "queue status" — a passive, current-value-on-mount snapshot of the file
// queue (which folder it holds, how many files, how many done), published by
// FileQueueModule so a surface OUTSIDE the queue (the WorkflowBar chip dropdown)
// can answer "which file queue belongs to which flow?" on screen (Nielsen N1/N6)
// without reaching into the queue's internals.
//
// Why a module singleton and not the `queue-status` moduleAPI event: that event
// is fire-and-forget, so a subscriber mounting AFTER the queue last published
// (the chip mounts once, the queue re-publishes on every change) would see
// nothing until the next change. This store keeps the latest snapshot so a late
// subscriber reads the current value immediately, then stays live via subscribe.
//
// No sessionStorage: the file queue already persists itself to localStorage and
// re-publishes here on mount, so persisting the snapshot too would only risk
// showing a stale count before the queue has re-derived it. The store is a pure
// in-memory mirror of the live queue.

let current = null;
const subscribers = new Set();

/**
 * The latest queue snapshot, or null if the queue hasn't published yet.
 * Shape: { folder: string|null, count: number, done: number,
 *          remaining: number, current: number, preprocessed: number }.
 */
export function getQueueStatus() {
  return current;
}

/** Publish the current queue snapshot. Pass null to signal "no queue". */
export function setQueueStatus(status) {
  current = status ? { ...status } : null;
  for (const cb of subscribers) {
    try {
      cb(current);
    } catch {
      /* a broken subscriber must not stop the others */
    }
  }
}

/**
 * Subscribe to queue-status changes. Returns an unsubscribe function; the
 * callback receives the current snapshot (or null).
 */
export function subscribeQueueStatus(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
