/**
 * Parser for the X-TOUCH MINI's measured wire format.
 *
 * Every rule below is a measurement, not a manual claim — the tables come
 * from the 2026-08-23 hardware pass in docs/dev/midi.md:
 *
 * - The wire channel nibble is 10 ("kanal 11" in Behringer's 1-indexed
 *   wording), so status bytes are 0xBA (CC), 0x9A (note on) and 0x8A
 *   (note off).
 * - Preset layer A and B differ only in numbers, never in channel, so one
 *   table with per-layer offsets classifies both layers.
 * - Anything outside these ranges returns null: a parser that guesses would
 *   silently misroute hardware events.
 */

/** The device transmits on wire channel nibble 0xA ("channel 11", 1-indexed). */
export const WIRE_CHANNEL = 0xa;

const FAMILY_CC = 0xb0;
const FAMILY_NOTE_ON = 0x90;
const FAMILY_NOTE_OFF = 0x80;

/**
 * Classify a Control Change number into control, index and layer.
 * Layer A: encoders turn on CC 1–8, fader CC 9. Layer B: CC 11–18 / CC 10.
 */
function classifyCC(number) {
  if (number >= 1 && number <= 8) {
    return { control: 'encoder-turn', index: number - 1, layer: 'A' };
  }
  if (number === 9) return { control: 'fader', index: 0, layer: 'A' };
  if (number === 10) return { control: 'fader', index: 0, layer: 'B' };
  if (number >= 11 && number <= 18) {
    return { control: 'encoder-turn', index: number - 11, layer: 'B' };
  }
  return null;
}

/**
 * Classify a Note On/Off number. Layer A: encoder presses on notes 0–7,
 * upper button row 8–15, lower button row 16–23. Layer B shifts by 24.
 */
function classifyNote(number) {
  if (number <= 7) return { control: 'encoder-press', index: number, layer: 'A' };
  if (number <= 15) return { control: 'button-upper', index: number - 8, layer: 'A' };
  if (number <= 23) return { control: 'button-lower', index: number - 16, layer: 'A' };
  if (number <= 31) return { control: 'encoder-press', index: number - 24, layer: 'B' };
  if (number <= 39) return { control: 'button-upper', index: number - 32, layer: 'B' };
  if (number <= 47) return { control: 'button-lower', index: number - 40, layer: 'B' };
  return null;
}

/**
 * Parse three raw MIDI bytes from the control surface.
 *
 * @param {Uint8Array|number[]} bytes - [status, data1, data2].
 * @returns {{kind: 'cc'|'note-on'|'note-off', layer: 'A'|'B',
 *            control: string, index: number, value: number}|null}
 *          null for anything the measured map does not cover.
 */
export function parseMidi(bytes) {
  if (!bytes || bytes.length < 3) return null;
  const [status, number, value] = bytes;
  const family = status & 0xf0;
  if ((status & 0x0f) !== WIRE_CHANNEL) return null;

  let kind;
  let control;
  if (family === FAMILY_CC) {
    kind = 'cc';
    control = classifyCC(number);
  } else if (family === FAMILY_NOTE_ON) {
    kind = 'note-on';
    control = classifyNote(number);
  } else if (family === FAMILY_NOTE_OFF) {
    kind = 'note-off';
    control = classifyNote(number);
  } else {
    return null;
  }

  if (!control) return null;
  return { kind, ...control, value };
}
