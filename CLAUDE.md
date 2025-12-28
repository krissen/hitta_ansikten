# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**hitta_ansikten** is a monorepo combining:
1. **Backend**: Terminal-based batch face detection tool (Python, dlib/InsightFace)
2. **Frontend**: Modular workspace for image review and annotation (Electron + Dockview)

### Backend (CLI Tool)
Terminal-based batch face detection and recognition for processing large collections of RAW images (NEF files). Uses face_recognition (dlib) or InsightFace to detect faces, match against a database, and rename files based on who appears in them.

### Frontend (Bildvisare Workspace)
GIMP-like modular workspace with dockable panels for interactive face review:
- **Image Viewer**: Canvas-based rendering with zoom/pan
- **Review Module**: Face detection UI with confirm/reject
- **Log Viewer**: Real-time backend/frontend logs
- **Original View**: Side-by-side NEF comparison

**For detailed workspace implementation:** See `SESSION_SUMMARY.md` (local file)
**For roadmap:** See `~/.claude/plans/mighty-brewing-pearl.md`

## Git Workflow

**IMPORTANT: Repository Rules**
- The `master` branch is protected and requires all changes to be made through pull requests
- **DO NOT commit directly to master** - commits will be rejected on push
- Always create a feature branch for changes: `git checkout -b feature/description`
- Push the branch and create a PR: `git push -u origin feature/description`
- Follow the commit message conventions from `~/.claude/CLAUDE.md`

**CRITICAL: Commit and PR Message Rules**
- **ABSOLUTELY NO Claude references** in commit messages or PR descriptions
- **NEVER** add "Generated with Claude Code" or similar footers
- **NEVER** add "Co-Authored-By: Claude" or similar attribution
- This rule is STRICTLY ENFORCED and violations are not acceptable

## Key Commands

### Main Processing
```bash
# Process new images
./hitta_ansikten.py 2024*.NEF

# Process and rename in one step
./hitta_ansikten.py --rename 2024*.NEF

# Rename already-processed files
./hitta_ansikten.py --rename --processed .

# Simulate rename (dry-run)
./hitta_ansikten.py --rename --simulate *.NEF

# Reprocess specific file (clears old matches)
./hitta_ansikten.py --fix 250612_153040.NEF

# Archive attempt statistics
./hitta_ansikten.py --archive
```

### Management Tools
```bash
# Interactive database management (rename/merge/delete people)
./hantera_ansikten.py

# View statistics and analysis
./analysera_ansikten.py

# Correct/review faces with interactive UI
./ratta_ansikten.py

# Refine face detections
./forfina_ansikten.py

# Update encodings with file hashes
python update_encodings_with_filehash.py 2024*.NEF
```

### Dependencies
```bash
pip install -r requirements.txt
```

## Architecture

### Core Components

**hitta_ansikten.py** (main entry point, ~2000 lines)
- Multi-resolution detection strategy: downsample (2800px) → midsample (4500px) → fullres (8000px)
- Multiprocessing: background worker preprocesses images while main loop handles user interaction
- Interactive review flow with terminal autocomplete (prompt_toolkit)
- Three processing modes: normal batch, --rename, --fix
- Preprocessing cache system for resuming interrupted runs
- Pluggable backend system supporting multiple face recognition engines

**faceid_db.py** (database layer)
- Centralized database I/O for all tools
- Data location: `~/.local/share/faceid/` (XDG standard)
- Handles both legacy and current data formats with automatic migration
- Auto-migrates bare numpy arrays to dict format with backend metadata

**face_backends.py** (backend abstraction layer)
- Abstract `FaceBackend` interface for pluggable backends
- `DlibBackend`: Wraps face_recognition (dlib), 128-dim encodings, Euclidean distance
- `InsightFaceBackend`: Uses InsightFace, 512-dim encodings, cosine distance
- Factory pattern for backend creation from config

### Data Files

All persistent data stored in `~/.local/share/faceid/`:

