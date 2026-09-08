import { describe, it, expect, vi } from 'vitest';

// buildWorkingSetSummary imports workflowSteps → the module catalog → every
// component; ThemeEditor pulls the theme manager (localStorage at import). Mock it.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import { buildWorkingSetSummary } from '../src/renderer/components/workflowBar/workingSetSummary.js';
import { WORKFLOW_STEPS } from '../src/renderer/workspace/flexlayout/workflowSteps.js';
import { t } from '../src/i18n/index.js';

const build = (sets) =>
  buildWorkingSetSummary(t, { steps: WORKFLOW_STEPS, ...sets });

describe('buildWorkingSetSummary', () => {
  it('returns the three sets in order: queue, scan, anchor', () => {
    const lines = build({});
    expect(lines.map((l) => l.key)).toEqual(['queue', 'scan', 'anchor']);
  });

  it('renders empty states when nothing is set', () => {
    const [queue, scan, anchor] = build({
      queue: null,
      scan: null,
      anchor: null,
    });
    expect(queue.empty).toBe(true);
    expect(queue.value).toBe('Ingen kö');
    expect(scan.value).toBe('Ingen skanning');
    expect(anchor.value).toBe('Inget ankare');
  });

  it('queue: "N filer (M klara) — <mapp>" from the basename of the folder', () => {
    const [queue] = build({
      queue: { folder: '/events/cupen', count: 12, done: 5 },
    });
    expect(queue.empty).toBe(false);
    expect(queue.value).toBe('12 filer (5 klara) — cupen');
  });

  it('queue: an empty folder falls back to the "unknown folder" label', () => {
    const [queue] = build({ queue: { folder: null, count: 3, done: 0 } });
    expect(queue.value).toContain('okänd mapp');
  });

  it('scan: folder basename plus recursive/glob/date flags', () => {
    const [, scan] = build({
      scan: {
        roots: ['/a/cup'],
        globs: ['*x*'],
        recursive: true,
        date_from: '2025-01-01',
      },
    });
    expect(scan.value).toContain('cup');
    expect(scan.value).toContain('rekursiv');
    expect(scan.value).toContain('globfilter');
    expect(scan.value).toContain('datumspann');
  });

  it('scan: a glob-only scope shows the glob as the "where"', () => {
    const [, scan] = build({
      scan: { roots: [], globs: ['/p/*.jpg'], recursive: false },
    });
    expect(scan.empty).toBe(false);
    expect(scan.value).toContain('/p/*.jpg');
  });

  it('anchor: shows "satt av <steg>" for a known step, plain folder otherwise', () => {
    const [, , withStep] = build({
      anchor: { roots: ['/e/cupen'], step: 'rename' },
    });
    expect(withStep.value).toContain('cupen');
    expect(withStep.value).toContain('satt av');
    // Uses the module display name for the step.
    expect(withStep.value).toContain(t('modules.rename-nef'));

    const [, , noStep] = build({ anchor: { roots: ['/e/cupen'], step: null } });
    expect(noStep.value).toBe('cupen');
  });
});
