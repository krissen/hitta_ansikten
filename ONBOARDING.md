# Onboarding Plan for hitta_ansikten

Welcome to **hitta_ansikten**! This guide will help you get started with the project, whether you're new to development or an experienced developer learning a new stack.

## About This Project

**hitta_ansikten** is a monorepo combining:
- **Backend**: Python-based FastAPI server for face detection and recognition in RAW images (NEF files) using **InsightFace** (primary) with legacy dlib support
- **Frontend**: Electron-based modular workspace (Bildvisare) with FlexLayout for dockable panel management - the current, active interface for image review and annotation
- **Shared**: Common type definitions and API protocols between frontend and backend

**Legacy CLI**: The original `hitta_ansikten.py` terminal-based CLI tool is legacy code, maintained for backward compatibility but not the primary workflow.

**Current workflow**: Use `npx electron .` in the frontend directory to start the workspace - this is the modern, actively developed interface.

The project helps photographers efficiently identify, rename, and annotate images from events where many people appear across multiple photos.

## Customizing This Guide

This onboarding plan can be customized based on your background:

- **New to tech/development**: Follow all steps carefully, use the troubleshooting tips
- **Experienced developer new to Python**: Focus on Python-specific sections, skim environment setup
- **Experienced developer new to Electron/JavaScript**: Focus on frontend sections
- **Experienced in both stacks**: Jump directly to Phase 2 for codebase exploration

---

## Phase 1: Foundation

### 1.1 Environment Setup

#### Prerequisites

**Operating System:**
- macOS, Linux, or Windows (with WSL2 recommended)
- The project is primarily developed on `macOS/Linux`

**Required Software:**

1. **Git** (version 2.20+)
   ```bash
   git --version
   # If not installed: https://git-scm.com/downloads
   ```

2. **Python** (3.9 or newer)
   ```bash
   python3 --version
   # If not installed: https://www.python.org/downloads/
   ```

3. **Node.js and npm** (Node 16+ recommended)
   ```bash
   node --version
   npm --version
   # If not installed: https://nodejs.org/
   ```

4. **Python development headers** (required for face recognition library compilation)
   - **macOS**: Install Xcode Command Line Tools: `xcode-select --install`
   - **Ubuntu/Debian**: `sudo apt-get install python3-dev build-essential cmake`
   - **Fedora/RHEL**: `sudo dnf install python3-devel gcc-c++ cmake`

**Note on face recognition libraries**: The project uses **InsightFace** as the primary face recognition library (faster and more accurate). Legacy support for dlib is maintained for backward compatibility, but new development should target InsightFace.

#### Step-by-Step Setup

**1. Clone the repository:**
```bash
cd ~/dev  # or your preferred development directory
git clone https://github.com/krissen/hitta_ansikten.git
cd hitta_ansikten
```

**2. Set up the backend:**
```bash
cd backend

# Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

**Troubleshooting - Backend:**
- **InsightFace issues**: Ensure you have onnxruntime installed: `pip install onnxruntime`
  - For GPU support: `pip install onnxruntime-gpu` (requires CUDA)
- **Legacy dlib compilation fails**: Ensure you have CMake and C++ build tools installed
  - macOS: `brew install cmake`
  - Linux: `sudo apt-get install cmake` or `sudo dnf install cmake`
- **Module not found errors**: Ensure virtual environment is activated: `source venv/bin/activate`
- **Import errors**: Try reinstalling dependencies: `pip install --force-reinstall -r requirements.txt`

**3. Set up the frontend:**
```bash
cd ../frontend

# Install dependencies
npm install

