/**
 * Build script for FlexLayout workspace
 *
 * Uses esbuild to compile JSX and bundle React dependencies.
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { execSync, spawn, spawnSync } = require('child_process');

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;

function getVersionInfo() {
  try {
    const gitTag = execSync('git describe --tags --exact-match 2>/dev/null', { encoding: 'utf8' }).trim();
    return { version: gitTag, isTag: true };
  } catch {
    try {
      const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      return { version: commitHash, isTag: false };
    } catch {
      return { version: 'unknown', isTag: false };
    }
  }
}

const versionInfo = getVersionInfo();
console.log(`Version: ${versionInfo.isTag ? versionInfo.version : 'commit ' + versionInfo.version}`);

const versionFile = path.join(__dirname, '..', 'src', 'version.json');
fs.writeFileSync(versionFile, JSON.stringify(versionInfo, null, 2));

// Ensure output directory exists
const outdir = path.join(__dirname, '..', 'src', 'renderer', 'workspace', 'dist');
if (!fs.existsSync(outdir)) {
  fs.mkdirSync(outdir, { recursive: true });
}

const buildOptions = {
  entryPoints: [
    path.join(__dirname, '..', 'src', 'renderer', 'workspace', 'flexlayout', 'index.jsx')
  ],
  bundle: true,
  outfile: path.join(outdir, 'workspace-bundle.js'),
  format: 'esm',
  platform: 'browser',
  target: ['chrome110'],
  sourcemap: isDev,
  minify: !isDev,
  metafile: true,
  treeShaking: true,
  jsx: 'automatic',
  external: [],
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
  },
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx',
    '.css': 'css'
  },
  logLevel: 'info'
};

// Tailwind utility layer (see src/renderer/tailwind.css). Compiled by the
// Tailwind CLI into a sibling bundle that workspace-flex.html links after
// workspace-bundle.css so legacy (unlayered) CSS keeps winning the cascade.
const tailwindInput = path.join(__dirname, '..', 'src', 'renderer', 'tailwind.css');
const tailwindOutput = path.join(outdir, 'tailwind-bundle.css');

function tailwindArgs(extra = []) {
  return ['-i', tailwindInput, '-o', tailwindOutput, ...extra];
}

// One-shot Tailwind build; propagates a non-zero exit code on failure.
// Run the Tailwind CLI's JS entry directly through the current node binary.
// This sidesteps `npx` entirely: on Windows `npx` is `npx.cmd`, which spawn()
// refuses without a shell (CVE-2024-27980 hardening), and shell:true would
// break on paths containing spaces since argv is not re-quoted. The package
// only exports package.json, so resolve the bin entry relative to it.
const TAILWIND_CLI = path.join(
  path.dirname(require.resolve('@tailwindcss/cli/package.json')),
  'dist', 'index.mjs'
);

function buildTailwind() {
  const args = tailwindArgs(isDev ? [] : ['--minify']);
  const result = spawnSync(process.execPath, [TAILWIND_CLI, ...args], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('Tailwind build failed');
    process.exit(result.status || 1);
  }
}

// Watch-mode Tailwind, running in parallel with the esbuild watch context.
// `--watch=always` keeps the watcher alive even when stdin is closed (the CLI
// otherwise exits on stdin EOF, e.g. when run detached / piped / in CI).
// Killed when this process exits so no orphan watcher is left behind.
function watchTailwind() {
  const child = spawn(process.execPath, [TAILWIND_CLI, ...tailwindArgs(['--watch=always'])], { stdio: 'inherit' });
  const cleanup = () => {
    if (!child.killed) child.kill();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  return child;
}

async function build() {
  try {
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      watchTailwind();
      console.log('Watching for changes...');
    } else {
      const result = await esbuild.build(buildOptions);
      buildTailwind();
      if (result.metafile && !isDev) {
        const analysis = await esbuild.analyzeMetafile(result.metafile, { verbose: false });
        console.log('\nBundle analysis:\n' + analysis);
      }
      console.log('Build complete');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
