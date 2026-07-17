import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// StartupLanding derives its steps/tools from the shared workflowSteps module,
// which imports the module catalog and thus every module component. ThemeEditor
// pulls in the theme manager, which reads localStorage at import time
// (unavailable under jsdom). Mock it away, same as moduleCatalog.test.js.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

// Mock the backend context so we control the /import/volumes response.
const mockGet = vi.fn();
vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: { get: mockGet } }),
}));

// The continue row emits in-app hand-off events; capture them via a stubbed bus.
const mockEmit = vi.fn();
vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useEmitEvent: () => mockEmit,
  useModuleEvent: () => {},
  useModuleAPI: () => ({ emit: mockEmit, on: () => () => {} }),
}));

import { StartupLanding } from '../src/renderer/components/StartupLanding.jsx';
import { setWorkingFolder, clearWorkingFolder } from '../src/renderer/shared/workingFolder.js';

describe('StartupLanding', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockEmit.mockReset();
    clearWorkingFolder();
  });

  it('renders the workflow steps in order, then the tools', async () => {
    mockGet.mockResolvedValue({ volumes: [] });
    render(<StartupLanding onOpenModule={() => {}} />);

    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      // Workflow steps (unchanged order)
      '1.Importera',
      '2.Byt namn',
      '3.Granska ansikten',
      '4.Räkna spelare',
      '5.Gallra spelare',
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

describe('StartupLanding — continue row (working-folder anchor)', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({ volumes: [] });
    mockEmit.mockReset();
    clearWorkingFolder();
  });

  it('shows no continue row when there is no anchor', () => {
    render(<StartupLanding onOpenModule={() => {}} />);
    expect(screen.queryByText(/Aktuell mapp/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Fortsätt/ })).toBeNull();
  });

  it('after import: offers "Fortsätt: Byt namn" and emits open-rename-nef with the roots', () => {
    setWorkingFolder({ roots: ['/events/cupen'], step: 'import' });
    render(<StartupLanding onOpenModule={() => {}} />);

    expect(screen.getByText('Aktuell mapp: cupen')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /Fortsätt: Byt namn/ });
    fireEvent.click(btn);
    expect(mockEmit).toHaveBeenCalledWith('open-rename-nef', { roots: ['/events/cupen'] });
  });

  it('after rename: offers "Fortsätt: Granska ansikten" and emits open-review-queue with the roots', () => {
    setWorkingFolder({ roots: ['/events/cupen'], step: 'rename' });
    render(<StartupLanding onOpenModule={() => {}} />);

    expect(screen.getByText('Aktuell mapp: cupen')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /Fortsätt: Granska ansikten/ });
    fireEvent.click(btn);
    expect(mockEmit).toHaveBeenCalledWith('open-review-queue', { roots: ['/events/cupen'] });
  });

  it('shows no continue row for an anchor whose step has no next hand-off', () => {
    // culling is the terminal step — nothing continues past it.
    setWorkingFolder({ roots: ['/events/cupen'], step: 'culling' });
    render(<StartupLanding onOpenModule={() => {}} />);
    expect(screen.queryByText(/Aktuell mapp/)).toBeNull();
  });
});
