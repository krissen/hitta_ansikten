# Hitta ansikten

Face recognition tool for event photography.

---

## What is this?

Hitta ansikten helps photographers identify and rename people in large collections of RAW images (NEF). It consists of:

- **Backend** - Python CLI for batch processing + FastAPI server
- **Frontend** - Electron workspace for interactive review

The tool is designed for sports events, school activities, or any context where many people appear across multiple photos.

---

## Quick Start

### Backend

```bash
cd backend
pip install -r requirements.txt

# Process images
./hitta_ansikten.py 2024*.NEF

# Rename based on detected faces
./hitta_ansikten.py --rename --processed .
```

### Frontend

```bash
cd frontend
npm install
npm run build:workspace
npx electron .
```

Backend auto-starts on `http://127.0.0.1:5001`

---

## Documentation

### For Users

- [Getting Started](docs/user/getting-started.md) - Installation and first run
- [CLI Reference](docs/user/cli-reference.md) - Command line usage
- [Workspace Guide](docs/user/workspace-guide.md) - GUI usage and shortcuts

### For Developers

- [Architecture](docs/dev/architecture.md) - System overview
- [API Reference](docs/dev/api-reference.md) - REST and WebSocket API
- [Database](docs/dev/database.md) - Data files and formats
- [Theming](docs/dev/theming.md) - CSS variable system
- [Contributing](docs/dev/contributing.md) - Git workflow and code style
- [Onboarding](docs/dev/onboarding.md) - New developer guide

---

## Features

- **Batch face detection** in RAW files (NEF)
- **Face recognition** against known person database
- **Interactive review** - confirm, reject, or manually name faces
- **Automatic file renaming** based on detected people
- **Pluggable backends** - InsightFace (primary) or dlib (legacy)
- **Modular workspace** - GIMP-like dockable panel UI
- **Real-time updates** via WebSocket

---

## Project Structure

```
hitta_ansikten/
├── backend/          # Python CLI + FastAPI server
├── frontend/         # Electron workspace (FlexLayout)
├── shared/           # Common type definitions
└── docs/             # Documentation
    ├── user/         # User guides
    └── dev/          # Developer guides
```

---

## Data Storage

All persistent data in `~/.local/share/faceid/`:

| File | Description |
|------|-------------|
| `encodings.pkl` | Known faces database |
| `processed_files.jsonl` | Files already processed |
| `attempt_stats.jsonl` | Processing attempt log |
| `config.json` | User configuration |

---

## Technology

**Backend:**
- Python 3.9+
- InsightFace / face_recognition (dlib)
- FastAPI, WebSocket, rawpy

**Frontend:**
- Electron
- React + FlexLayout
- Canvas-based image rendering

---

## License

MIT
