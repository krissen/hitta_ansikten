// launch-queue.js
// A tiny FIFO hold-until-ready queue for workspace commands the main process
// sends to the renderer. Commands enqueued before the renderer completes the
// workspace-ready handshake are held (not lost) and delivered, in order, when
// markReady() runs. It is a QUEUE, not a single slot: an initial CLI launch and
// a second-instance launch that both arrive before ready are delivered in the
// order they came, rather than the second clobbering the first.
//
// markNotReady() lets the caller re-arm the hold across a renderer reload
// (Cmd+R / crash): the renderer's router is gone until it re-mounts and
// re-signals ready, so commands that arrive mid-reload must queue rather than be
// sent into a router-less page and dropped. The queue survives markNotReady —
// only the ready flag flips — so already-pending commands still deliver on the
// next ready.
//
// Pure (no Electron): delivery is the injected `deliver` callback, so the
// slot→queue and ready-reset semantics are unit-testable without a window.

/**
 * @param {(cmd: any) => void} deliver - called to actually send a command.
 * @returns {{
 *   enqueue: (cmd: any) => void,   // send now if ready, else hold
 *   markReady: () => void,         // flush all held commands in FIFO order
 *   markNotReady: () => void,      // re-arm the hold (queue preserved)
 *   isReady: () => boolean,
 *   pending: () => number,
 * }}
 */
function createLaunchQueue(deliver) {
  let ready = false;
  const queue = [];

  return {
    enqueue(cmd) {
      if (!cmd) return;
      if (!ready) {
        queue.push(cmd);
        return;
      }
      deliver(cmd);
    },
    markReady() {
      ready = true;
      // Splice one at a time so a re-entrant enqueue during delivery is
      // appended after the current batch, not skipped.
      while (queue.length > 0) {
        deliver(queue.shift());
      }
    },
    markNotReady() {
      ready = false;
    },
    isReady() {
      return ready;
    },
    pending() {
      return queue.length;
    },
  };
}

module.exports = { createLaunchQueue };