# Build workspace modules
npm run build:workspace
```

**Troubleshooting - Frontend:**
- **npm install fails**: Clear cache with `npm cache clean --force` and retry
- **Build errors**: Delete `node_modules` and `package-lock.json`, then run `npm install` again
- **Electron won't start**: Check Node.js version (should be 16+)

**4. Verify the installation:**

Backend:
```bash
cd backend
# This should show help text without errors
./hitta_ansikten.py --help
```

Frontend:
```bash
cd frontend
# This should open the application window
npm start
```

### 1.2 Essential Documentation

Read these documents in order to build a solid foundation:

**Priority 1 - Must Read (15-20 minutes):**
1. **README.md** (root) - Project overview, architecture, basic usage
2. **AGENTS.md** (root) - Coding principles, style guidelines, commit message format
3. **CLAUDE.md** (root) - Git workflow, branch strategy, key commands

**Priority 2 - Important Context (20-30 minutes):**
4. **backend/README.md** or relevant sections in root README - Backend CLI workflow, data models
5. **frontend/README.md** - Frontend workspace modules, architecture
6. **shared/README.md** - Shared type definitions and API contracts
7. **todo_styling.md** - Current styling system and design philosophy

**Priority 3 - Reference Material (as needed):**
8. **shared/api-protocol.md** - API contract details (when working on integration)
9. **SESSION_SUMMARY.md** (if available locally) - Detailed implementation history

**Key Takeaways from Documentation:**
- Project structure: monorepo with backend, frontend, and shared directories
- Backend uses **InsightFace** (primary, fast, accurate) with legacy dlib support for backward compatibility
- Frontend uses Electron with **FlexLayout** for modular workspace panels
- Data stored in `$XDG_DATA_HOME/faceid/` (typically `~/.local/share/faceid/`)
- **Legacy CLI** (`hitta_ansikten.py`) vs **Current Workspace** (Electron frontend) - workspace is the actively developed interface
- Protected master branch - all work goes through feature branches from `dev`
- Commit messages follow `(scope) description` format
- **Important**: No Claude/AI references in commit messages

### 1.3 Understanding the Data Flow

**Backend Processing Flow:**
```
RAW Image (NEF) → Load with rawpy → Detect faces (InsightFace primary, dlib legacy) 
  → Match against database → User review (via workspace UI) → Save encodings 
  → Mark as processed → Optional: Rename file
```

**Frontend Workspace Flow:**
```
User opens workspace (npx electron .) → Backend starts (FastAPI) → WebSocket connection 
  → Modules load in FlexLayout → User interacts with panels → Real-time updates 
  → Communication via ModuleAPI
```

**Key Data Files** (located in `$XDG_DATA_HOME/faceid/`, typically `~/.local/share/faceid/`):
- `encodings.pkl` - Known faces database with backend metadata (InsightFace or dlib)
- `processed_files.jsonl` - Files already processed
- `attempt_stats.jsonl` - Processing attempt log
- `ignored.pkl` - Ignored face encodings
- `config.json` - User configuration overrides

**Note on data directory**: The base directory path is determined by the XDG Base Directory specification via `$XDG_DATA_HOME` environment variable, defaulting to `~/.local/share/faceid/` on most systems.

---

## Phase 2: Exploration

### 2.1 Codebase Discovery

**Start with high-level exploration:**

1. **Map the directory structure:**
```bash
cd ~/dev/hitta_ansikten

# See the overall structure
ls -la

# Backend structure
ls -la backend/
# Key files:
#   - hitta_ansikten.py (main CLI entry point, ~2000 lines)
#   - faceid_db.py (database layer)
#   - face_backends.py (pluggable backend system)
#   - hantera_ansikten.py (database management tool)
#   - analysera_ansikten.py (statistics viewer)

# Frontend structure
ls -la frontend/src/
# Key directories:
#   - main/ (Electron main process)
#   - renderer/ (UI components)
#   - renderer/components/ (workspace modules)
```

2. **Understand the imports** (important note from problem statement):
   - The project has carefully structured imports
   - **Don't assume things are undefined** - check import statements thoroughly
   - Backend uses relative imports from `faceid_db` and `face_backends`
   - Frontend uses ES6 modules with explicit imports

3. **Browse key files** (in recommended order):
```bash
# Backend core
view backend/faceid_db.py        # Database abstraction
view backend/face_backends.py    # Backend interface
view backend/hitta_ansikten.py --lines 1-100  # Main entry point

# Frontend core
view frontend/main.js            # Electron main process
view frontend/src/renderer/workspace.js  # Workspace initialization
```

### 2.2 Running Existing Scripts

**Important Note:** This project currently does not have automated tests. Testing is done manually via CLI workflows and manual verification. Setting up a test infrastructure would be a valuable contribution!

**Backend CLI Testing (Legacy):**

**Note**: The `hitta_ansikten.py` CLI is **legacy code** maintained for backward compatibility. The current, actively developed interface is the frontend workspace (Electron app). However, the CLI still works and can be useful for understanding the backend processing flow.

1. **Analyze existing data** (if any):
```bash
cd backend
./analysera_ansikten.py
```

2. **Inspect encodings database**:
```bash
python inspect_encodings.py
# Note: This script provides debug information about the encoding database
```

3. **Test with sample images** (if you have NEF files):
```bash
# Dry-run mode (doesn't actually process)
./hitta_ansikten.py --simulate *.NEF

