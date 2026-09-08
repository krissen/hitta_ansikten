import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { IconButton } from '../../src/renderer/components/shared/IconButton.jsx';

afterEach(cleanup);

describe('IconButton', () => {
  it('sets aria-label and title from the label prop', () => {
    const { getByRole } = render(<IconButton icon="trash" label="Ta bort" />);
    const btn = getByRole('button');
    expect(btn.getAttribute('aria-label')).toBe('Ta bort');
    expect(btn.getAttribute('title')).toBe('Ta bort');
  });

  it('renders the requested Icon (svg with the icon class)', () => {
    const { container } = render(<IconButton icon="trash" label="Ta bort" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.classList.contains('icon-trash')).toBe(true);
  });

  it('defaults to the elevated variant (legacy .btn-icon parity) and md size', () => {
    const { getByRole } = render(<IconButton icon="close" label="Stäng" />);
    const btn = getByRole('button');
    expect(btn.classList.contains('icon-btn')).toBe(true);
    expect(btn.classList.contains('icon-btn--elevated')).toBe(true);
    expect(btn.classList.contains('icon-btn--md')).toBe(true);
  });

  it('applies the explicit ghost variant', () => {
    const { getByRole } = render(
      <IconButton icon="close" label="Stäng" variant="ghost" />,
    );
    const btn = getByRole('button');
    expect(btn.classList.contains('icon-btn--ghost')).toBe(true);
    expect(btn.classList.contains('icon-btn--elevated')).toBe(false);
  });

  it('applies the explicit danger variant and sm size', () => {
    const { getByRole } = render(
      <IconButton icon="trash" label="Ta bort" variant="danger" size="sm" />,
    );
    const btn = getByRole('button');
    expect(btn.classList.contains('icon-btn--danger')).toBe(true);
    expect(btn.classList.contains('icon-btn--sm')).toBe(true);
  });

  it('fires onClick when enabled and blocks it when disabled', () => {
    const onClick = vi.fn();
    const { getByRole, rerender } = render(
      <IconButton icon="refresh" label="Uppdatera" onClick={onClick} />,
    );
    fireEvent.click(getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <IconButton
        icon="refresh"
        label="Uppdatera"
        onClick={onClick}
        disabled
      />,
    );
    const btn = getByRole('button');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe('missing label', () => {
    let warnSpy;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('emits a dev-warning when label is missing', () => {
      render(<IconButton icon="trash" />);
      expect(warnSpy).toHaveBeenCalled();
      const logged = warnSpy.mock.calls.flat().join(' ');
      expect(logged).toContain('IconButton');
    });
  });
});
