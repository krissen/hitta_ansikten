import { describe, it, expect } from 'vitest';
import { parseMidi, WIRE_CHANNEL } from '../../src/renderer/shared/midi/map.js';

const STATUS = { cc: 0xb0 | 0xa, noteOn: 0x90 | 0xa, noteOff: 0x80 | 0xa };

describe('midi map — measured wire format (layer A)', () => {
  it.each([
    [1, 'encoder-turn', 0],
    [4, 'encoder-turn', 3],
    [8, 'encoder-turn', 7],
    [9, 'fader', 0],
  ])('classifies CC %i as %s index %i on layer A', (number, control, index) => {
    expect(parseMidi([STATUS.cc, number, 64])).toEqual({
      kind: 'cc',
      control,
      index,
      layer: 'A',
      value: 64,
    });
  });

  it.each([
    [0, 'encoder-press', 0],
    [7, 'encoder-press', 7],
    [8, 'button-upper', 0],
    [15, 'button-upper', 7],
    [16, 'button-lower', 0],
    [23, 'button-lower', 7],
  ])('classifies note %i as %s index %i on layer A', (number, control, index) => {
    const down = parseMidi([STATUS.noteOn, number, 127]);
    const up = parseMidi([STATUS.noteOff, number, 0]);
    expect(down).toMatchObject({ kind: 'note-on', control, index, layer: 'A', value: 127 });
    expect(up).toMatchObject({ kind: 'note-off', control, index, layer: 'A', value: 0 });
  });
});

describe('midi map — measured wire format (layer B)', () => {
  it.each([
    [11, 'encoder-turn', 0],
    [14, 'encoder-turn', 3],
    [18, 'encoder-turn', 7],
    [10, 'fader', 0],
  ])('classifies CC %i as %s index %i on layer B', (number, control, index) => {
    expect(parseMidi([STATUS.cc, number, 10])).toEqual({
      kind: 'cc',
      control,
      index,
      layer: 'B',
      value: 10,
    });
  });

  it.each([
    [24, 'encoder-press', 0],
    [31, 'encoder-press', 7],
    [32, 'button-upper', 0],
    [39, 'button-upper', 7],
    [40, 'button-lower', 0],
    [47, 'button-lower', 7],
  ])('classifies note %i as %s index %i on layer B', (number, control, index) => {
    const down = parseMidi([STATUS.noteOn, number, 127]);
    const up = parseMidi([STATUS.noteOff, number, 0]);
    expect(down).toMatchObject({ kind: 'note-on', control, index, layer: 'B' });
    expect(up).toMatchObject({ kind: 'note-off', control, index, layer: 'B' });
  });
});

describe('midi map — rejects everything the measurement does not cover', () => {
  it.each([
    ['wrong channel nibble (0xBB = "channel 12")', [0xbb, 1, 64]],
    ['wrong family (program change)', [0xc0 | WIRE_CHANNEL, 1, 0]],
    ['wrong family (pitch bend)', [0xe0 | WIRE_CHANNEL, 0, 8]],
    ['CC beyond the layer-B encoder block', [STATUS.cc, 19, 64]],
    ['note above the lower-button block', [STATUS.noteOn, 48, 127]],
    ['too few bytes', [STATUS.cc, 1]],
    ['no bytes at all', []],
  ])('returns null for %s', (_name, bytes) => {
    expect(parseMidi(bytes)).toBeNull();
  });
});