# Process images (creates preview) - legacy workflow
./hitta_ansikten.py sample_image.NEF
```

**Frontend Workspace Testing (Current):**

**This is the primary, actively developed interface** - use this for your main workflow and development.

1. **Start workspace in development mode:**
```bash
cd frontend
BILDVISARE_WORKSPACE=1 npx electron .
# Or: npm start
```

2. **Explore the modules:**
   - Image Viewer - Canvas-based image rendering
   - Review Module - Face detection UI (currently uses mock data)
   - Log Viewer - Real-time logs
   - Original View - Side-by-side comparison

3. **Test the FlexLayout:**
   - Drag panels to rearrange
   - Close and reopen modules
   - Check if layout persists (localStorage)
   - Close and reopen modules
   - Check if layout persists (localStorage)

**Understanding the workflow:**
- **Legacy**: Backend CLI (`hitta_ansikten.py`) - Terminal-based, interactive prompts, keyboard-driven
- **Current**: Frontend Workspace (Electron) - GUI-based, mouse and keyboard, modular panels with FlexLayout
- **Integration**: WebSocket communication, real-time updates between frontend and backend API

### 2.3 Beginner-Friendly First Tasks

Here are some concrete tasks suitable for getting started, organized by difficulty:

#### 🟢 **Easy Tasks** (1-2 hours, good first contributions)

**Documentation Improvements:**
1. **Add missing docstrings**
   - File: `backend/faceid_db.py`
   - Task: Add docstrings to functions that lack them
   - Skills: Basic Python, documentation
   - Look for functions without `"""docstring"""` and add clear explanations

2. **Improve inline comments**
   - Files: `backend/hitta_ansikten.py` (search for complex logic)
   - Task: Add clarifying comments to complex sections
   - Skills: Code reading, English writing

3. **Update README examples**
   - File: `README.md`
   - Task: Add more detailed examples for common workflows
   - Skills: Markdown, understanding the CLI

**Code Quality:**
4. **Fix typos in comments/strings**
   - Search: `grep -r "TODO\|FIXME" backend/ frontend/`
   - Task: Find and fix obvious typos or improve unclear comments
   - Skills: Basic text editing

5. **Add type hints**
   - Files: `backend/faceid_db.py`, `backend/face_backends.py`
   - Task: Add Python type hints to function signatures that lack them
   - Skills: Python type annotations
   - Example: `def load_database() -> dict:` instead of `def load_database():`

#### 🟡 **Medium Tasks** (3-6 hours, requires some context)

**Functionality Enhancements:**
6. **Add keyboard shortcut documentation**
   - File: New file `KEYBOARD_SHORTCUTS.md`
   - Task: Document all keyboard shortcuts for both CLI and workspace
   - Skills: Testing, documentation, Markdown
   - Extract shortcuts from code and user-facing behavior

7. **Improve error messages**
   - Files: `backend/hitta_ansikten.py`, `backend/faceid_db.py`
   - Task: Make error messages more helpful with suggestions
   - Skills: Python exceptions, user experience
   - Example: Instead of "File not found", add "File not found: image.NEF. Make sure the file exists in the current directory."

8. **Add progress indicators**
   - File: `backend/hitta_ansikten.py`
   - Task: Add percentage completion for batch processing
   - Skills: Python, terminal output
   - Use existing multiprocessing queue to track progress

**Testing & Validation:**
9. **Create example data generator**
   - File: New script `backend/generate_test_data.py`
   - Task: Generate synthetic test data for development (mock encodings, test images)
   - Skills: Python, Pillow, numpy
   - Useful for testing without real RAW files

10. **Add configuration validation**
    - File: `backend/faceid_db.py`
    - Task: Validate user config.json on load and show helpful errors
    - Skills: Python, JSON schema validation

**Note on Testing:**
The project currently **does not have an automated test suite**. This is an excellent opportunity for contribution! Consider:
- Setting up pytest for backend testing
- Adding unit tests for core functions (faceid_db, face_backends)
- Creating integration tests for the CLI workflow
- Setting up Jest or similar for frontend testing
- Adding end-to-end tests for the workspace

See the "Advanced Tasks" section below for test infrastructure setup as a potential project.

#### 🔴 **Advanced Tasks** (6+ hours, requires deep understanding)

11. **Set up test infrastructure**
    - Files: New directory `backend/tests/`, `frontend/tests/`
    - Task: Set up pytest (backend) and Jest/Mocha (frontend) with initial tests
    - Skills: Testing frameworks, test design, CI/CD basics
    - Impact: High - establishes foundation for quality assurance
    - Details:
      - Backend: `pip install pytest`, create `tests/test_faceid_db.py`, `tests/test_face_backends.py`
      - Frontend: `npm install --save-dev jest`, create basic component tests
      - Add npm script: `"test": "jest"` and pytest configuration
      - Write tests for core functions (database load/save, encoding comparison)

12. **Implement additional backend**
    - File: `backend/face_backends.py`
    - Task: Add support for another face recognition library
    - Skills: Python, face recognition APIs, abstract classes

13. **Add new workspace module**
    - Directory: `frontend/src/renderer/components/`
    - Task: Create a new module (e.g., Statistics Dashboard)
    - Skills: JavaScript, Electron, React, FlexLayout, CSS

14. **Implement real face detection integration**
    - Files: Frontend modules + backend API
    - Task: Replace mock data with real face detection results
    - Skills: Full-stack, WebSocket, API integration

### 2.4 Exploring Specific Open Issues

**Finding issues to work on:**

1. **Check GitHub issues** (if repository has public issues):
```bash
# Using GitHub CLI (if installed)
gh issue list --label "good first issue"
gh issue list --label "help wanted"
```

2. **Look for TODOs in code:**
```bash
cd ~/dev/hitta_ansikten
grep -r "TODO" backend/ frontend/ | grep -v node_modules
grep -r "FIXME" backend/ frontend/ | grep -v node_modules
```

3. **Check the styling TODO list:**
   - File: `todo_styling.md`
   - Contains detailed plans for frontend theming system
   - Multiple phases outlined, good for frontend developers

**Current known areas needing work:**
- **Testing**: ⚠️ **High priority** - No automated test suite exists yet (great first project!)
- **Frontend**: Integration of real face detection (Phase 2 complete, Phase 3 in progress)
- **Backend**: InsightFace backend testing and refinement
- **Documentation**: Keyboard shortcuts, troubleshooting guides, API documentation
- **Accessibility**: WCAG compliance for frontend themes
- **CI/CD**: No continuous integration setup yet

---

## Phase 3: Integration

### 3.1 Learning Team Processes

#### Git Workflow

**Branch Strategy:**
```bash
# Main branches
master  # Protected, only via PR, production-ready
dev     # Main development branch, all features merge here