| File | Format | Purpose |
|------|--------|---------|
| `encodings.pkl` | pickle | Known faces: `{name: [{"encoding": ndarray, "file": str, "hash": str}, ...]}` |
| `ignored.pkl` | pickle | List of face encodings to ignore |
| `hardneg.pkl` | pickle | Hard negative examples (faces that should never match certain people) |
| `processed_files.jsonl` | jsonl | Files already processed: `{"name": str, "hash": str}` per line |
| `attempt_stats.jsonl` | jsonl | Detailed log of all processing attempts with labels and metadata |
| `metadata.json` | json | Version and migration metadata |
| `config.json` | json | User configuration overrides |
| `hitta_ansikten.log` | text | Debug/error log |

### Processing Flow

1. **Parse input**: Expand globs, filter by SUPPORTED_EXT ([".nef", ".NEF"])
2. **Skip processed**: Check `processed_files.jsonl` via file hash (SHA1)
3. **Preprocess worker** (background process):
   - Load RAW → RGB with rawpy
   - Try multiple resolutions (configurable in config.json)
   - Detect faces with `face_recognition.face_locations()`
   - Match against known_faces database (distance threshold: 0.6 default)
   - Draw labeled preview image with PIL
   - Queue results to main process
4. **Main loop** (foreground):
   - Display preview via external viewer (default: "Bildvisare")
   - Present matches to user for review
   - User actions: accept (`a`), ignore (`i`), retry higher res (`r`), manual name (`m`), etc.
   - Save new encodings to database
   - Mark file as processed
5. **Rename phase**: Extract person names from attempt_stats.jsonl and rename files to `YYMMDD_HHMMSS_PersonA_PersonB.NEF`

### Configuration System

Default config in `hitta_ansikten.py:DEFAULT_CONFIG`, user overrides in `~/.local/share/faceid/config.json`.

Key settings:
- `detection_model`: "hog" (fast, CPU) or "cnn" (accurate, GPU)
- `max_downsample_px`, `max_midsample_px`, `max_fullres_px`: Resolution thresholds for multi-attempt strategy
- `auto_ignore`: Auto-ignore unmatched faces without review
- `auto_ignore_on_fix`: Auto-ignore low-confidence matches in --fix mode
- `image_viewer_app`: External app for previews ("Bildvisare", "feh", etc.)
- `match_threshold`: Face matching distance threshold (default 0.54)

**Backend Configuration:**
- `backend.type`: "dlib" (default) or "insightface"
- `backend.insightface.model_name`: "buffalo_s" (fast), "buffalo_m", "buffalo_l" (accurate, default)
- `backend.insightface.ctx_id`: -1 (CPU), 0+ (GPU device ID)
- `threshold_mode`: "auto" (use match_threshold for active backend) or "manual" (backend-specific thresholds)
- `backend_thresholds`: Per-backend distance thresholds (dlib uses Euclidean ~0.54, InsightFace uses cosine ~0.4)

### Preprocessing Cache

Located in `./preprocessed_cache/` (relative to working directory):
- Enables resuming after interruption
- Each image gets a SHA1-based cache file: `{hash}.pkl` containing `(path, attempt_results)`
- Preview images saved as `{hash}_a{attempt_index}.jpg`
- Cache loaded on startup, deleted after main loop consumes entry

### Helper Scripts

- **analysera_ansikten.py**: Statistics from attempt_stats.jsonl (faces per person, files processed, etc.)
- **hantera_ansikten.py**: Interactive menu for DB maintenance (rename person, merge people, undo recent files)
- **ratta_ansikten.py**: Review/correct existing matches
- **forfina_ansikten.py**: Refine face crops/detections
- **update_encodings_with_filehash.py**: Migrate old encodings to include file hashes
- **migrera_processed.py**: Migrate processed_files from old formats
- **rakna_spelare.py**: Count specific people in images
- **inspect_encodings.py**: Debug tool for encoding database

**Note**: `nef2jpg.py` has been moved to the bildvisare repo as it's only used by the image viewer.

### Naming Conventions

