# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bildvisare is an Electron-based modular workspace for image viewing and face review. It serves as the frontend companion to [hitta_ansikten](https://github.com/krissen/hitta_ansikten), a face detection application.

**Architecture:**
- **Default mode**: Modular workspace with FlexLayout (React-based docking panels)
- **Legacy mode**: Single-window image viewer (set `BILDVISARE_LEGACY=1`)

The typical workflow:
1. `hitta_ansikten` (backend) processes images, detects faces
2. Bildvisare displays the processed images with face bounding boxes
3. User reviews faces, confirms/rejects matches
4. Changes saved back to the database

## Development Commands

### Run the app (default: workspace mode)
```bash
cd frontend
npm run build:workspace  # Build FlexLayout bundle
npx electron .
```

### Run legacy mode
```bash
BILDVISARE_LEGACY=1 npx electron .
```

### Run with Dockview instead of FlexLayout
```bash
BILDVISARE_DOCKVIEW=1 npx electron .
```

### Watch mode (auto-rebuild on changes)
```bash
npm run watch:workspace
```

### Build for distribution
```bash
npm install --save-dev electron-packager
npx electron-packager . Bildvisare --platform=darwin --arch=x64,arm64 --overwrite
```

## Core Architecture

### File Structure

**Main Process:**
- `main.js` - Bootstrap (workspace vs legacy mode selector)
- `src/main/index.js` - Workspace main process
- `src/main/menu.js` - Application menu with keyboard shortcuts
- `src/main/backend-service.js` - FastAPI backend auto-start

**Renderer (FlexLayout Workspace):**
- `src/renderer/workspace-flex.html` - FlexLayout HTML entry
- `src/renderer/workspace/flexlayout/` - React components
  - `FlexLayoutWorkspace.jsx` - Main layout component
  - `ModuleWrapper.jsx` - Wrapper for vanilla JS modules
  - `layouts.js` - Preset layout configurations
  - `index.jsx` - React entry point

**Modules (vanilla JS, wrapped by React):**
- `src/renderer/modules/image-viewer/` - Canvas-based image display
- `src/renderer/modules/review-module/` - Face review UI
- `src/renderer/modules/log-viewer/` - Frontend + backend logs
- `src/renderer/modules/original-view/` - NEF comparison
- `src/renderer/modules/statistics-dashboard/` - Stats display
- `src/renderer/modules/database-management/` - DB admin

**Build:**
- `scripts/build-workspace.js` - esbuild bundler for JSX
- `src/renderer/workspace/dist/` - Build output (gitignored)

### Backend Integration

The workspace auto-starts a FastAPI backend on `http://127.0.0.1:5001`:
- REST API for database operations
- WebSocket for real-time updates
- Backend code in `../backend/` directory

## Key Keyboard Shortcuts

**Navigation:**
- `Cmd+Arrow` - Navigate between panels (position-based)
- `Cmd+Shift+]` / `[` - Add/remove column
- `Cmd+Shift+}` / `{` - Add/remove row

**View:**
- `+` / `-` - Zoom in/out (hold for continuous)
- `=` - Reset to 1:1 zoom
- `0` - Auto-fit
- `b` - Toggle single/all bounding boxes
- `B` - Toggle boxes on/off
- `c` / `C` - Enable/disable auto-center on face

**File:**
- `Cmd+O` - Open image file
- `Cmd+R` - Reload window
- `Cmd+Shift+R` - Hard reload

**Layout Templates:**
- `Cmd+1` - Review mode
- `Cmd+2` - Comparison mode
- `Cmd+3` - Full image
- `Cmd+4` - Statistics mode

## Layout System

FlexLayout uses a tree-based model:
```
Row (vertical or horizontal)
├── TabSet (container for tabs)
│   └── Tab (individual panel)
└── TabSet
    └── Tab
```

**Available preset layouts:**
- `review` - Review (15%) | Image Viewer (85%)
- `review-with-logs` - Review | Image above, full-width Log Viewer below
- `comparison` - Image Viewer (50%) | Original View (50%)
- `full-review` - 2x2 grid with all modules
- `database` - Database Management | Statistics

## Git Workflow

**IMPORTANT:** The `master` branch is protected.

1. Make changes on feature branches or `dev`
2. Commit and push
3. Create PR to `master`
4. Merge after review

## Module API

Each module receives a `ModuleAPI` instance with:
```javascript
api.emit(eventName, data)      // Broadcast to other modules
api.on(eventName, callback)    // Listen for events
api.http.get/post(path, data)  // Backend HTTP calls
api.ws.on/off(event, callback) // WebSocket events
api.workspace.openModule(id)   // Open another module
api.ipc.send/invoke(channel)   // IPC to main process
```

## Code Style

- Follow KISS and DRY principles
- All comments and documentation in English
- Comment code for clarity
- Use JSX for React components, vanilla JS for modules
