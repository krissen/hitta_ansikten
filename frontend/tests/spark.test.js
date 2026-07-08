import { describe, it, expect } from 'vitest';
import { binTimestamps } from '../src/renderer/components/PlayerCountModule.jsx';

const START = '2025-06-01T10:00:00';
const END = '2025-06-01T11:00:00'; // 60 min window

describe('binTimestamps', () => {
  it('returns null when there is nothing to bin', () => {
    expect(binTimestamps([], START, END, 10)).toBeNull();
    expect(binTimestamps(['2025-06-01T10:30:00'], null, END, 10)).toBeNull();
    expect(binTimestamps(null, START, END, 10)).toBeNull();
  });

  it('places a timestamp in the right bin', () => {
    // 30 min into a 60 min window with 10 bins → bin 5 (3-min bins).
    const counts = binTimestamps(['2025-06-01T10:30:00'], START, END, 10);
    expect(counts).toHaveLength(10);
    expect(counts[5]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('clamps start/end edges into the first/last bin', () => {
    const counts = binTimestamps([START, END], START, END, 10);
    expect(counts[0]).toBe(1);   // start → first bin
    expect(counts[9]).toBe(1);   // end → last bin (clamped, not out of range)
  });

  it('ignores unparseable timestamps', () => {
    const counts = binTimestamps(['nope', '2025-06-01T10:00:00'], START, END, 4);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('counts multiple timestamps in the same bin', () => {
    const counts = binTimestamps(
      ['2025-06-01T10:00:30', '2025-06-01T10:01:00', '2025-06-01T10:02:00'],
      START, END, 10,
    );
    expect(counts[0]).toBe(3);
  });
});
