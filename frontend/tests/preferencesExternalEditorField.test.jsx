import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// PreferencesModule pulls in modules that read localStorage at import time
// (theme-manager, the preferences singleton), so the shim has to exist before
// they load — hence the dynamic imports in beforeAll below.
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

/**
 * The external-editor settings field must be emptyable.
 *
 * A controlled input whose value falls back to the default (`value={x || DEFAULT}`)
 * snaps back the instant it goes empty, which makes select-all-and-retype — the
 * normal way to replace a value — impossible. Assert the interaction, not the
 * expression.
 */

vi.mock('../src/renderer/context/ConfirmContext.jsx', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/renderer/context/ToastContext.jsx', () => ({
  useToast: () => ({ show: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));

let PreferencesModule;
let preferences;

beforeAll(async () => {
  ({ PreferencesModule } = await import('../src/renderer/components/PreferencesModule.jsx'));
  ({ preferences } = await import('../src/renderer/workspace/preferences.js'));
});

/** Open the Files section and return the external-editor input. */
function renderFilesSection() {
  render(<PreferencesModule />);
  fireEvent.click(screen.getByText('Filer'));
  return screen.getByLabelText('Extern editor');
}

describe('external-editor preference field', () => {
  beforeEach(() => {
    preferences.set('paths.externalEditor', 'Adobe Lightroom Classic');
  });

  it('shows the stored value', () => {
    expect(renderFilesSection().value).toBe('Adobe Lightroom Classic');
  });

  it('can be cleared and retyped', () => {
    const input = renderFilesSection();

    fireEvent.change(input, { target: { value: '' } });
    // The field must stay empty rather than snapping back to the default,
    // otherwise there is no way to type a replacement.
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: 'Capture One' } });
    expect(input.value).toBe('Capture One');

    // Edits are buffered until Save, as everywhere else in this pane.
    fireEvent.click(screen.getByRole('button', { name: 'Spara' }));
    expect(preferences.get('paths.externalEditor')).toBe('Capture One');
  });

  it('falls back to the default in the placeholder, not the value', () => {
    const input = renderFilesSection();
    fireEvent.change(input, { target: { value: '' } });
    expect(input.placeholder).toBe('Adobe Lightroom Classic');
  });
});
