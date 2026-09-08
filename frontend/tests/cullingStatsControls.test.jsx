import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CullingStats } from '../src/renderer/components/culling/StatsPanel.jsx';

const baseProps = {
  stats: { players: [], excluded: null, baseline: null },
  selected: '',
  mode: 'loupe',
  width: 240,
  baseline: 'median',
};

describe('CullingStats — Min bilder control', () => {
  it('renders the min-images input seeded from the shared setting', () => {
    render(
      <CullingStats
        {...baseProps}
        minImages={4}
        onMinImagesChange={() => {}}
      />,
    );
    const input = screen.getByLabelText('Min bilder');
    expect(input).toBeTruthy();
    expect(input.value).toBe('4');
  });

  it('omits the control when no handler is given (read-only usage)', () => {
    render(<CullingStats {...baseProps} minImages={3} />);
    expect(screen.queryByLabelText('Min bilder')).toBeNull();
  });

  it('previews on keystroke without writing to the store; commits on blur', () => {
    const onMinImagesChange = vi.fn();
    render(
      <CullingStats
        {...baseProps}
        minImages={3}
        onMinImagesChange={onMinImagesChange}
      />,
    );
    const input = screen.getByLabelText('Min bilder');
    // Typing previews locally (no store write / refetch on every digit)...
    fireEvent.change(input, { target: { value: '5' } });
    expect(onMinImagesChange).not.toHaveBeenCalled();
    expect(input.value).toBe('5');
    // ...blur commits the new value to the shared store.
    fireEvent.blur(input);
    expect(onMinImagesChange).toHaveBeenCalledWith(5);
  });

  it('commits on Enter as well as blur', () => {
    const onMinImagesChange = vi.fn();
    render(
      <CullingStats
        {...baseProps}
        minImages={3}
        onMinImagesChange={onMinImagesChange}
      />,
    );
    const input = screen.getByLabelText('Min bilder');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onMinImagesChange).toHaveBeenCalledWith(2);
  });

  it('clamps a committed value below 1 up to 1', () => {
    const onMinImagesChange = vi.fn();
    render(
      <CullingStats
        {...baseProps}
        minImages={3}
        onMinImagesChange={onMinImagesChange}
      />,
    );
    const input = screen.getByLabelText('Min bilder');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onMinImagesChange).toHaveBeenCalledWith(1);
    expect(input.value).toBe('1');
  });

  it('does not write to the store when the committed value is unchanged', () => {
    const onMinImagesChange = vi.fn();
    render(
      <CullingStats
        {...baseProps}
        minImages={3}
        onMinImagesChange={onMinImagesChange}
      />,
    );
    const input = screen.getByLabelText('Min bilder');
    // Focus and blur without changing the value: no redundant refetch.
    fireEvent.blur(input);
    expect(onMinImagesChange).not.toHaveBeenCalled();
  });

  it('re-seeds the draft when the shared setting changes externally', () => {
    const { rerender } = render(
      <CullingStats
        {...baseProps}
        minImages={3}
        onMinImagesChange={() => {}}
      />,
    );
    const input = screen.getByLabelText('Min bilder');
    expect(input.value).toBe('3');
    // An external change (e.g. edited in the Räkna spelare tab) flows in via props.
    rerender(
      <CullingStats
        {...baseProps}
        minImages={6}
        onMinImagesChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('Min bilder').value).toBe('6');
  });
});
