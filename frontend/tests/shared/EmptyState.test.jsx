import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { EmptyState } from '../../src/renderer/components/shared/EmptyState.jsx';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders the title', () => {
    const { container } = render(<EmptyState title="Ingen bild inläst" />);
    const title = container.querySelector('.empty-state__title');
    expect(title.textContent).toBe('Ingen bild inläst');
  });

  it('renders icon, description and action when provided', () => {
    const { container } = render(
      <EmptyState
        icon={<span data-testid="icon">📷</span>}
        title="Tomt"
        description="Öppna en fil för att börja"
        action={<button data-testid="act">Öppna</button>}
      />,
    );
    expect(container.querySelector('.empty-state__icon')).not.toBeNull();
    expect(container.querySelector('.empty-state__description').textContent).toBe('Öppna en fil för att börja');
    expect(container.querySelector('.empty-state__action button')).not.toBeNull();
  });

  it('omits optional parts when not provided', () => {
    const { container } = render(<EmptyState title="Bara titel" />);
    expect(container.querySelector('.empty-state__icon')).toBeNull();
    expect(container.querySelector('.empty-state__description')).toBeNull();
    expect(container.querySelector('.empty-state__action')).toBeNull();
  });

  it('carries the base empty-state class', () => {
    const { container } = render(<EmptyState title="x" />);
    expect(container.querySelector('.empty-state')).not.toBeNull();
  });
});
