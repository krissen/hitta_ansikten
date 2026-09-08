/**
 * Vitest global setup.
 *
 * jsdom (as of the version pinned here) ships `HTMLDialogElement` but leaves
 * `showModal()` / `show()` / `close()` as stubs that throw "Not implemented",
 * never toggles the `open` property, and never fires `cancel`/`close`. The
 * shared Modal drives a native `<dialog>` through exactly those APIs, so we
 * replace them with a minimal working implementation for component tests. This
 * only runs under jsdom (Vitest); real browsers keep their native behaviour.
 */

import { configure } from '@testing-library/react';

// Testing Library gives waitFor/findBy a 1000 ms budget. The same CPU contention
// that drove the per-test budget up (see testTimeout in vitest.config.js) can
// starve a re-render past one second, which would only move the flake from
// "test timed out" to "unable to find". These helpers poll, so a longer budget
// cannot mask a race: a change that never lands still fails, and one that lands
// in 20 ms still returns in 20 ms.
configure({ asyncUtilTimeout: 10000 });

// jsdom does not implement `window.matchMedia`. CanvasImageView uses it to track
// device-pixel-ratio changes, so any component test that mounts the canvas viewer
// (ImageViewer, CullingModule loupe, …) needs a minimal stub. Real browsers keep
// their native implementation.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

// jsdom's HTMLCanvasElement.getContext throws "Not implemented" (it needs the
// optional `canvas` package). CanvasImageView acquires a 2D context on every
// render — including the no-image render, which clears the canvas so a stale
// frame can't hide its host's overlays — so component tests that mount it need
// a working getContext. Provide a minimal no-op 2D context, one per canvas
// element. Tests that assert on draw calls (e.g. canvasImageView.test.jsx)
// override getContext with their own spies.
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = () => {};
  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__testCtx2d) {
      this.__testCtx2d = {
        canvas: this,
        setTransform: noop,
        clearRect: noop,
        drawImage: noop,
        strokeRect: noop,
        fillRect: noop,
        fillText: noop,
        measureText: () => ({ width: 0 }),
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        stroke: noop,
        fill: noop,
        save: noop,
        restore: noop,
      };
    }
    return this.__testCtx2d;
  };
}

if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype;

  proto.showModal = function showModal() {
    this.open = true;
    this.setAttribute('open', '');
  };

  proto.show = function show() {
    this.open = true;
    this.setAttribute('open', '');
  };

  proto.close = function close(returnValue) {
    this.open = false;
    this.removeAttribute('open');
    if (typeof returnValue === 'string') this.returnValue = returnValue;
    this.dispatchEvent(new Event('close'));
  };
}
