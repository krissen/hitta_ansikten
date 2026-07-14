import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

// A partial restore (main image back, a sidecar could not be) returns the
// leftover as a NEW trash entry in `partial`. TrashPanel drops the restored id
// but must append the leftover so it stays visible without a reload.

const mocks = vi.hoisted(() => ({ api: { get: null, post: null } }));

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: mocks.api }),
}));
vi.mock('../src/renderer/context/ConfirmContext.jsx', () => ({
  useConfirm: () => async () => true,
}));

import { TrashPanel } from '../src/renderer/components/TrashPanel.jsx';

afterEach(cleanup);

describe('TrashPanel partial restore', () => {
  it('keeps the sidecar-only leftover visible under its new id', async () => {
    mocks.api.get = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'old',
          basename: '260626_191003_Milian.jpg',
          original_path: '/p/260626_191003_Milian.jpg',
          stored_name: 'old__260626_191003_Milian.jpg',
          sidecars: [],
        },
      ],
    });
    mocks.api.post = vi.fn().mockResolvedValue({
      restored: [{ id: 'old', restored_path: '/p/260626_191003_Milian.jpg' }],
      partial: [
        {
          id: 'new',
          basename: '260626_191003_Milian.xmp',
          original_path: '/p/260626_191003_Milian.xmp',
          stored_name: 'old__260626_191003_Milian.xmp',
          sidecars: [],
        },
      ],
      errors: [],
    });

    await act(async () => {
      render(<TrashPanel />);
    });

    // The image row is shown after the mount fetch.
    expect(await screen.findByText('260626_191003_Milian.jpg')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Återställ' }));
    });

    // The restored image is gone from the list; the leftover .xmp stays visible.
    await waitFor(() => {
      expect(screen.queryByText('260626_191003_Milian.jpg')).toBeNull();
      expect(screen.getByText('260626_191003_Milian.xmp')).toBeTruthy();
    });
  });

  it('drops the row entirely when there is no leftover', async () => {
    mocks.api.get = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'old',
          basename: 'pic.jpg',
          original_path: '/p/pic.jpg',
          stored_name: 'old__pic.jpg',
          sidecars: [],
        },
      ],
    });
    mocks.api.post = vi.fn().mockResolvedValue({
      restored: [{ id: 'old', restored_path: '/p/pic.jpg' }],
      partial: [],
      errors: [],
    });

    await act(async () => {
      render(<TrashPanel />);
    });
    expect(await screen.findByText('pic.jpg')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Återställ' }));
    });

    await waitFor(() => {
      expect(screen.queryByText('pic.jpg')).toBeNull();
    });
  });
});
