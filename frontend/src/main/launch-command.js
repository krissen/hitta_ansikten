// launch-command.js
// Pure resolution of a parsed CLI intent (cli-args.js) into a single workspace
// command for the renderer's router. Path expansion is injected (deps) so this
// stays filesystem-free and unit-testable; index.js wires the real expanders.
//
// The key property: the decision is made AFTER expansion, so a path that expands
// to nothing still yields an explicit command (open the step EMPTY) instead of
// leaving the renderer to guess from raw argument counts and strand in the
// default layout — the CLI-empty-expansion bug this replaces.

/**
 * @param {object} args - parsed cli-args result { verb, files, clear, recursive,
 *   queuePosition, startQueue }.
 * @param {object} deps
 * @param {(patterns: string[]) => string[]} deps.expandFolders - dirs for culling.
 * @param {(patterns: string[]) => Promise<string[]>} deps.expandFiles - image files.
 * @param {(patterns: string[]) => (string|undefined)} deps.resolveImportDest
 * @returns {Promise<{ command: object|null, initialFile: string|null }>}
 *   command: the workspace intent to dispatch (or null).
 *   initialFile: a single file to load via the pull-based get-initial-file path
 *     (set only for a lone Finder file with no queue flag; command is null then).
 */
async function resolveLaunchCommand(args, deps) {
  const { expandFolders, expandFiles, resolveImportDest } = deps;

  if (args.verb === 'culling') {
    const roots = expandFolders(args.files);
    if (roots.length > 0 || args.clear) {
      return {
        command: {
          type: 'open-culling',
          payload: { roots, clear: args.clear, recursive: args.recursive },
        },
        initialFile: null,
      };
    }
    // Paths given but matched nothing (`ansikten culling /typo`): open culling
    // empty rather than stranding in the default layout.
    return {
      command: { type: 'enter-step', step: 'culling' },
      initialFile: null,
    };
  }

  if (args.verb === 'import') {
    return {
      command: {
        type: 'open-import',
        payload: { destination: resolveImportDest(args.files) },
      },
      initialFile: null,
    };
  }

  if (args.files.length > 0 || args.clear) {
    const files = await expandFiles(args.files);
    if (files.length === 0 && !args.clear) {
      // Paths given but none matched: open the review step empty.
      return {
        command: { type: 'enter-step', step: 'review' },
        initialFile: null,
      };
    }
    if (args.queuePosition || args.clear) {
      return {
        command: {
          type: 'queue-files',
          payload: {
            files,
            position: args.queuePosition,
            startQueue: args.startQueue,
            clear: args.clear,
          },
        },
        initialFile: null,
      };
    }
    if (files.length === 1) {
      // Single Finder file, no queue flag: pull-based load, no morph.
      return { command: null, initialFile: files[0] };
    }
    // Multiple files without a queue flag: queue them (don't auto-start).
    return {
      command: {
        type: 'queue-files',
        payload: { files, position: 'end', startQueue: false, clear: false },
      },
      initialFile: null,
    };
  }

  return { command: null, initialFile: null };
}

module.exports = { resolveLaunchCommand };
