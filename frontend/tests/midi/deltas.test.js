import { describe, it, expect } from 'vitest';
import { createKnobTracker } from '../../src/renderer/shared/midi/deltas.js';

describe('knob tracker — baseline and deltas (decision A)', () => {
  it('baselines silently on first touch', () => {
    const t = createKnobTracker();
    expect(t.push(64, 0)).toBe(0);
  });

  it('decodes consecutive detents as signed steps', () => {
    const t = createKnobTracker();
    t.push(64, 0);
    expect(t.push(65, 10)).toBe(1);
    expect(t.push(66, 20)).toBe(1);
    expect(t.push(64, 30)).toBe(-2);
  });

  it('decodes a multi-step jump as one delta', () => {
    const t = createKnobTracker();
    t.push(10, 0);
    expect(t.push(25, 10)).toBe(15);
    expect(t.push(5, 20)).toBe(-20);
  });

  it('re-baselines after an idle gap instead of emitting a bogus jump', () => {
    const t = createKnobTracker({ idleMs: 100 });
    t.push(64, 0);
    // The knob was moved (or the app restarted) while time passed.
    expect(t.push(120, 5000)).toBe(0);
    expect(t.push(121, 5100)).toBe(1);
  });

  it('rebaseline() forces the origin for the declared-state loop', () => {
    const t = createKnobTracker();
    t.push(80, 0);
    t.rebaseline(40);
    expect(t.push(41, 10)).toBe(1);
  });
});

describe('knob tracker — rail parking', () => {
  it('emits the step into the rail, then goes silent while parked', () => {
    const t = createKnobTracker({ railMargin: 3 });
    t.push(125, 0);
    expect(t.push(126, 10)).toBe(1);
    expect(t.push(127, 20)).toBe(1); // the rail itself is real movement
    expect(t.push(127, 30)).toBe(0); // further CW: clipped silence
  });

  it('keeps the wind-back home silent until clear of the rail', () => {
    const t = createKnobTracker({ railMargin: 3 });
    t.push(127, 0); // parked at high rail
    // Winding back: within margin, all silent; baseline follows along.
    expect(t.push(126, 10)).toBe(0);
    expect(t.push(124, 20)).toBe(0);
    // Clear of the rail by more than the margin: re-engage here, silently.
    expect(t.push(123, 30)).toBe(0);
    // Normal tracking resumes.
    expect(t.push(122, 40)).toBe(-1);
    expect(t.push(123, 50)).toBe(1);
  });

  it('parks symmetrically at the low rail', () => {
    const t = createKnobTracker({ railMargin: 3 });
    t.push(64, 0);
    expect(t.push(1, 10)).toBe(-63);
    expect(t.push(0, 20)).toBe(-1); // into the rail
    expect(t.push(3, 30)).toBe(0); // still within margin
    expect(t.push(4, 40)).toBe(0); // re-engages here
    expect(t.push(5, 50)).toBe(1);
  });

  it('an idle gap while parked clears the park without emitting', () => {
    const t = createKnobTracker({ idleMs: 100, railMargin: 3 });
    t.push(127, 0); // park at high rail
    expect(t.push(60, 10000)).toBe(0); // idle re-baseline wins over parking
    expect(t.push(61, 10100)).toBe(1);
  });
});