Expected filename format: `YYMMDD_HHMMSS[-N][_names].NEF`
- Date/time prefix required for most operations
- `-N` suffix for burst sequences
- `_names` suffix added during rename (e.g., `250612_153040_Anna_Bert.NEF`)

## Code Principles

From AGENTS.md:
- All code must follow KISS and DRY principles
- All code should be commented for clarity
- All documentation and comments must be in English

Note: User-facing strings in code are currently in Swedish.

## Testing

No automated test suite currently exists. Testing is manual via CLI workflows.

## External Dependencies

**Companion app for image viewing**: Default is [Bildvisare](https://github.com/krissen/bildvisare), configurable via `image_viewer_app` setting.
- Development folder: `~/dev/bildvisare`
- Used for displaying face detection previews and original images during interactive review

## Important Implementation Details

- **Multiprocessing safety**: Worker process communicates via Queue, main process owns all DB writes. Worker initializes its own backend instance.
- **Signal handling**: SIGINT handler ensures graceful shutdown, saves preprocessed cache
- **Reserved commands**: Single-character shortcuts (i, a, r, n, o, m, x) cannot be used as person names
- **Encoding format**:
  - Dlib backend: 128-dimensional encodings (dlib ResNet model), Euclidean distance
  - InsightFace backend: 512-dimensional encodings (buffalo models), cosine distance
  - Each encoding stored with backend metadata: `{"encoding": ndarray, "backend": str, "backend_version": str, "created_at": str, ...}`
- **Backend filtering**: Encodings only compared against same backend (dlib vs dlib, insightface vs insightface)
- **Backward compatibility**: Legacy bare numpy arrays auto-migrated to dict format with "dlib" backend on load
- **File hashing**: SHA1 used throughout for file identity (avoids reprocessing renamed files)
- **Archive mechanism**: When detection settings change (model, resolutions), old attempt_stats.jsonl archived automatically

## Backend Switching

**To switch from dlib to InsightFace:**

1. Install InsightFace (if not already installed):
   ```bash
   pip install insightface onnxruntime
   ```

2. Edit config:
   ```bash
   nano ~/.local/share/faceid/config.json
   ```

   Change:
   ```json
   {
     "backend": {
       "type": "insightface"
     }
   }
   ```

3. Run program - new encodings use InsightFace, old dlib encodings remain accessible

4. Optional: Gradually migrate by reprocessing images with `--fix` to create InsightFace encodings

**Performance:**
- InsightFace (buffalo_l): generally higher verification accuracy than dlib on LFW and similar benchmarks
- 1.5-3x faster detection with better accuracy
- Better detection in: profiles, low light, small faces, motion blur

## Frontend Workspace (Bildvisare)

### Running the Workspace

```bash
cd frontend
BILDVISARE_WORKSPACE=1 npx electron .
```

Backend auto-starts on `http://127.0.0.1:5000`

### Architecture

**One Source of Truth:** `SESSION_SUMMARY.md` (local file) contains complete implementation details for Phases 1-3.

**Key Components:**
- Dockview-core for panel management
- FastAPI backend with WebSocket
- Canvas-based image rendering
- Module communication via ModuleAPI

**Modules:**
- `image-viewer/` - Canvas rendering, zoom/pan
- `review-module/` - Face review UI (currently uses mock data)
- `log-viewer/` - Frontend + backend logs
- `original-view/` - NEF side-by-side comparison

**Current State (Phase 3 complete):**
- All UI modules implemented
- Backend API with mock data
- WebSocket real-time communication
- Layout persistence (localStorage)

**Next Steps:**
- Integrate real face detection (replace mock data)
- OR Phase 4: User preferences and enhanced persistence

### Keyboard Shortcuts

**Image Viewer:**
- `Cmd+O` - Open file
- `+`/`-` - Zoom (hold for continuous)
- `=` - 1:1 zoom
- `0` - Auto-fit (changed from `A`)

**Original View:**
- `X` - Toggle sync mode

### Legacy Mode

```bash
cd frontend
BILDVISARE_WORKSPACE=0 npx electron .
```

Runs original dual-window viewer (backward compatible).

