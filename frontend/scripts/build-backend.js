#!/usr/bin/env node
/**
 * Build backend with PyInstaller (--onedir mode)
 *
 * Builds the Python backend into a standalone directory and copies it
 * to resources/backend/ for inclusion in the Electron app.
 *
 * --onedir mode is MUCH faster to start than --onefile since no extraction needed.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '../../backend');
const RESOURCES_DIR = path.join(__dirname, '../resources/backend');
const IS_WIN = process.platform === 'win32';
const BUNDLE_NAME = 'ansikten-backend';
const EXEC_NAME = IS_WIN ? 'ansikten-backend.exe' : 'ansikten-backend';

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...options });
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isSymbolicLink()) {
      // Preserve symbolic links (needed for Python.framework on macOS)
      const linkTarget = fs.readlinkSync(srcPath);
      fs.symlinkSync(linkTarget, destPath);
    } else if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  console.log('=== Building Backend (onedir mode) ===\n');

  const specFile = path.join(BACKEND_DIR, 'ansikten-backend.spec');
  if (!fs.existsSync(specFile)) {
    console.error('Error: ansikten-backend.spec not found in backend/');
    process.exit(1);
  }

  console.log('Building with PyInstaller...');
  try {
    run('pyinstaller ansikten-backend.spec --noconfirm', { cwd: BACKEND_DIR });
  } catch (err) {
    console.error('\nPyInstaller build failed.');
    console.error(
      'Make sure you have activated your Python environment and installed dependencies:',
    );
    console.error('  pip install -e ".[build]"\n');
    process.exit(1);
  }

  const builtDir = path.join(BACKEND_DIR, 'dist', BUNDLE_NAME);
  const builtExec = path.join(builtDir, EXEC_NAME);

  if (!fs.existsSync(builtDir) || !fs.existsSync(builtExec)) {
    console.error(`Error: Expected output not found: ${builtDir}`);
    console.error('Make sure the spec file uses COLLECT for --onedir mode.');
    process.exit(1);
  }

  if (fs.existsSync(RESOURCES_DIR)) {
    console.log(`\nRemoving old resources/backend/...`);
    fs.rmSync(RESOURCES_DIR, { recursive: true, force: true });
  }

  console.log(`\nCopying ${BUNDLE_NAME}/ to resources/backend/`);
  copyDirSync(builtDir, RESOURCES_DIR);

  if (!IS_WIN) {
    const targetExec = path.join(RESOURCES_DIR, EXEC_NAME);
    fs.chmodSync(targetExec, 0o755);
  }

  const fileCount = fs.readdirSync(RESOURCES_DIR, { recursive: true }).length;
  console.log(`\nCopied ${fileCount} files to resources/backend/`);
  console.log('\n=== Backend build complete ===\n');
}

main();
