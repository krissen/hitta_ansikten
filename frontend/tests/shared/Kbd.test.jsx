import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Kbd } from '../../src/renderer/components/shared/Kbd.jsx';

afterEach(cleanup);

describe('Kbd', () => {
  it('renders a <kbd> element with the .kbd class and children', () => {
    const { container } = render(<Kbd>Enter</Kbd>);
    const kbd = container.querySelector('kbd');
    expect(kbd).not.toBeNull();
    expect(kbd.classList.contains('kbd')).toBe(true);
    expect(kbd.textContent).toBe('Enter');
  });

  it('appends a custom className', () => {
    const { container } = render(<Kbd className="extra">Esc</Kbd>);
    const kbd = container.querySelector('kbd');
    expect(kbd.classList.contains('kbd')).toBe(true);
    expect(kbd.classList.contains('extra')).toBe(true);
  });
});
