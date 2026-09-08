import { describe, it, expect, vi } from 'vitest';
import { resolveLaunchCommand } from '../src/main/launch-command.js';

// Fake expanders let us drive the decision without touching the filesystem.
function deps({ folders = [], files = [], dest } = {}) {
  return {
    expandFolders: vi.fn(() => folders),
    expandFiles: vi.fn(async () => files),
    resolveImportDest: vi.fn(() => dest),
  };
}

// Minimal parsed-args shape (as cli-args.js produces).
function args(overrides = {}) {
  return {
    verb: null,
    files: [],
    queuePosition: null,
    startQueue: false,
    clear: false,
    recursive: false,
    ...overrides,
  };
}

describe('resolveLaunchCommand — culling', () => {
  it('open-culling with expanded roots', async () => {
    const d = deps({ folders: ['/events/cupen'] });
    const { command } = await resolveLaunchCommand(
      args({ verb: 'culling', files: ['/events/cupen'], recursive: true }),
      d,
    );
    expect(command).toEqual({
      type: 'open-culling',
      payload: { roots: ['/events/cupen'], clear: false, recursive: true },
    });
  });

  it('paths that expand to nothing → enter-step culling EMPTY (the bug fix, not a strand)', async () => {
    const d = deps({ folders: [] });
    const { command } = await resolveLaunchCommand(
      args({ verb: 'culling', files: ['/typo'] }),
      d,
    );
    expect(command).toEqual({ type: 'enter-step', step: 'culling' });
  });

  it('bare --clear with no roots still opens culling (empties it)', async () => {
    const d = deps({ folders: [] });
    const { command } = await resolveLaunchCommand(
      args({ verb: 'culling', clear: true }),
      d,
    );
    expect(command).toEqual({
      type: 'open-culling',
      payload: { roots: [], clear: true, recursive: false },
    });
  });
});

describe('resolveLaunchCommand — import', () => {
  it('always opens import, destination optional', async () => {
    const d = deps({ dest: '/dest' });
    const { command } = await resolveLaunchCommand(
      args({ verb: 'import', files: ['/dest'] }),
      d,
    );
    expect(command).toEqual({
      type: 'open-import',
      payload: { destination: '/dest' },
    });
  });
});

describe('resolveLaunchCommand — faces / legacy', () => {
  it('queue flag → queue-files with expanded files', async () => {
    const d = deps({ files: ['/a.nef', '/b.nef'] });
    const { command } = await resolveLaunchCommand(
      args({
        verb: 'faces',
        files: ['*.nef'],
        queuePosition: 'end',
        startQueue: true,
      }),
      d,
    );
    expect(command).toEqual({
      type: 'queue-files',
      payload: {
        files: ['/a.nef', '/b.nef'],
        position: 'end',
        startQueue: true,
        clear: false,
      },
    });
  });

  it('paths that expand to nothing → enter-step review EMPTY (not a strand)', async () => {
    const d = deps({ files: [] });
    const { command } = await resolveLaunchCommand(
      args({
        verb: 'faces',
        files: ['/typo.nef'],
        queuePosition: 'end',
        startQueue: true,
      }),
      d,
    );
    expect(command).toEqual({ type: 'enter-step', step: 'review' });
  });

  it('single Finder file, no queue flag → pull-based initialFile (no command)', async () => {
    const d = deps({ files: ['/a.nef'] });
    const { command, initialFile } = await resolveLaunchCommand(
      args({ files: ['/a.nef'] }),
      d,
    );
    expect(command).toBeNull();
    expect(initialFile).toBe('/a.nef');
  });

  it('multiple files, no queue flag → queue-files without auto-start', async () => {
    const d = deps({ files: ['/a.nef', '/b.nef'] });
    const { command } = await resolveLaunchCommand(
      args({ files: ['/a.nef', '/b.nef'] }),
      d,
    );
    expect(command).toEqual({
      type: 'queue-files',
      payload: {
        files: ['/a.nef', '/b.nef'],
        position: 'end',
        startQueue: false,
        clear: false,
      },
    });
  });

  it('no verb, no files, no clear → nothing to launch', async () => {
    const { command, initialFile } = await resolveLaunchCommand(args(), deps());
    expect(command).toBeNull();
    expect(initialFile).toBeNull();
  });
});
