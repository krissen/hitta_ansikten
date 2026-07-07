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
