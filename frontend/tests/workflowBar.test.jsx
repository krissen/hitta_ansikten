import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// WorkflowBar derives steps from the module catalog (imports every component);
// ThemeEditor pulls in the theme manager (localStorage at import). Mock it.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

// The Continue button emits an in-app hand-off event; capture via a stub bus.
const mockEmit = vi.fn();
vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useEmitEvent: () => mockEmit,
}));

import { WorkflowBar } from '../src/renderer/components/WorkflowBar.jsx';
import {
  setWorkingFolder,
  clearWorkingFolder,
} from '../src/renderer/shared/workingFolder.js';

function renderBar(props = {}) {
  return render(
    <WorkflowBar
      activeStep={null}
      onOpenStep={() => {}}
      onOpenTool={() => {}}
      {...props}
    />,
  );
}

describe('WorkflowBar', () => {
  beforeEach(() => {
    mockEmit.mockReset();
    clearWorkingFolder();
  });

  it('renders the five pipeline steps in order', () => {
    renderBar();
    const steps = screen
      .getAllByRole('button')
      .filter((b) => b.className.includes('workflow-bar-step'));
    expect(steps.map((b) => b.textContent)).toEqual([
      '1Importera',
      '2Byt namn',
      '3Granska ansikten',
      '4Räkna spelare',
      '5Gallra spelare',
    ]);
  });

  it('marks the active step with aria-pressed', () => {
    renderBar({ activeStep: 'review' });
    const active = screen.getByRole('button', { name: /Granska ansikten/ });
    expect(active.getAttribute('aria-pressed')).toBe('true');
    const inactive = screen.getByRole('button', { name: /Importera/ });
    expect(inactive.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens a step via onOpenStep with the module id', () => {
    const onOpenStep = vi.fn();
    renderBar({ onOpenStep });
    fireEvent.click(screen.getByRole('button', { name: /Räkna spelare/ }));
    expect(onOpenStep).toHaveBeenCalledWith('player-count');
  });

  it('shows the empty folder chip when there is no anchor', () => {
    renderBar();
    expect(screen.getByText('Ingen arbetsmapp')).toBeTruthy();
  });

  it('shows the folder basename in the chip when an anchor is set', () => {
    setWorkingFolder({ roots: ['/events/cupen'], step: 'import' });
    renderBar();
    expect(screen.getByText('cupen')).toBeTruthy();
  });

  it('shows Continue and emits the hand-off event for an import anchor', () => {
    setWorkingFolder({ roots: ['/events/cupen'], step: 'import' });
    renderBar();
    const cont = screen.getByRole('button', { name: /Fortsätt: Byt namn/ });
    fireEvent.click(cont);
    expect(mockEmit).toHaveBeenCalledWith('open-rename-nef', {
      roots: ['/events/cupen'],
    });
  });

  it('shows no Continue button when the anchor step has no next step', () => {
    // culling is terminal — no continuation past it.
    setWorkingFolder({ roots: ['/events/cupen'], step: 'culling' });
    renderBar();
    expect(screen.queryByRole('button', { name: /Fortsätt/ })).toBeNull();
  });

  it('continues review → count with the anchor roots', () => {
    setWorkingFolder({ roots: ['/events/cupen'], step: 'review' });
    renderBar();
    fireEvent.click(
      screen.getByRole('button', { name: /Fortsätt: Räkna spelare/ }),
    );
    expect(mockEmit).toHaveBeenCalledWith('open-count', {
      roots: ['/events/cupen'],
    });
  });

  it('opens the tools menu and routes a tool click to onOpenTool', () => {
    const onOpenTool = vi.fn();
    renderBar({ onOpenTool });
    // Menu closed initially.
    expect(
      screen.queryByRole('menuitem', { name: /Databashantering/ }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Verktyg/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Databashantering/ }));
    expect(onOpenTool).toHaveBeenCalledWith('database-management');
  });

  describe('autohide', () => {
    function bar() {
      return document.querySelector('.workflow-bar');
    }

    it('is a plain always-visible flex child when autohide is off', () => {
      renderBar({ autoHide: false });
      expect(bar().classList.contains('autohide')).toBe(false);
      expect(bar().classList.contains('hidden')).toBe(false);
      expect(document.querySelector('.workflow-bar-hover-zone')).toBeNull();
    });

    it('renders the autohide class and a top-edge hover-zone when on', () => {
      renderBar({ autoHide: true });
      expect(bar().classList.contains('autohide')).toBe(true);
      expect(document.querySelector('.workflow-bar-hover-zone')).toBeTruthy();
    });

    it('marks the reduced-motion variant when the OS prefers reduced motion', () => {
      const original = window.matchMedia;
      window.matchMedia = (q) => ({
        matches: /prefers-reduced-motion/.test(q),
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      try {
        renderBar({ autoHide: true });
        expect(bar().classList.contains('reduced-motion')).toBe(true);
      } finally {
        window.matchMedia = original;
      }
    });

    describe('focus + tab-order (a11y)', () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      it('takes the hidden row out of the tab order via inert, and the hover-zone restores it', () => {
        renderBar({ autoHide: true });
        expect(bar().hasAttribute('inert')).toBe(false);

        // Idle past the hide delay → row hidden and inert (buttons unfocusable).
        act(() => vi.advanceTimersByTime(5000));
        expect(bar().classList.contains('hidden')).toBe(true);
        expect(bar().hasAttribute('inert')).toBe(true);

        // The top-edge catch-strip brings it back and clears inert.
        act(() =>
          fireEvent.mouseEnter(
            document.querySelector('.workflow-bar-hover-zone'),
          ),
        );
        expect(bar().classList.contains('hidden')).toBe(false);
        expect(bar().hasAttribute('inert')).toBe(false);
      });

      it('keyboard focus reveals the row and pauses the hide timer', () => {
        renderBar({ autoHide: true });
        const step = screen.getByRole('button', { name: /Importera/ });

        // Tab into the row: it reveals and, while focused, never slides away.
        act(() => fireEvent.focus(step));
        act(() => vi.advanceTimersByTime(10000));
        expect(bar().classList.contains('hidden')).toBe(false);
        expect(bar().hasAttribute('inert')).toBe(false);

        // Blur out of the row → the timer resumes and it hides.
        act(() => fireEvent.blur(step, { relatedTarget: document.body }));
        act(() => vi.advanceTimersByTime(5000));
        expect(bar().classList.contains('hidden')).toBe(true);
      });
    });
  });
});
