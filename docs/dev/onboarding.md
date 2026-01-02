# Onboarding

Guide for new developers getting started with Hitta ansikten.

---

## About This Project

**Hitta ansikten** is a monorepo for face recognition in event photography:

- **Backend**: Python FastAPI server + CLI for batch processing
- **Frontend**: Electron workspace with FlexLayout for image review
- **Primary backend**: InsightFace (faster, more accurate)
- **Legacy support**: dlib (for backward compatibility)

---

## Prerequisites

### Required Software

| Software | Version | Check |
|----------|---------|-------|
| Git | 2.20+ | `git --version` |
| Python | 3.9+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |

### Platform-Specific

**macOS:**
```bash
xcode-select --install
```

**Ubuntu/Debian:**
```bash
sudo apt-get install python3-dev build-essential cmake
```

**Fedora/RHEL:**
```bash
sudo dnf install python3-devel gcc-c++ cmake
```

---

## Setup

### 1. Clone Repository

```bash
cd ~/dev
git clone https://github.com/krissen/hitta_ansikten.git
cd hitta_ansikten
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**Troubleshooting:**
- **InsightFace issues**: `pip install onnxruntime`
- **Module not found**: Ensure venv is activated
- **Compilation fails**: Install CMake and C++ tools

### 3. Frontend Setup

```bash
cd frontend
npm install
npm run build:workspace
```

**Troubleshooting:**
- **npm install fails**: `npm cache clean --force`
- **Build errors**: Delete `node_modules` and retry
- **Electron won't start**: Check Node.js version

### 4. Verify Installation

```bash
# Backend
cd backend
./hitta_ansikten.py --help

# Frontend
cd frontend
npx electron .
```

---

## Essential Reading

### Priority 1 (15 min)

1. **README.md** - Project overview
2. **AGENTS.md** - Code style principles
3. **CLAUDE.md** - Git workflow

### Priority 2 (20 min)

4. **docs/dev/architecture.md** - System design
5. **docs/dev/api-reference.md** - API endpoints
6. **docs/user/workspace-guide.md** - UI overview

### Priority 3 (as needed)

7. **docs/dev/database.md** - Data formats
8. **docs/dev/theming.md** - CSS system
9. **docs/dev/contributing.md** - PR process

---

## Key Concepts

### Face Recognition

1. **Detection**: Find faces in image (bounding boxes)
2. **Encoding**: Convert face to vector (128/512 dimensions)
3. **Recognition**: Compare encodings to identify people
4. **Distance**: Similarity measure (lower = more similar)

### Backends

| Backend | Encoding | Distance | Threshold | Status |
|---------|----------|----------|-----------|--------|
| InsightFace | 512-dim | Cosine | ~0.4 | Primary |
| dlib | 128-dim | Euclidean | ~0.54 | Legacy |

**Always develop against InsightFace** unless working on legacy compatibility.

### Data Flow

```
RAW Image (NEF)
    ↓
Load with rawpy
    ↓
Detect faces (InsightFace)
    ↓
Match against database
    ↓
User review (workspace UI)
    ↓
Save encodings
    ↓
Optional: Rename file
```

---

## Project Structure

```
hitta_ansikten/
├── backend/
│   ├── hitta_ansikten.py     # Main CLI (~2000 lines)
│   ├── faceid_db.py          # Database layer
│   ├── face_backends.py      # Backend abstraction
│   ├── api/
│   │   ├── server.py         # FastAPI entry
│   │   ├── routes/           # REST endpoints
│   │   └── websocket/        # WebSocket handlers
│   └── hantera_ansikten.py   # DB management tool
│
├── frontend/
│   ├── main.js               # Electron entry
│   ├── src/
│   │   ├── main/             # Main process
│   │   └── renderer/
│   │       ├── workspace/    # FlexLayout React
│   │       └── modules/      # UI modules
│   └── scripts/
│       └── build-workspace.js
│
├── docs/
│   ├── user/                 # User documentation
│   └── dev/                  # Developer documentation
│
└── shared/                   # Common definitions
```

---

## Common Tasks

### Run Backend CLI

```bash
cd backend
source venv/bin/activate

# Process images
./hitta_ansikten.py *.NEF

# Dry-run rename
./hitta_ansikten.py --rename --simulate .

# Database management
./hantera_ansikten.py
```

### Run Frontend

```bash
cd frontend

# Development
npm run build:workspace
npx electron .

# Watch mode (auto-rebuild)
npm run watch:workspace
```

### Run API Server

```bash
cd backend
source venv/bin/activate
python -m api.server
# Server at http://127.0.0.1:5001
```

---

## First Contribution Ideas

### Easy (1-2 hours)

1. **Add docstrings** to `faceid_db.py` functions
2. **Improve comments** in complex code sections
3. **Fix typos** in comments or strings
4. **Add type hints** to function signatures

### Medium (3-6 hours)

5. **Document keyboard shortcuts** comprehensively
6. **Improve error messages** with helpful suggestions
7. **Add progress indicators** for long operations
8. **Create test data generator** for development

### Advanced (6+ hours)

9. **Set up test infrastructure** (pytest, Jest)
10. **Add new workspace module**
11. **Implement real face detection integration**

---

## Workflow Example

### Adding a Feature

```bash
# 1. Start from dev
git checkout dev
git pull origin dev

# 2. Create branch
git checkout -b feature/my-feature

# 3. Make changes
# ... edit files ...

# 4. Test
# Backend: ./hitta_ansikten.py --help
# Frontend: npx electron .

# 5. Commit
git add .
git commit -m "(scope) Add my feature"

# 6. Push
git push origin feature/my-feature

# 7. Create PR to dev
gh pr create --base dev
```

---

## Tips for Success

1. **Start small** - Documentation fixes are perfect first PRs
2. **Read existing code** - Learn patterns from similar features
3. **Test in both themes** - Light and dark mode
4. **Ask questions** - No question is too basic
5. **Check imports** - Don't assume things are undefined

---

## Getting Help

1. Check documentation in `docs/`
2. Search codebase: `grep -r "term" backend/ frontend/`
3. Look at similar implementations
4. Open a discussion issue

**Good question format:**
```
I'm trying to [goal] in [file].

I've tried:
- [attempt 1]
- [attempt 2]

Error: [specific error]
```

---

## Links

- **Repository**: https://github.com/krissen/hitta_ansikten
- **InsightFace**: https://github.com/deepinsight/insightface
- **FlexLayout**: https://github.com/caplin/FlexLayout
- **Electron**: https://www.electronjs.org/docs/
