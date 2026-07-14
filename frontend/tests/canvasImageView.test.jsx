import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { CanvasImageView } from '../src/renderer/components/CanvasImageView.jsx';

// jsdom has no ResizeObserver (useCanvasDimensions) and no 2D canvas context.
// The ResizeObserver stub fires once on observe so dimensions initialize; the
// getContext mock records draw calls so tests can assert on the paint sequence.
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; }
      observe() { this.cb([]); }
      unobserve() {}
      disconnect() {}
    };
  }
});

let ctx;

beforeEach(() => {
  ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn()
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
});

const fakeImage = { width: 100, height: 50 };

describe('CanvasImageView', () => {
  it('draws the image when one is provided', () => {
    render(<CanvasImageView image={fakeImage} />);
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.drawImage.mock.calls[0][0]).toBe(fakeImage);
  });

  it('clears the canvas when the image goes null (no stale frame)', () => {
    const { rerender } = render(<CanvasImageView image={fakeImage} />);
    expect(ctx.drawImage).toHaveBeenCalled();

    ctx.setTransform.mockClear();
    ctx.clearRect.mockClear();
    ctx.drawImage.mockClear();

    act(() => { rerender(<CanvasImageView image={null} />); });

    // The null-image render must still reset the transform and clear the
    // backing store so the previous frame cannot hide the host's overlays —
    // and it must not paint anything.
    expect(ctx.setTransform).toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('renders nothing to the canvas when mounted without an image', () => {
    render(<CanvasImageView image={null} />);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('exposes role="img" + aria-label on the canvas when ariaLabel is given', () => {
    const { container } = render(
      <CanvasImageView image={fakeImage} ariaLabel="250601_120000_anna.jpg" />
    );
    const canvas = container.querySelector('canvas');
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe('250601_120000_anna.jpg');
  });

  it('leaves the canvas unnamed when ariaLabel is omitted', () => {
    const { container } = render(<CanvasImageView image={fakeImage} />);
    const canvas = container.querySelector('canvas');
    expect(canvas.hasAttribute('role')).toBe(false);
    expect(canvas.hasAttribute('aria-label')).toBe(false);
  });
});
