# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bildvisare is an Electron-based image viewer for macOS with a unique capability: it monitors image files for changes and automatically refreshes the display.

**Relationship to hitta_ansikten:**
This app serves as a companion viewer to [hitta_ansikten](https://github.com/krissen/hitta_ansikten) (located at `~/dev/hitta_ansikten`), a face detection application that processes photos. The typical workflow is:
1. `hitta_ansikten` processes images, detects faces, and exports results
2. `bildvisare` displays the processed images and automatically refreshes when files are updated
3. User can press 'O' to open the original NEF file side-by-side for comparison
4. Both windows can be synchronized for zoom/pan, enabling detailed comparison of before/after

The application supports a master-slave architecture where:
- **Master window**: Displays processed images and watches for updates
- **Slave window**: Displays original images (with NEF-to-JPG conversion support)
- Windows can be synchronized (zoom, pan, scroll) or detached for independent viewing

## Core Architecture

### File Structure
- `main.js` - Electron main process: window management, file watching, NEF conversion, IPC handling
- `renderer.js` - Renderer process: image display, zoom controls, view synchronization
- `index.html` - Minimal HTML shell for the image viewer
- `package.json` - Project dependencies (Electron only)
- `scripts/nef2jpg.py` - Python script for converting Nikon RAW (NEF) files to JPG
- `assets/` - Application assets and resources

### Key Features
1. **File Monitoring**: Watches image files and reloads when modified (1-second polling in renderer.js:324-347)
2. **Dual Instance Support**: Main and slave instances communicate via IPC and status files
3. **NEF Conversion**: Automatically converts Nikon RAW files to JPG using external Python script
4. **View Synchronization**: Master and slave windows sync zoom/pan in real-time (can be detached with 'X' key)
5. **Status Files**: Communication between instances via JSON files in `~/Library/Application Support/bildvisare/`

### Status File System
- `status.json` - Current state of main window (file opened, timestamps)
- `original_status.json` - Slave window status (source NEF, exported JPG path)
- Main instance polls `original_status.json` every 1.5s to auto-launch slave viewers

### External Dependencies

**hitta_ansikten repository:**
- Location: `~/dev/hitta_ansikten`
- This is the companion face detection application that bildvisare is designed to work with
- Bildvisare works as a viewer for images processed by hitta_ansikten

**Python dependencies for NEF conversion:**
- Python interpreter: `/Users/krisniem/.local/share/miniforge3/envs/hitta_ansikten/bin/python3` (hardcoded in main.js:41)
- Conversion script: `scripts/nef2jpg.py` (located in this repository)
- Required Python packages: `rawpy`, `pillow` (PIL)
- The script converts Nikon RAW (NEF) files to JPG for display in the slave viewer
- Install dependencies: `pip install rawpy pillow`

**Testing NEF conversion:**
- Test NEF files available in: `~/Pictures/nerladdat/`
- Test script directly:
  ```bash
  # Basic conversion
  python3 scripts/nef2jpg.py ~/Pictures/nerladdat/[some-file].NEF /tmp/output.jpg

  # With verbose logging
  python3 scripts/nef2jpg.py --verbose ~/Pictures/nerladdat/[some-file].NEF /tmp/output.jpg

  # With custom quality
  python3 scripts/nef2jpg.py --quality 85 ~/Pictures/nerladdat/[some-file].NEF /tmp/output.jpg
  ```

## Development Commands

### Run the app
```bash
npx electron .
```

### Build for distribution
```bash
# Install electron-packager if needed
npm install --save-dev electron-packager

# Build for macOS (both architectures)
npx electron-packager . Bildvisare --platform=darwin --arch=x64,arm64 --overwrite
```

### Open with a specific image
```bash
npx electron . /path/to/image.jpg
```

## Git Workflow

**IMPORTANT:** The `master` branch is locked for direct pushes. All changes must be made through the `dev` branch and pull requests.

### Standard workflow:
1. Make changes on the `dev` branch
2. Commit changes to `dev`
3. Push to `dev`
4. Create a pull request from `dev` to `master`
5. Merge after review

Never attempt to push directly to `master`.

## Key Keyboard Controls

Implemented in both main.js and renderer.js:
- **O** - Open slave viewer with original image (triggers NEF conversion if needed)
- **ESC** - Close all slave instances and current window
- **Q** - Close current window
- **+** - Zoom in (hold for continuous zoom)
- **-** - Zoom out (hold for continuous zoom)
- **=** - Reset to 1:1 zoom
- **A** - Auto-fit zoom mode
- **X** - (Slave only) Toggle detached mode to stop syncing with master

## IPC Communication

### Main → Renderer
- `show-wait-overlay` - Display conversion waiting overlay
- `hide-wait-overlay` - Hide conversion overlay
- `apply-view` - Apply zoom/scroll from other window

### Renderer → Main
- `bild-visad` - Image loaded notification
- `sync-view` - Send zoom/scroll state to sync with other window

## Development Notes

- Debug logging controlled by `DEBUG` constant in both main.js and renderer.js
- Zoom implementation uses two modes: "auto" (fit-to-window) and "manual" (fixed size with scroll)
- Zoom factor stored separately from display mode for seamless switching
- Mouse position tracking enables zoom-to-cursor behavior
- Slave instances launched via `spawn()` with `--slave` flag and `BILDVISARE_SLAVE=1` env var

## Code Style (from AGENTS.md)

- Follow KISS and DRY principles
- All comments and documentation must be in English
- Comment all code for clarity
