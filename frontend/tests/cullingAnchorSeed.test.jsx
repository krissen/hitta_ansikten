import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

// Etapp-3 part B: when Gallra spelare (culling) opens with no shared scan scope
// to adopt, it seeds the roots field from the pipeline working-folder anchor as a
// PREFILL only — it must never auto-scan. A present scan scope always wins.

const post = vi.fn();
const get = vi.fn();
vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: { post, get } }),
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
import { setScanScope, takeExternalLoad } from '../src/renderer/shared/scanScope.js';
import { setWorkingFolder, clearWorkingFolder } from '../src/renderer/shared/workingFolder.js';

function scanFilesCalls() {
  return post.mock.calls.filter(([p]) => p === '/api/v1/culling/files');
}
function chipTexts(container) {
  return [...container.querySelectorAll('.culling-chip')].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
}

async function mountCulling() {
  let utils;
  await act(async () => {
    utils = render(<CullingModule node={null} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  post.mockReset().mockImplementation((path) => {
    if (path === '/api/v1/culling/files') return Promise.resolve({ files: [], players: [] });
    return Promise.resolve({});
  });
  get.mockReset().mockResolvedValue({});
  setScanScope(null);
  takeExternalLoad(); // clear any pending external-load flag
  clearWorkingFolder();
  globalThis.window.ansiktenAPI = {
    watchFolder: vi.fn(),
    unwatchFolder: vi.fn(),
    onFolderChanged: () => () => {},
    invoke: vi.fn().mockResolvedValue([]),
  };
});

afterEach(() => cleanup());

describe('CullingModule — working-folder anchor seed', () => {
  it('prefills roots from the anchor without scanning when no scan scope exists', async () => {
    setWorkingFolder({ roots: ['/events/cupen'], step: 'rename' });
    const { container } = await mountCulling();

    // Roots field seeded…
    expect(chipTexts(container).some((c) => c.includes('cupen'))).toBe(true);
    // …but no scan was triggered (explicit user requirement: prefill only).
    expect(scanFilesCalls()).toHaveLength(0);
  });

  it('does nothing when there is neither a scan scope nor an anchor', async () => {
    const { container } = await mountCulling();
    expect(chipTexts(container)).toHaveLength(0);
    expect(scanFilesCalls()).toHaveLength(0);
  });

  it('lets a present scan scope win over the anchor (adopts and scans)', async () => {
    setWorkingFolder({ roots: ['/events/cupen'], step: 'rename' });
    setScanScope({ roots: ['/scope/match'], globs: [], recursive: true, date_from: null, date_to: null, extension_preset: 'jpg' });
    const { container } = await mountCulling();

    // Scope roots adopted (not the anchor's), and a scan ran.
    const chips = chipTexts(container);
    expect(chips.some((c) => c.includes('match'))).toBe(true);
    expect(chips.some((c) => c.includes('cupen'))).toBe(false);
    expect(scanFilesCalls().length).toBeGreaterThanOrEqual(1);
  });
});