# Feature branches
feature/description   # New features
fix/description       # Bug fixes
refactor/description  # Code refactoring
docs/description      # Documentation changes
```

**Typical workflow:**
```bash
# 1. Start from dev
git checkout dev
git pull origin dev

# 2. Create feature branch
git checkout -b feature/add-keyboard-shortcuts-doc

# 3. Make changes
# ... edit files ...

# 4. Commit with proper message format
git add .
git commit -m "(docs) Add keyboard shortcuts documentation"
# Format: (scope) description
# Scopes: filename, feature name, or change type

# 5. Push to origin
git push origin feature/add-keyboard-shortcuts-doc

# 6. Create PR to dev (not master)
# Use GitHub web interface or gh CLI:
gh pr create --base dev --title "Add keyboard shortcuts documentation" --body "Documents all keyboard shortcuts for CLI and workspace"

# 7. After PR merged, cleanup
git checkout dev
git pull origin dev
git branch -d feature/add-keyboard-shortcuts-doc
```

**Important Rules:**
- ⚠️ **Never commit directly to master** - commits will be rejected
- ⚠️ **No AI/Claude references** in commit messages or PRs
- ✅ Use clear, descriptive commit messages
- ✅ Keep commits focused and atomic
- ✅ Always branch from `dev`, not `master`

#### Code Review Process

**Before requesting review:**
1. **Self-review your changes:**
   ```bash
   git diff dev...HEAD  # See all changes since branching from dev
   ```

2. **Test your changes:**
   - Backend: Run the affected scripts/commands
   - Frontend: Start the workspace and test UI changes
   - Both: Check for console errors/warnings

3. **Follow style guidelines:**
   - Python: PEP 8 compliance
   - JavaScript: ES6+, consistent naming
   - Comments: All in English
   - Documentation: Clear and complete

**During review:**
- Respond to feedback constructively
- Ask questions if requirements are unclear
- Make requested changes promptly
- Push updates to the same branch (PR updates automatically)

### 3.2 Making Your First Contribution

**Step-by-step guide for your first PR:**

**Example: Adding docstrings to faceid_db.py**

1. **Choose a manageable task:**
   - Start with documentation or simple code improvements
   - Example: "Add docstrings to load_database() and save_database()"

2. **Create your branch:**
```bash
cd ~/dev/hitta_ansikten
git checkout dev
git pull origin dev
git checkout -b docs/add-faceid-db-docstrings
```

3. **Make your changes:**
```python
# Before (in faceid_db.py):
def load_database():
    # ... existing code ...

