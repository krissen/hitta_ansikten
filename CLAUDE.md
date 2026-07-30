# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Canonical agent-instructions file.** This is the single source of truth for
> AI coding assistants on this repo. [AGENTS.md](AGENTS.md) (Codex) and
> [.github/copilot-instructions.md](.github/copilot-instructions.md) (Copilot)
> are thin pointers to this file — put shared guidance here, not in those.

---

## Project Overview

**Ansikten** - Face recognition for event photography.

- **Backend**: FastAPI server (`backend/api/`)
- **Frontend**: Electron + React with FlexLayout (`frontend/`)
- **Legacy CLI**: `hitta_ansikten.py` (batch processing, not used by GUI)
- **Data**: `~/.local/share/faceid/`

---

## Critical Rules

### Git Workflow

- **master is protected** - all changes via PR
- **dev is main branch** - feature branches from dev
- **Never commit to master directly**
- **Never delete master or dev**

```bash
git checkout dev
git checkout -b feature/my-feature
# ... work ...
git commit -m "(scope) description"
git push origin feature/my-feature
# Create PR to dev
```

### Commit Messages

- **NO Claude references** in commits or PRs
- **Never** add "Generated with Claude" footers
- **Never** add "Co-Authored-By: Claude"

Format: `(scope) description`
- `(filename)` for single file
- `(feature)` for multi-file feature
- `(type)` for general changes (fix, docs, refactor)

---

## Quick Commands

### Frontend (primary development)

```bash
cd frontend
npm install
npm run build:workspace                    # Build React workspace
npm run watch:workspace                    # Watch mode for development
npx electron .                             # Run app (auto-starts backend on :5001)
```

### Backend API

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m api.server                       # Run API server standalone
```

### Legacy CLI

```bash
cd backend
./hitta_ansikten.py 2024*.NEF              # Batch process images
./hitta_ansikten.py --simulate *.NEF       # Dry-run (no writes)
```

### Utility Scripts

```bash
cd backend
./rakna_spelare.py 250601*.jpg             # Player photo statistics
./rakna_spelare.py -p 250601*.jpg          # Per-match breakdown
./filer2mappar.py ./photos                 # Organize files into folders
```

### Building for Distribution

```bash
cd backend
pip install pyinstaller
pyinstaller ansikten-backend.spec          # Creates dist/ansikten-backend/

cd frontend
npm run build:mac                          # macOS .dmg
npm run build:win                          # Windows .exe
npm run build:linux                        # Linux .AppImage/.deb
```

---

## Architecture

### Backend (FastAPI on port 5001)

```
backend/api/
├── server.py              # FastAPI app entry, CORS, startup (all routers mounted under /api/v1)
├── routes/
│   ├── detection.py       # /api/v1/detect-faces, /api/v1/confirm-identity
│   ├── management.py      # /api/v1/management/rename-person, merge, delete
│   ├── database.py        # /api/v1/database/people, names
│   ├── files.py           # /api/v1/files/rename, rename-preview, manual-suffix
│   ├── refinement.py      # /api/v1/refinement/preview, apply
│   ├── statistics.py      # /api/v1/statistics/summary
│   ├── preprocessing.py   # /api/v1/preprocessing/*
│   ├── player_count.py    # /api/v1/players/count, exclusions
│   ├── culling.py         # /api/v1/culling/* (photo culling / trash)
│   ├── imports.py         # /api/v1/import/volumes, run
│   ├── rename_nef.py      # /api/v1/rename-nef/preview, execute
│   ├── startup.py         # /api/v1/startup/status
│   └── status.py          # /api/v1/status
├── services/
│   ├── db_store.py             # FaceDBStore: process-wide DB authority (mutate/read/flush)
│   ├── matching_index.py       # Version-invalidated per-backend candidate matrices
│   ├── detection_service.py    # Core detection logic, face matching
│   ├── management_service.py   # Database operations (rename, merge)
│   ├── refinement_service.py   # Outlier detection, centroid refinement
│   ├── rename_service.py       # File rename logic
│   ├── statistics_service.py   # Processing statistics
│   └── startup_service.py      # Backend startup coordination
└── websocket/
    └── progress.py        # ws://localhost:5001/ws/progress
