import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  ProgressBar,
  LoadingOverlay,
} from '../../src/renderer/components/shared/ProgressBar.jsx';

afterEach(cleanup);

describe('ProgressBar', () => {
  it('exposes progressbar semantics with aria-valuenow tracking value', () => {
    const { container } = render(<ProgressBar value={42} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('clamps values below 0 and above 100', () => {
    const { container: low } = render(<ProgressBar value={-20} />);
    expect(
      low.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),
    ).toBe('0');

    const { container: high } = render(<ProgressBar value={180} />);
    expect(
      high.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),
    ).toBe('100');
  });

  it('sets the fill width from the value', () => {
    const { container } = render(<ProgressBar value={75} />);
    expect(container.querySelector('.progress-bar__fill').style.width).toBe(
      '75%',
    );
  });

  it('omits aria-valuenow in indeterminate mode', () => {
    const { container } = render(<ProgressBar />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(
      container
        .querySelector('.progress-bar')
        .classList.contains('progress-bar--indeterminate'),
    ).toBe(true);
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('treats null value as indeterminate', () => {
    const { container } = render(<ProgressBar value={null} />);
    expect(
      container
        .querySelector('.progress-bar')
        .classList.contains('progress-bar--indeterminate'),
    ).toBe(true);
  });

  it('uses an explicit ariaLabel when provided', () => {
    const { container } = render(
      <ProgressBar value={10} ariaLabel="Importerar" />,
    );
    expect(
      container
        .querySelector('[role="progressbar"]')
        .getAttribute('aria-label'),
    ).toBe('Importerar');
  });

  it('falls back to a string label for the aria-label', () => {
    const { container } = render(<ProgressBar value={10} label="Bearbetar" />);
    expect(
      container
        .querySelector('[role="progressbar"]')
        .getAttribute('aria-label'),
    ).toBe('Bearbetar');
  });

  it('shows a rounded percent when requested', () => {
    const { container } = render(<ProgressBar value={33.6} showPercent />);
    expect(container.querySelector('.progress-bar__percent').textContent).toBe(
      '34%',
    );
  });
});

describe('LoadingOverlay', () => {
  it('renders a polite status region when visible', () => {
    const { container } = render(<LoadingOverlay message="Laddar" />);
    const overlay = container.querySelector('.loading-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute('role')).toBe('status');
    expect(overlay.getAttribute('aria-live')).toBe('polite');
    expect(overlay.textContent).toContain('Laddar');
  });

  it('renders nothing when not visible', () => {
    const { container } = render(
      <LoadingOverlay visible={false} message="x" />,
    );
    expect(container.querySelector('.loading-overlay')).toBeNull();
  });
});
