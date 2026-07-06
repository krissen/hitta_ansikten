# Building Ansikten

Guide for building distributable packages of Ansikten.

---

## Overview

Ansikten consists of two parts:
- **Frontend**: Electron app (JavaScript/React)
- **Backend**: FastAPI server (Python)

For distribution, the Python backend is bundled into a standalone executable using PyInstaller, then packaged together with the Electron app.

---

## Prerequisites

### All Platforms

- Node.js 20+
- Python 3.11+
- Git

### macOS

```bash
# Xcode Command Line Tools
xcode-select --install

# Homebrew packages (build tooling for InsightFace's native deps)
brew install cmake
```

### Linux (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y cmake build-essential
```

### Windows

- Visual Studio Build Tools (for native dependencies)
- CMake

---

## Development Setup

### Backend

```bash
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Linux/macOS
# or: .venv\Scripts\activate  # Windows

# Install dependencies (from pyproject.toml)
pip install -e ".[dev]"
```

### Frontend

```bash
cd frontend
npm install
```

### Running in Development

```bash
# Terminal 1: Frontend (auto-starts backend)
cd frontend
npm start
```

Or manually:

```bash
# Terminal 1: Backend
cd backend
source venv/bin/activate
python -m uvicorn api.server:app --host 127.0.0.1 --port 5001

# Terminal 2: Frontend
cd frontend
npm run dev
```

---

## Building for Distribution

### Quick Build (Current Platform)

```bash
cd frontend
npm run build
```

Output in `frontend/dist/`.

### Platform-Specific Builds

```bash
# macOS (Intel + Apple Silicon)
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

### Full Build Process (Manual)

If you need more control over the build:

#### 1. Build Backend Executable

```bash
cd backend
source venv/bin/activate
pip install pyinstaller

# Build standalone executable
pyinstaller ansikten-backend.spec

# Output: dist/ansikten-backend (or .exe on Windows)
```

#### 2. Prepare Backend for Electron

```bash
# Copy to frontend resources
mkdir -p frontend/resources/backend
cp backend/dist/ansikten-backend frontend/resources/backend/

# Make executable (Linux/macOS)
chmod +x frontend/resources/backend/ansikten-backend
```

#### 3. Build Electron App

```bash
cd frontend
npm run build:workspace  # Build React components
npm run build            # Package with electron-builder
```

---

## Build Outputs

### macOS

| File | Description |
|------|-------------|
| `Ansikten-{version}-arm64.dmg` | Apple Silicon installer |
| `Ansikten-{version}-x64.dmg` | Intel installer |
| `Ansikten-{version}-arm64-mac.zip` | Apple Silicon portable |
| `Ansikten-{version}-x64-mac.zip` | Intel portable |

### Windows

| File | Description |
|------|-------------|
| `Ansikten-Setup-{version}.exe` | NSIS installer |
| `Ansikten-{version}.exe` | Portable executable |

### Linux

| File | Description |
|------|-------------|
| `Ansikten-{version}.AppImage` | Universal package |
| `ansikten_{version}_amd64.deb` | Debian/Ubuntu package |

---

## GitHub Releases

Releases are automated via GitHub Actions. To create a release:

```bash
# Tag the release
git tag v1.0.0
git push origin v1.0.0
```

The workflow will:
1. Build backend with PyInstaller on each platform
2. Bundle backend with Electron app
3. Create draft release with all artifacts

Then manually publish the draft release on GitHub.

> **The `v*` tag is authoritative at build time.** The workflow's "Set version
> from tag" step runs `npm pkg set version=${GITHUB_REF_NAME#v}`, overwriting
> `frontend/package.json` with the tag's number in CI. The versions committed in
> the repo are not what ship — but keep them in sync anyway: bump
> `frontend/package.json` **and** `backend/pyproject.toml` (plus the `version=`
> string in `backend/api/server.py`, surfaced by `/health`) together to the tag's
> number when releasing. See [release-guide.md](release-guide.md) for the process.

---

## Troubleshooting

### PyInstaller Issues

**Missing modules at runtime:**

Add to `hiddenimports` in `ansikten-backend.spec`:

```python
hiddenimports = [
    # ... existing
    'missing_module',
]
```

**Large executable size:**

Add unused modules to `excludes`:

```python
excludes=[
    'tkinter',
    'matplotlib',
    # ...
]
```

### Electron Builder Issues

**Code signing errors (macOS):**

For local builds without signing:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run build:mac
```

**Windows Defender blocks build:**

Add project folder to Windows Defender exclusions.

### InsightFace Installation

InsightFace is the face recognition backend. If installation fails:

```bash
# macOS
brew install cmake
pip install onnxruntime insightface

# Linux
sudo apt-get install cmake
pip install onnxruntime insightface
```

> **Note:** dlib/face_recognition is deprecated since January 2026. Use InsightFace instead.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANSIKTEN_PORT` | Backend server port | `5001` |
| `ANSIKTEN_PYTHON` | Python path (dev only) | Auto-detect |
| `ANSIKTEN_DEBUG` | Verbose backend-service logging (`1` = on) | Off |
| `CSC_IDENTITY_AUTO_DISCOVERY` | Disable code signing | - |

---

## Architecture Notes

### Development Mode

```
Electron App
    └── backend-service.js
            └── spawns: python -m uvicorn api.server:app
```

### Production Mode (Packaged)

```
Ansikten.app/
├── Contents/
│   ├── MacOS/
│   │   └── Ansikten          # Electron
│   └── Resources/
│       └── backend/
│           └── ansikten-backend  # PyInstaller bundle
```

The Electron app detects if it's running packaged (`app.isPackaged`) and spawns the bundled backend executable instead of system Python.
