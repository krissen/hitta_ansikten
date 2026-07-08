import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the backend context so we control the /import/volumes response.
const mockGet = vi.fn();
vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: { get: mockGet } }),
}));

import { StartupLanding } from '../src/renderer/components/StartupLanding.jsx';

describe('StartupLanding', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('renders the workflow steps in order, then the tools', async () => {
    mockGet.mockResolvedValue({ volumes: [] });
    render(<StartupLanding onOpenModule={() => {}} />);

    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      // Workflow steps (unchanged order)
      'Importera',
      'Byt namn',
      'Granska ansikten',
      'Räkna spelare',
      'Gallra spelare',
      // Tools (remaining views), appended
      'Databashantering',
      'Förfina ansikten',
      'Filkö',
      'Statistik',
      'Loggar',
      'Inställningar',
      'Temaredigerare',
    ]);
  });

  it('disables Import when no card volume is present', async () => {
    mockGet.mockResolvedValue({ volumes: [] });
    render(<StartupLanding onOpenModule={() => {}} />);

    const importBtn = screen.getByRole('button', { name: /Importera/ });
    await waitFor(() => expect(importBtn.disabled).toBe(true));
  });

  it('enables Import when a card volume is present', async () => {
    mockGet.mockResolvedValue({ volumes: [{ mount: '/Volumes/EOS_DIGITAL' }] });
    render(<StartupLanding onOpenModule={() => {}} />);

    const importBtn = screen.getByRole('button', { name: /Importera/ });
    await waitFor(() => expect(importBtn.disabled).toBe(false));
  });

  it('calls onOpenModule with the step id when a step is clicked', async () => {
    mockGet.mockResolvedValue({ volumes: [] });
    const onOpenModule = vi.fn();
    render(<StartupLanding onOpenModule={onOpenModule} />);

    fireEvent.click(screen.getByRole('button', { name: /Granska ansikten/ }));
    expect(onOpenModule).toHaveBeenCalledWith('review-module');
  });

  it('opens a tool module (e.g. Databashantering) when clicked', async () => {
    mockGet.mockResolvedValue({ volumes: [] });
    const onOpenModule = vi.fn();
    render(<StartupLanding onOpenModule={onOpenModule} />);

    // Await the async card-volume effect so the click doesn't race a pending act().
    fireEvent.click(await screen.findByRole('button', { name: /Databashantering/ }));
    expect(onOpenModule).toHaveBeenCalledWith('database-management');
  });

  it('does not let a disabled Import button fire onOpenModule', async () => {
    mockGet.mockResolvedValue({ volumes: [] });
    const onOpenModule = vi.fn();
    render(<StartupLanding onOpenModule={onOpenModule} />);

    const importBtn = screen.getByRole('button', { name: /Importera/ });
    await waitFor(() => expect(importBtn.disabled).toBe(true));
    fireEvent.click(importBtn);
    expect(onOpenModule).not.toHaveBeenCalled();
  });
});
