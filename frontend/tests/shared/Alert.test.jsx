import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Alert } from '../../src/renderer/components/shared/Alert.jsx';

afterEach(cleanup);

describe('Alert', () => {
  it('renders its children with the variant class', () => {
    const { container } = render(<Alert variant="warning">Se upp</Alert>);
    const alert = container.querySelector('.alert');
    expect(alert.classList.contains('alert--warning')).toBe(true);
    expect(alert.textContent).toContain('Se upp');
  });

  it('uses role="alert" for the error variant', () => {
    const { container } = render(<Alert variant="error">Nåt gick fel</Alert>);
    expect(container.querySelector('.alert').getAttribute('role')).toBe(
      'alert',
    );
  });

  it('uses role="status" for non-error variants', () => {
    for (const variant of ['info', 'success', 'warning']) {
      const { container, unmount } = render(<Alert variant={variant}>x</Alert>);
      expect(container.querySelector('.alert').getAttribute('role')).toBe(
        'status',
      );
      unmount();
    }
  });

  it('defaults to the info variant', () => {
    const { container } = render(<Alert>hej</Alert>);
    expect(
      container.querySelector('.alert').classList.contains('alert--info'),
    ).toBe(true);
  });

  it('renders no dismiss button by default', () => {
    const { container } = render(<Alert>ingen knapp</Alert>);
    expect(container.querySelector('.alert__dismiss')).toBeNull();
  });

  it('renders a dismiss button that calls onDismiss', () => {
    const onDismiss = vi.fn();
    const { container } = render(<Alert onDismiss={onDismiss}>stäng</Alert>);
    const btn = container.querySelector('.alert__dismiss');
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders an optional icon', () => {
    const { container } = render(
      <Alert icon={<span data-testid="ic">!</span>}>text</Alert>,
    );
    expect(container.querySelector('.alert__icon')).not.toBeNull();
  });
});
