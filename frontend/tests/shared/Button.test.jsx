import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Button } from '../../src/renderer/components/shared/Button.jsx';

afterEach(cleanup);

describe('Button', () => {
  it('renders children and the base + default variant/size classes', () => {
    const { getByRole } = render(<Button>Spara</Button>);
    const btn = getByRole('button');
    expect(btn.textContent).toBe('Spara');
    expect(btn.classList.contains('btn')).toBe(true);
    // Defaults: secondary / md.
    expect(btn.classList.contains('btn--secondary')).toBe(true);
    expect(btn.classList.contains('btn--md')).toBe(true);
    // Defaults to a non-submitting button.
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('applies the requested variant and size classes', () => {
    const { getByRole } = render(
      <Button variant="danger" size="sm">Radera</Button>,
    );
    const btn = getByRole('button');
    expect(btn.classList.contains('btn--danger')).toBe(true);
    expect(btn.classList.contains('btn--sm')).toBe(true);
  });

  it.each(['primary', 'secondary', 'ghost', 'danger'])(
    'renders the %s variant class',
    (variant) => {
      const { getByRole } = render(<Button variant={variant}>x</Button>);
      expect(getByRole('button').classList.contains(`btn--${variant}`)).toBe(true);
    },
  );

  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    const { getByRole } = render(<Button onClick={onClick}>Klicka</Button>);
    fireEvent.click(getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <Button disabled onClick={onClick}>Klicka</Button>,
    );
    const btn = getByRole('button');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading implies disabled + aria-busy, renders a spinner, and blocks onClick', () => {
    const onClick = vi.fn();
    const { getByRole, container } = render(
      <Button loading onClick={onClick}>Laddar</Button>,
    );
    const btn = getByRole('button');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.btn__spinner')).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no aria-busy attribute when not loading', () => {
    const { getByRole } = render(<Button>Klar</Button>);
    expect(getByRole('button').hasAttribute('aria-busy')).toBe(false);
  });

  it('forwards native type and extra props', () => {
    const { getByRole } = render(
      <Button type="submit" data-testid="save">Spara</Button>,
    );
    const btn = getByRole('button');
    expect(btn.getAttribute('type')).toBe('submit');
    expect(btn.getAttribute('data-testid')).toBe('save');
  });

  it('appends a custom className to the contract classes', () => {
    const { getByRole } = render(<Button className="extra">x</Button>);
    const btn = getByRole('button');
    expect(btn.classList.contains('btn')).toBe(true);
    expect(btn.classList.contains('extra')).toBe(true);
  });
});
