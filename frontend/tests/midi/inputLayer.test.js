import { describe, it, expect, vi } from 'vitest';
import { createInputLayer } from '../../src/renderer/shared/midi/inputLayer.js';
import { createMidiClient } from '../../src/renderer/shared/midi/client.js';

/** A document stand-in whose focus can be flipped mid-test. */
function makeDocument(focused) {
  return {
    _focused: focused,
    hasFocus() {
      return this._focused;
    },
  };
}

/**
 * Wire a real client to an input layer over one fake port, so tests drive
 * bytes exactly the way Web MIDI would deliver them.
 */
async function harness(documentRef) {
  const port = {
    id: 'in1',
    name: 'X-TOUCH MINI',
    state: 'connected',
    onmidimessage: null,
  };
  const access = {
    inputs: new Map([[port.id, port]]),
    outputs: new Map(),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const client = createMidiClient({
    nav: { requestMIDIAccess: async () => access },
    log: () => {},
  });
  const events = [];
  const log = vi.fn();
  createInputLayer({ client, documentRef, onEvent: (e) => events.push(e), log });
  await client.connect();

  return {
    events,
    log,
    doc: documentRef,
    /** Deliver raw bytes the way MIDIMessageEvent would. */
    feed(bytes, timeStamp = 100) {
      port.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp });
    },
  };
}

describe('input layer — focus gate (E6)', () => {
  it('passes messages through while the workspace has focus', async () => {
    const h = await harness(makeDocument(true));

    h.feed([0xba, 1, 64]);
    h.feed([0xba, 1, 65]);

    expect(h.events).toEqual([
      { type: 'knob', layer: 'A', index: 0, steps: 1 },
    ]);
    expect(h.log).not.toHaveBeenCalled();
  });

  it('drops messages without focus and logs the streak once', async () => {
    const h = await harness(makeDocument(false));

    for (let i = 0; i < 20; i += 1) h.feed([0x9a, 8, 127], i);

    expect(h.events).toEqual([]);
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls[0][0]).toContain('focus');
  });

  it('un-gates and logs when focus returns', async () => {
    const h = await harness(makeDocument(false));

    h.feed([0x9a, 8, 127]); // dropped
    h.doc._focused = true;
    h.feed([0x9a, 8, 127]); // delivered

    expect(h.events).toHaveLength(1);
    expect(h.log).toHaveBeenCalledTimes(2);
    expect(h.log.mock.calls[1][0]).toContain('regained');
  });
});

describe('input layer — routing', () => {
  it('routes encoder turns through per-knob delta trackers', async () => {
    const h = await harness(makeDocument(true));

    h.feed([0xba, 11, 40], 100); // layer B encoder 1: baseline
    h.feed([0xba, 12, 41], 200); // another knob: its own baseline
    h.feed([0xba, 11, 42], 300); // +2

    expect(h.events).toEqual([
      { type: 'knob', layer: 'B', index: 0, steps: 2 },
    ]);
  });

  it('routes button press and release with phase', async () => {
    const h = await harness(makeDocument(true));

    h.feed([0x9a, 10, 127]);
    h.feed([0x8a, 10, 0]);

    expect(h.events).toEqual([
      { type: 'button', phase: 'press', layer: 'A', control: 'button-upper', index: 2, value: 127 },
      { type: 'button', phase: 'release', layer: 'A', control: 'button-upper', index: 2, value: 0 },
    ]);
  });

  it('routes the fader as a raw value stream', async () => {
    const h = await harness(makeDocument(true));

    h.feed([0xba, 9, 0]);
    h.feed([0xba, 9, 127]);

    expect(h.events).toEqual([
      { type: 'fader', layer: 'A', control: 'fader', index: 0, value: 0 },
      { type: 'fader', layer: 'A', control: 'fader', index: 0, value: 127 },
    ]);
  });

  it('ignores bytes outside the measured map', async () => {
    const h = await harness(makeDocument(true));

    h.feed([0xbb, 1, 64]); // "channel 12"
    h.feed([0x9a, 48, 127]); // note above the lower-button block

    expect(h.events).toEqual([]);
  });
});
