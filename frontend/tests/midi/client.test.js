import { describe, it, expect, vi } from 'vitest';
import { createMidiClient } from '../../src/renderer/shared/midi/client.js';

/** A MIDIAccess stand-in: Maps of ports plus a statechange listener list. */
function fakeAccess(ports) {
  const listeners = new Map();
  return {
    inputs: new Map(ports.inputs.map((p) => [p.id, p])),
    outputs: new Map(ports.outputs.map((p) => [p.id, p])),
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    fireStateChange() {
      listeners.get('statechange')?.({ port: null });
    },
  };
}

function port(id, name, kind) {
  return { id, name, type: kind, state: 'connected', onmidimessage: null };
}

const XTOUCH_IN = () => port('in1', 'X-TOUCH MINI', 'input');
const XTOUCH_OUT = () => port('out1', 'X-TOUCH MINI', 'output');

function clientWith(accessFactory, overrides = {}) {
  const requestMIDIAccess = vi.fn(async () => accessFactory());
  const client = createMidiClient({
    nav: { requestMIDIAccess },
    log: () => {},
    ...overrides,
  });
  return { client, requestMIDIAccess };
}

describe('midi client', () => {
  it('binds the matched input and forwards its messages', async () => {
    const xtouchIn = XTOUCH_IN();
    const onMessage = vi.fn();
    const { client } = clientWith(
      () =>
        fakeAccess({
          inputs: [xtouchIn],
          outputs: [XTOUCH_OUT()],
        }),
      { onMessage },
    );

    await client.connect();

    expect(client.connected).toBe(true);
    expect(xtouchIn.onmidimessage).toBeTypeOf('function');
    xtouchIn.onmidimessage({ data: new Uint8Array([0xba, 1, 64]), timeStamp: 5 });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toEqual(new Uint8Array([0xba, 1, 64]));
    expect(onMessage.mock.calls[0][1]).toBe(5);
  });

  it('leaves other devices unbound and reports no-device when absent', async () => {
    const other = port('iac1', 'IAC Driver Bus 1', 'input');
    const statuses = [];
    const onStatus = (s) => statuses.push(s);
    const { client } = clientWith(
      () => fakeAccess({ inputs: [other], outputs: [] }),
      { onStatus },
    );

    await client.connect();

    expect(other.onmidimessage).toBeNull();
    expect(client.connected).toBe(false);
    expect(statuses.at(-1)).toBe('no-device');
  });

  it('reattaches via statechange when the device appears later', async () => {
    const access = fakeAccess({ inputs: [], outputs: [] });
    const { client } = clientWith(() => access);

    await client.connect();
    expect(client.connected).toBe(false);

    // Hot-plug: Web MIDI mutates the same access object and fires the event.
    const xtouchIn = XTOUCH_IN();
    access.inputs.set(xtouchIn.id, xtouchIn);
    access.outputs.set('out1', XTOUCH_OUT());
    access.fireStateChange();

    expect(client.connected).toBe(true);
    expect(xtouchIn.onmidimessage).toBeTypeOf('function');
  });

  it('reports denied when the handshake rejects', async () => {
    const statuses = [];
    const nav = {
      requestMIDIAccess: vi.fn(async () => {
        throw new Error('Permission to use Web MIDI API was not granted.');
      }),
    };
    const client = createMidiClient({
      nav,
      onStatus: (s) => statuses.push(s),
      log: () => {},
    });

    await client.connect();

    expect(statuses.at(-1)).toBe('denied');
    expect(client.connected).toBe(false);
  });

  it('reports unsupported without requestMIDIAccess', async () => {
    const statuses = [];
    const client = createMidiClient({
      nav: {},
      onStatus: (s) => statuses.push(s),
      log: () => {},
    });

    await client.connect();

    expect(statuses.at(-1)).toBe('unsupported');
  });

  it('disconnect detaches the handler and removes the statechange listener', async () => {
    const access = fakeAccess({
      inputs: [XTOUCH_IN()],
      outputs: [XTOUCH_OUT()],
    });
    const onMessage = vi.fn();
    const { client } = clientWith(() => access, { onMessage });

    await client.connect();
    expect(client.connected).toBe(true);

    client.disconnect();
    expect(client.connected).toBe(false);

    access.fireStateChange();
    [...access.inputs.values()].forEach((p) => {
      p.onmidimessage?.({ data: [], timeStamp: 0 });
    });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('rescan redoes the handshake when nothing was connected', async () => {
    let hasDevice = false;
    const nav = {
      requestMIDIAccess: vi.fn(async () =>
        fakeAccess(hasDevice
          ? { inputs: [XTOUCH_IN()], outputs: [XTOUCH_OUT()] }
          : { inputs: [], outputs: [] }),
      ),
    };
    const client = createMidiClient({ nav, log: () => {} });

    await client.connect();
    expect(client.connected).toBe(false);

    hasDevice = true; // the user plugged the device back in
    const reconnected = await client.rescan();

    expect(reconnected).toBe(true);
    expect(client.connected).toBe(true);
    expect(nav.requestMIDIAccess).toHaveBeenCalledTimes(2);
  });

  it('rescan returns true immediately while already bound', async () => {
    const { client, requestMIDIAccess } = clientWith(() =>
      fakeAccess({ inputs: [XTOUCH_IN()], outputs: [XTOUCH_OUT()] }));

    await client.connect();
    const ok = await client.rescan();

    expect(ok).toBe(true);
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
  });

  it('requests access with SysEx capability enabled', async () => {
    const { client, requestMIDIAccess } = clientWith(() =>
      fakeAccess({ inputs: [XTOUCH_IN()], outputs: [XTOUCH_OUT()] }));

    await client.connect();

    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: true });
  });
});
