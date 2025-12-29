/**
 * Build script for FlexLayout workspace
 *
 * Uses esbuild to compile JSX and bundle React dependencies.
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;

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
  jsx: 'automatic',
  // External modules that should not be bundled (loaded separately)
  external: [],
  // Define globals
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
  },
  // Loader for different file types
  loader: {
    '.js': 'jsx',  // Allow JSX in .js files too
    '.jsx': 'jsx',
    '.css': 'css'
  },
  // Log level
  logLevel: 'info'
};

async function build() {
  try {
    if (isWatch) {
      // Watch mode
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      // One-time build
      const result = await esbuild.build(buildOptions);
      console.log('Build complete:', result);
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