# After:
def load_database():
    """
    Load all persistent data from the faceid database directory.
    
    Loads known faces encodings, ignored faces, processed files log,
    and attempt statistics from ~/.local/share/faceid/.
    
    Returns:
        tuple: (known_faces, ignored_faces, processed_files, attempt_log)
            - known_faces (dict): Person names mapped to face encoding data
            - ignored_faces (list): Face encodings marked as ignored
            - processed_files (dict): Files already processed with their hashes
            - attempt_log (list): Historical processing attempts
    
    Example:
        >>> known_faces, ignored, processed, log = load_database()
        >>> print(f"Found {len(known_faces)} people in database")
    """
    # ... existing code ...
```

4. **Test your changes:**
```bash
cd backend
python3 -c "from faceid_db import load_database; help(load_database)"
# Should show your new docstring
```

5. **Commit with proper format:**
```bash
git add faceid_db.py
git commit -m "(faceid_db.py) Add comprehensive docstrings to database functions"
```

6. **Push and create PR:**
```bash
git push origin docs/add-faceid-db-docstrings

# Create PR via GitHub web UI or:
gh pr create --base dev \
  --title "Add docstrings to faceid_db.py functions" \
  --body "Adds comprehensive docstrings to load_database() and save_database() functions in faceid_db.py. Improves code documentation and developer experience."
```

7. **Respond to review feedback:**
   - Make requested changes
   - Push to same branch
   - PR updates automatically

### 3.3 Building Confidence Through Early Wins

**Progressive Learning Path:**

**Week 1: Setup and Exploration**
- ✅ Complete Phase 1 (environment setup, documentation)
- ✅ Complete Phase 2 (codebase exploration)
- ✅ Run all scripts and understand the workflow
- 🎯 Goal: Understand the project structure

**Week 2: First Contributions**
- ✅ Pick an easy task (documentation improvement)
- ✅ Create your first PR
- ✅ Experience the review process
- 🎯 Goal: Complete your first merged PR

**Week 3-4: Building Skills**
- ✅ Tackle medium difficulty tasks
- ✅ Start exploring code you're interested in (backend or frontend)
- ✅ Ask questions when stuck
- 🎯 Goal: Feel comfortable with the codebase

**Month 2+: Deeper Work**
- ✅ Take on advanced tasks
- ✅ Propose new features or improvements
- ✅ Help review others' PRs
- 🎯 Goal: Become a confident contributor

**Tips for Success:**

1. **Start small:**
   - Documentation fixes are perfect first PRs
   - Build confidence before tackling complex features

2. **Ask questions:**
   - No question is too basic
   - Better to ask than make incorrect assumptions
   - Use PR comments for specific technical questions

3. **Read existing code:**
   - Learn patterns by studying similar implementations
   - Check how existing features are structured

4. **Iterate based on feedback:**
   - Code review feedback is a learning opportunity
   - Don't take criticism personally
   - Apply lessons to future PRs

5. **Document your learning:**
   - Keep notes on patterns you discover
   - Contribute those insights back (update docs)

### 3.4 Understanding the Domain

**Face Recognition Concepts:**

If you're new to face recognition, here's what you need to know:

1. **Face Detection**: Finding faces in an image (bounding boxes)
2. **Face Encoding**: Converting a face to a numerical representation (128 or 512 dimensions)
3. **Face Recognition**: Comparing encodings to identify people
4. **Distance Metric**: How similar two encodings are (lower = more similar)

**Libraries Used:**
- **InsightFace** (Primary, recommended): 512-dimensional encodings, cosine distance (threshold ~0.4)
  - **Much faster** (1.5-3x) and more accurate than dlib
  - Better detection in profiles, low light, small faces, motion blur
  - This is what you should develop against for new features
- **dlib** (Legacy): 128-dimensional encodings, Euclidean distance (threshold ~0.54)
  - Kept for backward compatibility with existing databases
  - Avoid developing new features against this library

**Important for developers**: Always develop against **InsightFace** unless you're specifically working on legacy compatibility. The project maintains dual support, but InsightFace is the future.

**RAW Image Processing:**

NEF files are Nikon's RAW format:
- Much larger than JPEG (16-bit vs 8-bit color)
- Requires special libraries (rawpy) to load
- Processing is slower but quality is higher
- Project uses multi-resolution strategy for efficiency

**Workflow Concepts:**

- **Batch Processing**: Process many images at once
- **Interactive Review**: User confirms/rejects matches
- **Encoding Database**: Saved face data for future comparisons
- **File Hashing**: SHA1 to track files even after renaming

---

## Appendix: Quick Reference

### Common Commands

**Backend (Legacy CLI):**
```bash
# Note: These commands use the legacy CLI tool hitta_ansikten.py
# For current workflow, use the frontend workspace (npx electron .)

