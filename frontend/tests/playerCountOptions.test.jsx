import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  buildCountParams,
  DEFAULT_OPTIONS,
  CountOptions,
} from '../src/renderer/components/PlayerCountModule.jsx';

const INPUT = {
  roots: ['/photos'],
  glob: '',
  preset: 'jpg',
  dateFrom: '',
  dateTo: '',
  recursive: true,
};

describe('buildCountParams', () => {
  it('includes the counting options', () => {
    const params = buildCountParams(
      INPUT,
      { gapMinutes: 45, baseline: 'mean', minImages: 5 },
      false,
      null
    );
    expect(params.gap_minutes).toBe(45);
    expect(params.baseline).toBe('mean');
    expect(params.min_images).toBe(5);
    expect(params.per_match).toBe(false);
  });

  it('falls back to the CLI-parity defaults when options are missing', () => {
    const params = buildCountParams(INPUT, undefined, true);
    expect(params.gap_minutes).toBe(DEFAULT_OPTIONS.gapMinutes);
    expect(params.baseline).toBe(DEFAULT_OPTIONS.baseline);
    expect(params.min_images).toBe(DEFAULT_OPTIONS.minImages);
    expect(params.per_match).toBe(true);
  });

  it('sends null exclusion lists when there is no override (keeps backend defaults)', () => {
    const params = buildCountParams(INPUT, DEFAULT_OPTIONS, false, null);
    expect(params.tranare).toBeNull();
    expect(params.publik).toBeNull();
  });

  it('sends the edited lists as an override when provided', () => {
    const params = buildCountParams(INPUT, DEFAULT_OPTIONS, false, {
      tranare: ['Coach'],
      publik: ['Uncle'],
    });
    expect(params.tranare).toEqual(['Coach']);
    expect(params.publik).toEqual(['Uncle']);
  });
});

describe('CountOptions', () => {
  const baseProps = {
    options: DEFAULT_OPTIONS,
    onOptionsChange: () => {},
    onOptionsPreview: () => {},
    exclusions: { tranare: [], publik: [] },
    grupp: ['Laget', 'FBK'],
    alwaysPublik: ['Klacken'],
    envKeys: [],
    dirty: false,
    savingDefaults: false,
    onAddExcluded: () => {},
    onRemoveExcluded: () => {},
    onSaveDefaults: () => {},
    onReset: () => {},
    busy: false,
  };

  it('renders the three counting controls', () => {
    render(<CountOptions {...baseProps} />);
    expect(screen.getByText(/Matchgap/)).toBeTruthy();
    expect(screen.getByText(/Baslinje/)).toBeTruthy();
    expect(screen.getByText(/Min bilder/)).toBeTruthy();
  });

  it('previews clamped numeric changes on input, commits on blur', () => {
    const onOptionsPreview = vi.fn();
    const onOptionsChange = vi.fn();
    render(
      <CountOptions
        {...baseProps}
        onOptionsPreview={onOptionsPreview}
        onOptionsChange={onOptionsChange}
      />
    );
    const gap = screen.getByTitle(/Minsta lucka mellan matcher/);
    // Typing previews the clamped value (min 1) without re-running the count...
    fireEvent.change(gap, { target: { value: '0' } });
    expect(onOptionsPreview).toHaveBeenCalledWith(expect.objectContaining({ gapMinutes: 1 }));
    expect(onOptionsChange).not.toHaveBeenCalled();
    // ...and blur commits (triggers the recount).
    fireEvent.blur(gap);
    expect(onOptionsChange).toHaveBeenCalled();
  });

  it('shows editable exclusion lists (incl. always-excluded) when expanded', () => {
    render(<CountOptions {...baseProps} />);
    fireEvent.click(screen.getByText(/Uteslutna/));
    expect(screen.getByText('Tränare')).toBeTruthy();
    expect(screen.getByText('Publik')).toBeTruthy();
    // Config-level always lists are editable now, not locked.
    expect(screen.getByText('Gruppbilder')).toBeTruthy();
    expect(screen.getByText('Publik (alltid)')).toBeTruthy();
    // The group markers render as removable chips (each has a "Ta bort" button).
    expect(screen.getByRole('button', { name: 'Ta bort FBK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ta bort Klacken' })).toBeTruthy();
  });

  it('adds a custom always-group marker via the Gruppbilder editor', () => {
    const onAddExcluded = vi.fn();
    render(<CountOptions {...baseProps} onAddExcluded={onAddExcluded} />);
    fireEvent.click(screen.getByText(/Uteslutna/));
    const input = screen.getByLabelText('Lägg till gruppbilder');
    fireEvent.change(input, { target: { value: 'Forward' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAddExcluded).toHaveBeenCalledWith('grupp', 'Forward');
  });

  it('disables "Spara som standard" until there are unsaved edits', () => {
    const { rerender } = render(<CountOptions {...baseProps} />);
    fireEvent.click(screen.getByText(/Uteslutna/));
    expect(screen.getByText('Spara som standard').disabled).toBe(true);
    rerender(<CountOptions {...baseProps} dirty />);
    expect(screen.getByText('Spara som standard').disabled).toBe(false);
  });

  it('warns when a RAKNA_* env var shadows the config', () => {
    render(<CountOptions {...baseProps} envKeys={['RAKNA_TRANARE']} />);
    fireEvent.click(screen.getByText(/Uteslutna/));
    expect(screen.getByText(/RAKNA_TRANARE/)).toBeTruthy();
  });
});
