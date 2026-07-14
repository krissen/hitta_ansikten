import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act, cleanup } from '@testing-library/react';

// The BackendContext `api.post` wrapper must forward its third argument (per-call
// options like `{ timeout: 0 }` for long imports) to apiClient.post. A wrapper
// that dropped it would silently reinstate the 30s default and make the import
// timeout override dead code end-to-end. This renders the real provider and
// mocks only the underlying client to assert the forward.

const { post, get } = vi.hoisted(() => ({
  post: vi.fn().mockResolvedValue({ ok: true }),
  get: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/renderer/shared/api-client.js', () => ({
  apiClient: {
    post,
    get,
    connectWebSocket: vi.fn().mockResolvedValue(undefined),
    disconnectWebSocket: vi.fn(),
    addConnectionListener: vi.fn(),
    removeConnectionListener: vi.fn(),
    addOfflineListener: vi.fn(),
    removeOfflineListener: vi.fn(),
    setLogLevel: vi.fn(),
    setLogCategories: vi.fn(),
  },
}));

import { BackendProvider, useBackend } from '../src/renderer/context/BackendContext.jsx';

function Caller({ onReady }) {
  const { api } = useBackend();
  useEffect(() => { onReady(api); }, [api, onReady]);
  return null;
}

describe('BackendContext api.post per-call options', () => {
  beforeEach(() => { post.mockClear(); });
  afterEach(() => cleanup());

  it('forwards the third options arg through to apiClient.post', async () => {
    let api;
    await act(async () => {
      render(
        <BackendProvider>
          <Caller onReady={(a) => { api = a; }} />
        </BackendProvider>
      );
    });

    await act(async () => {
      await api.post('/api/v1/import/run', { volume_mount: '/Volumes/CARD' }, { timeout: 0 });
    });

    expect(post).toHaveBeenCalledWith(
      '/api/v1/import/run',
      { volume_mount: '/Volumes/CARD' },
      { timeout: 0 }
    );
  });
});
