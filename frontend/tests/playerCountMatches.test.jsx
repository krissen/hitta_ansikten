import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// MatchSections is a pure presentational component (no backend/context), so it
// can be rendered directly. Guards the per-match parity: each match must show a
// baseline info row AND its excluded buckets (tränare/publik/grupp/under
// tröskeln), not just the player table.
import { MatchSections } from '../src/renderer/components/PlayerCountModule.jsx';

const MATCH = {
  index: 1,
  start: '2026-06-01T12:00:00',
  end: '2026-06-01T12:35:00',
  duration_minutes: 35,
  total_images: 18,
  baseline: 2.8,
  baseline_method: 'median',
  players: [
    { name: 'Anna', count: 5, pct: 27.8, delta_pct: 79, delta_n: 2.2, level: 'high', timestamps: [] },
  ],
  excluded: {
    tranare: [{ name: 'Coach', count: 4, pct: 22.2 }],
    publik: [{ name: 'Klacken', count: 2, pct: 11.1 }],
    grupp: [],
    below_threshold: [{ name: 'Kim', count: 1, pct: 5.6 }],
  },
};

describe('MatchSections per-match parity', () => {
  it('renders the baseline info row and excluded buckets for a match', () => {
    render(<MatchSections matches={[MATCH]} />);

    // Info row: player count + baseline (mirrors CLI print_section).
    expect(screen.getByText('spelare', { exact: false })).toBeTruthy();
    expect(screen.getByText(/Baslinje/)).toBeTruthy();
    expect(screen.getByText('2.8')).toBeTruthy();

    // Excluded buckets rendered (non-empty groups only).
    expect(screen.getByText('Tränare (1)')).toBeTruthy();
    expect(screen.getByText('Publik (1)')).toBeTruthy();
    expect(screen.getByText('Under tröskeln (1)')).toBeTruthy();
    // Empty group (grupp) must not render.
    expect(screen.queryByText(/Gruppbilder/)).toBeNull();
  });

  it('still shows excluded buckets when no players are over threshold', () => {
    const publikOnly = {
      ...MATCH,
      players: [],
      excluded: { tranare: [], publik: [{ name: 'Klacken', count: 3, pct: 100 }], grupp: [], below_threshold: [] },
    };
    render(<MatchSections matches={[publikOnly]} />);
    expect(screen.getByText('Inga spelare över tröskeln.')).toBeTruthy();
    expect(screen.getByText('Publik (1)')).toBeTruthy();
  });
});