```

Core package `backend/core/` (shared by the legacy CLI and the API):
- `core/db.py` - Database layer (encodings.pkl, processed_files.jsonl, db_meta.json). `faceid_db` is a shim aliased to it.
- `core/config.py`, `core/matching.py`, `core/image.py` - config / matching / image utils (shims: `cli_config`, `cli_matching`, `cli_image`).
- `core/attempts.py`, `core/naming.py`, `core/playerstats.py`, `core/files.py` - attempt log, naming, player stats, extension sets.
- `core/labels.py` - review-label vocabulary: `IGNORE_MARKERS`, `CANONICAL_IGNORE_MARKER`, `is_ignore_name` / `is_ignore_label`. Every "is this label a person?" check goes through it — never re-inline the marker set or the `#N\n` prefix handling.
- `face_backends.py` - InsightFace abstraction

### Frontend (Electron + React)

```
frontend/
├── main.js → src/main/index.js    # Electron main process
├── src/main/
│   ├── index.js                   # Window management, IPC, file watching
│   └── backend-service.js         # Auto-starts FastAPI server
├── src/renderer/
│   ├── workspace/flexlayout/      # FlexLayoutWorkspace + workspaceCommands (router), moduleRegistry (catalog), workflowSteps/workflows/workspaceMorph/stepLayoutMemory, layouts, menuCommands, tabsetUtils
│   ├── components/                # React module components (*.jsx)
│   │   ├── ReviewModule.jsx       # Face review UI (keyboard nav, autocomplete)
│   │   ├── review/                #   sub-parts: FaceCard, reviewActions, useReviewKeyboard
│   │   ├── CullingModule.jsx      # Photo culling / trash
│   │   ├── culling/               #   sub-parts: FilterBar, StatsPanel, useCullingPreview
│   │   ├── FileQueueModule.jsx    # File queue, preprocessing, rename
│   │   ├── fileQueue/             #   sub-parts: queueReducer, prefs, useNefRename, usePreprocessing
│   │   ├── ImageViewer.jsx        # Canvas rendering with zoom/pan
│   │   └── ...                    # Statistics, Database, RefineFaces, Import, RenameNef, …
│   ├── hooks/                     # Shared hooks (useActiveTabset, useWebSocket, useAutoRefresh, …)
│   ├── shared/
│   │   └── api-client.js          # HTTP + WebSocket client (singleton)
│   └── context/
│       └── ModuleAPIContext.jsx   # Inter-module communication
```

### Module Communication

```javascript
// Inter-module events
api.emit('image-loaded', { path });
api.on('face-selected', callback);

// Backend HTTP
const result = await api.http.post('/api/v1/detect-faces', { image_path });

// WebSocket
api.ws.on('progress', callback);
```

---

## Key Concepts

### Face Recognition Backends

| Backend | Encoding | Threshold | Status |
|---------|----------|-----------|--------|
| InsightFace | 512-dim | ~0.45 | Only supported backend |

> **dlib is deprecated.** InsightFace is the sole active backend. Legacy dlib
> encodings are left untouched at startup — there is no boot-time scan. The CLI
> forces InsightFace even if dlib is configured. Removal tooling
> (`DlibBackend`, the remove-dlib refinement endpoint, `scripts/archive/rensa_dlib.py`) still
> exists so any legacy dlib encodings can be cleaned up on demand.

Config in `~/.local/share/faceid/config.json`:
```json
{
  "backend": { "type": "insightface" }
}
```

### Data Files

| File | Purpose |
|------|---------|
| `encodings.pkl` | Known faces database |
| `processed_files.jsonl` | Files already processed |
| `attempt_stats.jsonl` | Review attempt log |

---

## Gotchas

