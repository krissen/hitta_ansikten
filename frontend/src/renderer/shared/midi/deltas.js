/**
 * Delta decoding for the X-TOUCH MINI's absolute encoders.
 *
 * The wire format is absolute (0–127, clipped at the ends — measured in
 * docs/dev/midi.md E3), but the app owns what a position means: the tracker
 * baselines on first touch and after an idle gap, then decodes every
 * subsequent value as a signed step count against that baseline. Parking at
 * a rail disengages the knob until it moves clear of the rail, so winding
 * back home is silent instead of dragging the parameter backwards — this is
 * decision "A: absolute knobs" from the 2026-08-23 phase-6 ruling.
 *
 * Pure state machine: time comes in as an argument, so tests drive the clock.
 */

/** Default idle gap after which a knob re-baselines instead of emitting. */
export const DEFAULT_IDLE_MS = 5000;

/** Distance from a rail (in steps) before a parked knob re-engages. */
export const DEFAULT_RAIL_MARGIN = 3;

const RAIL_LOW = 0;
const RAIL_HIGH = 127;

/**
 * Create one knob tracker.
 *
 * @param {object} [options]
 * @param {number} [options.idleMs] - silent gap that forces a re-baseline.
 * @param {number} [options.railMargin] - steps away from a rail needed to
 *        re-engage a parked knob.
 * @returns {{push(value: number, now?: number): number,
 *            rebaseline(value?: number): void}}
 *          push returns the signed step delta for the movement, or 0 when
 *          the message only baselined/parked/recovered.
 */
export function createKnobTracker({ idleMs = DEFAULT_IDLE_MS, railMargin = DEFAULT_RAIL_MARGIN } = {}) {
  let baseline = null;
  let lastAt = null;
  let parkedAt = null; // 0 | 127 | null while disengaged

  function push(value, now = 0) {
    const idle = lastAt !== null && now - lastAt > idleMs;
    lastAt = now;

    // First touch, and any return from an idle gap: the current physical
    // position becomes the origin, silently. A first touch that lands ON a
    // rail parks immediately — there is nowhere to move in that direction.
    if (baseline === null || idle) {
      baseline = value;
      parkedAt =
        value === RAIL_LOW || value === RAIL_HIGH ? value : null;
      return 0;
    }

    // Parked at a rail: track the wind-back silently until the value is
    // clear of the rail by more than the margin, then re-engage there.
    if (parkedAt !== null) {
      baseline = value;
      if (Math.abs(value - parkedAt) > railMargin) parkedAt = null;
      return 0;
    }

    const steps = value - baseline;
    baseline = value;
    if (value === RAIL_LOW || value === RAIL_HIGH) parkedAt = value;
    return steps;
  }

  /**
   * Force the origin — the hook for the declared-state loop, where the app
   * announces what the knob should mean from now on.
   */
  function rebaseline(value) {
    baseline = value;
    parkedAt = null;
  }

  return { push, rebaseline };
}
