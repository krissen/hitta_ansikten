/**
 * The MIDI input layer: one app-wide gate between the device and consumers.
 *
 * Responsibilities (phase-6 plan, etapp 2):
 * - parse raw bytes through the measured wire map,
 * - enforce the software focus gate — E6 proved Web MIDI delivers messages
 *   regardless of window focus, so without this gate a knob turn meant for
 *   another application would also drive Ansikten in the background,
 * - route events: encoder turns go through the delta trackers (decision A),
 *   button presses/releases and the fader pass through as plain events.
 *
 * Consumers arrive via onEvent; the LogViewer rescan button talks to the
 * client directly.
 */

import { parseMidi } from './map.js';
import { createKnobTracker } from './deltas.js';

/**
 * Create the input layer and bind it to the client's message stream.
 *
 * @param {object} options
 * @param {object} options.client - the workspace MIDI client
 *        (shared/midi/client.js); the layer replaces its message consumer.
 * @param {Document} [options.documentRef] - injectable document for tests.
 * @param {(event: object) => void} [options.onEvent]
 * @param {(msg: string) => void} [options.log]
 * @param {object} [options.knobOptions] - forwarded to createKnobTracker.
 */
export function createInputLayer({
  client,
  documentRef = globalThis.document,
  knobOptions = {},
  onEvent = () => {},
  log = () => {},
} = {}) {
  const trackers = new Map();

  function trackerFor(layer, index) {
    const key = `${layer}:${index}`;
    if (!trackers.has(key)) {
      trackers.set(key, createKnobTracker(knobOptions));
    }
    return trackers.get(key);
  }

  let unfocusedStreak = false;

  function handle(data, timeStamp = 0) {
    // Software focus gate. Log the start and end of an unfocused streak,
    // not every dropped message — a fast spin would flood the log.
    const focused = documentRef?.hasFocus?.() ?? true;
    if (!focused) {
      if (!unfocusedStreak) {
        unfocusedStreak = true;
        log('input dropped: the workspace does not have focus');
      }
      return;
    }
    if (unfocusedStreak) {
      unfocusedStreak = false;
      log('focus regained: input un-gated');
    }

    const event = parseMidi(data);
    if (!event) return;

    if (event.control === 'encoder-turn') {
      const steps = trackerFor(event.layer, event.index).push(
        event.value,
        timeStamp,
      );
      if (steps !== 0) {
        onEvent({ type: 'knob', layer: event.layer, index: event.index, steps });
      }
      return;
    }

    if (event.control === 'fader') {
      // Raw value stream for now; semantic mapping lands with the knobs.
      onEvent({
        type: 'fader',
        layer: event.layer,
        control: 'fader',
        index: event.index,
        value: event.value,
      });
      return;
    }

    onEvent({
      type: 'button',
      phase: event.kind === 'note-off' ? 'release' : 'press',
      layer: event.layer,
      control: event.control,
      index: event.index,
      value: event.value,
    });
  }

  client.setOnMessage(handle);

  return { handle };
}