- RAW files are `.NEF` (Nikon)
- Filename format: `YYMMDD_HHMMSS[-N][_names].NEF`
- SHA1 hash used for file identity
- Encodings only compared against same backend type
- Backend auto-starts with Electron; use `python -m api.server` for standalone
- DetectionService caches results by file hash (check cache when debugging)
- GitHub Actions releases triggered by `v*` tags (e.g., `v1.0.1`)
- Launch CLI: `ansikten [faces|culling|import] [--clear] PATH...` — the `bin/ansikten` script forwards args to the app. Parsing lives in `frontend/src/main/cli-args.js` (pure grammar); the launch *decision* is made **after** path expansion in `frontend/src/main/launch-command.js` (`resolveLaunchCommand`) so a path that expands to nothing still yields an explicit command (open the step empty) instead of stranding in the default layout. The resolved command is delivered to the renderer via the `workspace-ready`/`workspace-command` handshake and dispatched as a typed intent (`queue-files` (faces) / `open-culling` (culling) / `open-import` (import, optional destination)) through the single command router `workspace/flexlayout/workspaceCommands.js`. No verb = faces; faces and culling are separate working sets. `import` takes an optional *destination* folder (source card is autodetected); a bare `ansikten import` still opens the module

---

## Code Principles

- **KISS** - Simple, readable solutions
- **DRY** - Extract common logic
- **YAGNI** - No speculative features
- Comments and docs in English
- User-facing strings in Swedish

### Testing

Automated tests exist — run them before pushing:

```bash
cd backend && pytest        # backend/tests/ (configured in backend/pyproject.toml)
cd frontend && npm test     # Vitest, frontend/tests/
```

The suite is small, so also test manually:
- Run `npx electron .` and test modules in both light/dark themes
- Check DevTools console for errors
- Legacy CLI: `./hitta_ansikten.py --simulate *.NEF`

### Documentation Maintenance

**Always assess if code changes require documentation updates.**

| Change type | Documentation action |
|-------------|----------------------|
| Bug fix | Usually no update needed |
| API change | Update [API Reference](docs/dev/api-reference.md) |
| Feature added/removed | Update relevant user/dev docs |
| Config change | Update [Database](docs/dev/database.md) |
| UI change / keyboard shortcut | Update [Workspace Guide](docs/user/workspace-guide.md) |

- **MINIMUM**: Note gaps in [ROADMAP.md](ROADMAP.md) under "Kända brister > Dokumentation"
- **IDEAL**: Update the actual docs alongside the code

---

## Code Style

### Python (Backend)
- PEP 8; type hints where appropriate; descriptive names.
- Docstrings for public functions/classes; inline comments for non-obvious logic.

### JavaScript (Frontend)
- ES6+ (async/await, destructuring); JSDoc on functions.
- camelCase for variables/functions, PascalCase for classes/components.

### CSS
- CSS variables for colors/spacing/fonts; test in light **and** dark themes.
- Follow patterns in [docs/dev/theming.md](docs/dev/theming.md).

---

## Working Process

- **One PR per thing** — one focused PR per discrete change; don't fold unrelated work together.
- **Log TODOs immediately** — when the user adds work, or a gap is found, add it to [ROADMAP.md](ROADMAP.md) right away so it isn't lost with the session.
- **Keep roadmap + changelog current** — every change updates [ROADMAP.md](ROADMAP.md) (the roadmap) and [CHANGELOG.md](CHANGELOG.md) `[Unreleased]` as part of the work, so any new session can resume from the docs alone.
- **Two roadmap-like files, distinct roles** — [ROADMAP.md](ROADMAP.md) (repo root) is the living, forward-looking backlog / known-issues / tech-debt across all horizons; [docs/dev/performance-plan.md](docs/dev/performance-plan.md) is a narrower, release-scoped plan (sprints, deliverables, Definition of Done) for a performance release. General planning goes in ROADMAP.md; put sprint/DoD detail for a perf release in performance-plan.md. [docs/dev/followup-plan-2026-07.md](docs/dev/followup-plan-2026-07.md) is the same kind of narrower plan for the toolchain / action-catalog / test-harness block; like the perf plan it is meant to be finished and deleted, not maintained.

---

## Related Docs

- [Architecture](docs/dev/architecture.md)
- [API Reference](docs/dev/api-reference.md)
- [Database](docs/dev/database.md)
- [Theming](docs/dev/theming.md)
- [UX Principles](docs/dev/ux-principles.md)
- [Accessibility](docs/dev/accessibility.md)
- [Contributing](docs/dev/contributing.md)
- [Performance Plan](docs/dev/performance-plan.md)
- [Follow-up Plan 2026-07](docs/dev/followup-plan-2026-07.md)
