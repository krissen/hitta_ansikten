/**
 * Web MIDI client for the X-TOUCH MINI control surface.
 *
 * Always-on by design: it connects when the workspace boots if the device is
 * present and stays quiet otherwise. Hot-plug recovery is driven by the
 * MIDIAccess statechange event, which fires when a device appears or leaves;
 * rescan() is the guaranteed manual path for the cases where Chromium's event
 * fails to fire — the same gap that makes MIDI2LR users click "rescan".
 *
 * Chromium grants requestMIDIAccess only when both the 'midi' and 'midiSysex'
 * session permissions are allowlisted, even though this module requests
 * access without sending SysEx today (verified 2026-08-23). Measured wire
 * facts live in docs/dev/midi.md.
 */

const DEVICE_NAME = 'X-TOUCH MINI';

/**
 * Create the workspace MIDI client.
 *
 * @param {object} [options]
 * @param {string} [options.name] - device name to match ports against.
 * @param {Navigator} [options.nav] - injectable navigator for tests.
 * @param {(data: Uint8Array, timeStamp: number, event: MIDIMessageEvent) => void} [options.onMessage]
 * @param {(status: string, detail?: string) => void} [options.onStatus]
 *        statuses: 'connected' | 'no-device' | 'denied' | 'unsupported' |
 *        'disconnected'. Repeats are suppressed.
 * @param {(msg: string) => void} [options.log]
 */
export function createMidiClient({
  name = DEVICE_NAME,
  nav = globalThis.navigator,
  onMessage = () => {},
  onStatus = () => {},
  log = () => {},
} = {}) {
  let access = null;
  let input = null;
  let output = null;
  let inFlight = null;
  let lastStatus = '';
  let handleMessage = onMessage;
  const statusListeners = new Set();

  function setStatus(status, detail) {
    if (status === lastStatus) return;
    lastStatus = status;
    onStatus(status, detail);
    for (const fn of statusListeners) fn(status, detail);
    log(`status: ${status}${detail ? ` (${detail})` : ''}`);
  }

  /**
   * Replace the message consumer after construction — the input layer
   * attaches itself this way once it exists. Pass nothing to fall back to
   * the constructor's callback.
   */
  function setOnMessage(fn) {
    handleMessage = typeof fn === 'function' ? fn : onMessage;
  }

  /** Subscribe to connection-status transitions; returns an unsubscribe. */
  function onStatusChange(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  }

  function detach() {
    if (input) input.onmidimessage = null;
    input = null;
    output = null;
  }

  /**
   * Re-evaluate which ports to bind on the current access object.
   * @returns {boolean} true when our input is bound.
   */
  function attachPorts() {
    if (!access) return false;
    const inputs = [...access.inputs.values()].filter((p) => p.name === name);
    const outputs = [...access.outputs.values()].filter((p) => p.name === name);
    const nextInput = inputs[0] || null;
    const nextOutput = outputs[0] || null;
    if (nextInput && nextInput === input && nextOutput === output) return true;
    detach();
    input = nextInput;
    output = nextOutput;
    if (!input) {
      setStatus('no-device', `waiting for "${name}"`);
      return false;
    }
    input.onmidimessage = (event) =>
      handleMessage(event.data, event.timeStamp, event);
    log(`bound "${name}": ${inputs.length} in / ${outputs.length} out`);
    setStatus('connected');
    return true;
  }

  function onStateChange() {
    attachPorts();
  }

  /**
   * Run the requestMIDIAccess handshake. Safe to call repeatedly; concurrent
   * calls share one handshake and a bound client short-circuits to a re-scan
   * of its existing access object.
   */
  async function connect() {
    if (access) {
      attachPorts();
      return;
    }
    if (inFlight) return inFlight;
    if (!nav.requestMIDIAccess) {
      setStatus('unsupported', 'navigator.requestMIDIAccess saknas');
      return;
    }
    inFlight = (async () => {
      try {
        log('requesting MIDI access…');
        access = await nav.requestMIDIAccess({ sysex: true });
      } catch (err) {
        setStatus('denied', err?.message || String(err));
        inFlight = null;
        return;
      }
      access.addEventListener('statechange', onStateChange);
      attachPorts();
      inFlight = null;
    })();
    await inFlight;
  }

  /**
   * Guaranteed manual recovery: re-evaluate the current access object, and
   * if that yields nothing (or there never was one), redo the whole
   * handshake once.
   */
  async function rescan() {
    if (access && attachPorts()) return true;
    log('rescanning…');
    if (access) {
      access.removeEventListener('statechange', onStateChange);
      detach();
      access = null;
    }
    await connect();
    return Boolean(input);
  }

  /** Drop every binding and listener; a later connect() starts fresh. */
  function disconnect() {
    if (access) access.removeEventListener('statechange', onStateChange);
    detach();
    access = null;
    inFlight = null;
    setStatus('disconnected');
  }

  /** Send raw bytes to the device output; a no-op while unbound. */
  function send(bytes) {
    output?.send(bytes);
  }

  return {
    connect,
    rescan,
    disconnect,
    send,
    setOnMessage,
    onStatusChange,
    get connected() {
      return Boolean(input);
    },
    get deviceName() {
      return name;
    },
  };
}

let workspaceClient = null;

/**
 * The one client the workspace shares across surfaces (boot connection in
 * flexlayout/index.jsx, the LogViewer status button, the input layer).
 * Options only take effect on first call.
 */
export function getWorkspaceMidi(options = {}) {
  if (!workspaceClient) workspaceClient = createMidiClient(options);
  return workspaceClient;
}
