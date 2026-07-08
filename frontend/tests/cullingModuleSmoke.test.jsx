import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Smoke test: the component must actually RENDER without throwing. The pure-helper
// tests don't, so a hook-order / temporal-dead-zone regression (e.g. an effect
// dependency array referencing a const declared later) would otherwise ship
// undetected — the module would crash on first render but pass CI.

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({
    api: {
      post: vi.fn().mockResolvedValue({ files: [], players: [] }),
      get: vi.fn().mockResolvedValue({}),
    },
  }),
}));

vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useModuleEvent: () => {},
  useModuleAPI: () => ({
    emit: vi.fn(),
    on: () => () => {},
    waitForListeners: vi.fn().mockResolvedValue(true),
    hasListeners: () => false,
  }),
}));

import { CullingModule } from '../src/renderer/components/CullingModule.jsx';

describe('CullingModule render smoke', () => {
  beforeEach(() => {
    globalThis.window.ansiktenAPI = {
      watchFolder: vi.fn(),
      unwatchFolder: vi.fn(),
      onFolderChanged: () => () => {},
      invoke: vi.fn().mockResolvedValue([]),
    };
  });

  it('renders without throwing (no TDZ / hook-order regression)', () => {
    expect(() => render(<CullingModule node={null} />)).not.toThrow();
  });
});
