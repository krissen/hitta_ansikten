import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// StartupLanding is now a pure welcome/orientation card (PR 6 trim): the step
// grid, tools grid and continue row moved to the persistent WorkflowBar, which
// is the single source for navigation and continuation. The component no longer
// touches the backend, the module bus or the working-folder anchor, so no mocks
// are needed.
import { StartupLanding } from '../src/renderer/components/StartupLanding.jsx';

describe('StartupLanding — welcome card', () => {
  it('renders the welcome title, subtitle and workflow-bar hint', () => {
    render(<StartupLanding />);
    expect(screen.getByText('Kom igång')).toBeTruthy();
    // Subtitle + hint are present (Swedish copy from the i18n catalog).
    expect(screen.getByText(/hela flödet/)).toBeTruthy();
    expect(screen.getByText(/arbetsflödesraden/)).toBeTruthy();
  });

  it('exposes an accessible region label', () => {
    render(<StartupLanding />);
    expect(screen.getByRole('region', { name: 'Kom igång' })).toBeTruthy();
  });

  it('renders NO navigation controls (steps/tools/continue live in the WorkflowBar)', () => {
    render(<StartupLanding />);
    // No step/tool buttons and no "Fortsätt" continue button on the landing.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Fortsätt/ })).toBeNull();
    expect(screen.queryByText(/Aktuell mapp/)).toBeNull();
  });
});