# Process images (legacy)
./hitta_ansikten.py *.NEF

# Rename already processed images (legacy)
./hitta_ansikten.py --rename .

# Database management
./hantera_ansikten.py

# View statistics
./analysera_ansikten.py
```

**Frontend (Current):**
```bash
# Start workspace - this is the primary interface
BILDVISARE_WORKSPACE=1 npx electron .

# Development mode
npm run dev

# Build workspace modules
npm run build:workspace
```

**Git:**
```bash
# Start new feature
git checkout dev && git pull origin dev
git checkout -b feature/my-feature

# Commit changes
git add .
git commit -m "(scope) description"

# Push and create PR
git push origin feature/my-feature
gh pr create --base dev
```

### Useful Links

- **Repository**: https://github.com/krissen/hitta_ansikten
- **Companion Project**: https://github.com/krissen/bildvisare
- **InsightFace** (primary): https://github.com/deepinsight/insightface
- **face_recognition library** (legacy dlib wrapper): https://github.com/ageitgey/face_recognition
- **Electron docs**: https://www.electronjs.org/docs/latest/
- **FlexLayout**: https://github.com/caplin/FlexLayout

### Getting Help

**When you're stuck:**

1. **Check documentation first:**
   - README files
   - CLAUDE.md for workflows
   - Code comments and docstrings

2. **Search the code:**
   ```bash
   grep -r "relevant term" backend/ frontend/
   ```

3. **Look at similar implementations:**
   - Find existing features that are similar
   - See how they're implemented

4. **Ask for guidance:**
   - Open a discussion issue on GitHub
   - Ask specific, focused questions
   - Include what you've tried

**Good question format:**
```
I'm trying to [goal] in [file/component].

I've tried:
- [attempt 1]
- [attempt 2]

Current error/problem:
[specific error or unexpected behavior]

What I don't understand:
[specific confusion]
```

### Configuration Files

**Backend config** (`$XDG_DATA_HOME/faceid/config.json`, typically `~/.local/share/faceid/config.json`):
```json
{
  "detection_model": "hog",
  "backend": {
    "type": "insightface"
  },
  "match_threshold": 0.4,
  "image_viewer_app": "Bildvisare"
}
```

**Note**: The configuration directory is determined by the XDG Base Directory specification. Set `$XDG_DATA_HOME` environment variable to customize the location.

**Frontend config** (localStorage):
- Layout state
- Theme preferences
- Module settings

---

## Conclusion

You're now ready to start contributing to hitta_ansikten! Remember:

- **Take your time** - the project is complex, and that's okay
- **Start small** - documentation and simple fixes are valuable
- **Ask questions** - the team wants to help you succeed
- **Have fun** - you're building something useful!

Welcome to the team! 🎉

---

*This onboarding guide is maintained by the hitta_ansikten community. If you find errors or have suggestions for improvement, please submit a PR!*
