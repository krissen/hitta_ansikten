// cli-args.js
// Pure command-line parsing for the Ansikten launcher.
//
// Position-agnostic: scan for known flags/verbs anywhere in argv, so the same
// logic handles every invocation shape (direct electron, npx electron, packaged
// app, second-instance forwarding). Kept dependency-free so it can be unit
// tested without spinning up Electron.
//
// Grammar:  ansikten [VERB] [--clear|-c] [--recursive|-r] [-s|--start] PATH...
//   VERB  faces (default) | culling (alias cull) | import
//   --clear/-c      empty the target's working set first (alone = just empty)
//   --recursive/-r  culling only: also scan sub-folders (default: just the
//                   named folder, matching shell-glob intuition)
// The import verb takes an optional destination folder as its single path arg;
// the source (camera card) is autodetected, and --clear/--recursive are ignored.
// faces-specific position flags (--queue/-q, --queue-start/-qs, --queue-end/-qe)
// are kept for back-compat and ignored by the culling target.

// Maps a recognised verb token to its canonical target.
const KNOWN_VERBS = {
  faces: 'faces',
  culling: 'culling',
  cull: 'culling',
  import: 'import',
};

// Known executables/metadata to skip (case-insensitive basename matching), so
// the electron binary, node, the app bundle path, etc. are never mistaken for a
// verb or a file path.
const SKIP_PATTERNS = [
  /^electron/i,
  /^node/i,
  /^npx/i,
  /\.js$/i,
  /^\.\.?$/,
  /^ansikten$/i, // Our app name
];

function shouldSkipArg(arg) {
  if (!arg) return true;
  // Skip macOS app bundle executables
  if (arg.includes('.app/Contents/MacOS/')) return true;
  const basename = arg.split(/[/\\]/).pop();
  return SKIP_PATTERNS.some((pattern) => pattern.test(basename));
}

/**
 * Parse an argv array into a structured launch intent.
 *
 * @param {string[]} argv
 * @returns {{
 *   verb: 'faces' | 'culling' | 'import' | null,   // null = no explicit verb (legacy/Finder)
 *   files: string[],                    // path/glob args (target decides meaning)
 *   queuePosition: 'start' | 'end' | 'sorted' | null,
 *   startQueue: boolean,
 *   clear: boolean,                     // empty the target working set first
 *   recursive: boolean,                 // culling: scan sub-folders too (default off)
 * }}
 */
function parseCliArgs(argv) {
  const result = {
    verb: null,
    files: [],
    queuePosition: null,
    startQueue: false,
    clear: false,
    recursive: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--queue' || arg === '-q') {
      result.queuePosition = 'end';
    } else if (arg === '--queue-start' || arg === '-qs') {
      result.queuePosition = 'start';
    } else if (arg === '--queue-end' || arg === '-qe') {
      result.queuePosition = 'end';
    } else if (arg === '--start' || arg === '-s') {
      result.startQueue = true;
    } else if (arg === '--clear' || arg === '-c') {
      result.clear = true;
    } else if (arg === '--recursive' || arg === '-r') {
      result.recursive = true;
    } else if (arg.startsWith('-')) {
      continue;
    } else if (shouldSkipArg(arg)) {
      continue;
    } else if (
      result.verb === null &&
      result.files.length === 0 &&
      KNOWN_VERBS[arg.toLowerCase()]
    ) {
      // First real token that names a verb is consumed as the verb;
      // everything after it is a path.
      result.verb = KNOWN_VERBS[arg.toLowerCase()];
    } else {
      result.files.push(arg);
    }
  }

  // An explicit `faces` verb means "add to the face queue and start" — preserve
  // the legacy `ansikten *.NEF` behaviour (the launcher injects `faces` for bare
  // file args). Position/start stay overridable by the flags above.
  if (result.verb === 'faces') {
    if (result.queuePosition === null) result.queuePosition = 'end';
    result.startQueue = true;
  }

  return result;
}

module.exports = { parseCliArgs, shouldSkipArg, KNOWN_VERBS };
