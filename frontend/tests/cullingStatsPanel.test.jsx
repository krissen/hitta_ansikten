import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CullingStats } from '../src/renderer/components/culling/StatsPanel.jsx';
import { t } from '../src/i18n/index.js';

// The stats panel is mostly presentational, but two behaviours are worth
// pinning: the Δ% column carries the explanatory tooltip (header + cells), and
// the header shows a spinner only while a refetch is in flight.

const STATS = {
  baseline: 5,
  players: [
    { name: 'Alice', count: 8, pct: 40, delta_pct: 60, level: 'high' },
    { name: 'Bob', count: 3, pct: 15, delta_pct: -40, level: 'high' },
  ],
  excluded: null,
};

describe('CullingStats', () => {
  it('puts the deltaTitle tooltip on the Δ% header and cells', () => {
    const { container } = render(<CullingStats stats={STATS} width={200} mode="loupe" />);
    const tooltip = t('culling.stats.deltaTitle');
    const titled = [...container.querySelectorAll(`[title="${tooltip}"]`)];
    // One header cell + one per player row.
    expect(titled.length).toBe(1 + STATS.players.length);
  });

  it('shows the spinner only while loading', () => {
    const { container: idle } = render(
      <CullingStats stats={STATS} width={200} mode="loupe" loading={false} />
    );
    expect(idle.querySelector('.loading-spinner')).toBeNull();

    const { container: busy } = render(
      <CullingStats stats={STATS} width={200} mode="loupe" loading={true} />
    );
    expect(busy.querySelector('.loading-spinner')).not.toBeNull();
  });

  it('keeps the fixed-size spinner slot present even when idle (no layout shift)', () => {
    const { container } = render(
      <CullingStats stats={STATS} width={200} mode="loupe" loading={false} />
    );
    // Slot always rendered; only its spinner child toggles.
    expect(container.querySelector('.culling-stats-loading')).not.toBeNull();
  });
});
