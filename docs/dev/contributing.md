# Contributing

Guidelines for contributing to Hitta ansikten.

---

## Git Workflow

### Branch Strategy

```
master          # Protected, production-ready, only via PR
  ↑
dev             # Main development branch
  ↑
feature/*       # New features
fix/*           # Bug fixes
refactor/*      # Code refactoring
docs/*          # Documentation changes
```

### Creating a Feature Branch

```bash
# Start from dev
git checkout dev
git pull origin dev

# Create feature branch
git checkout -b feature/my-feature

# Work on changes...

# Commit with proper format
git add .
git commit -m "(scope) description"

# Push and create PR
git push origin feature/my-feature
```

### Commit Message Format

```
(scope) description
```

**Scope priority:**
1. `(filename)` - Single file changes
2. `(feature)` - Feature spanning multiple files
3. `(type)` - General change type

**Examples:**
```
(faceid_db.py) Add retry logic for database writes
(auth) Implement OAuth2 flow
(refactor) Replace print with logging
(docs) Update installation guide
```

### Pull Requests

1. Always PR to `dev`, not `master`
2. Use descriptive title and body
3. Reference related issues if any
4. Ensure CI passes (when available)

**PR Template:**
```markdown
## Summary
Brief description of changes.

## Changes
- Change 1
- Change 2

## Testing
How was this tested?

## Screenshots
If applicable.
```

---

## Important Rules

### Branch Protection

- **Never commit directly to master** - commits will be rejected
- **Never delete master or dev** - locally or remotely
- All changes to master go through PR from dev

### Commit Messages

- **No AI/Claude references** in commits or PRs
- **Never** add "Generated with Claude" footers
- **Never** add "Co-Authored-By: Claude" attribution
- Keep messages clear and descriptive
- Use imperative mood ("Add feature" not "Added feature")

---

## Code Style

### General Principles

From AGENTS.md:
- **KISS** - Keep It Simple, Stupid
- **DRY** - Don't Repeat Yourself
- All comments and documentation in English
- Comment code for clarity

### Python

- Follow PEP 8
- Use type hints where possible
- Docstrings for public functions

```python
def process_image(path: str, options: dict = None) -> dict:
    """
    Process an image for face detection.

    Args:
        path: Path to the image file
        options: Optional processing options

    Returns:
        Dictionary with detected faces and metadata
    """
    # Implementation...
```

### JavaScript

- ES6+ syntax
- JSX for React components
- Vanilla JS for modules (wrapped by React)

```javascript
// Good
const processImage = async (path) => {
  const result = await api.http.post('/api/detect', { path });
  return result.faces;
};

// Avoid
function processImage(path) {
  return new Promise((resolve) => {
    // ...
  });
}
```

### CSS

- Use CSS variables for all colors, spacing, fonts
- Follow component patterns in theming.md
- Test in both light and dark themes

```css
/* Good */
.button {
  background: var(--accent-primary);
  color: var(--text-on-accent);
  padding: var(--space-sm) var(--space-md);
}

/* Avoid */
.button {
  background: #38a818;
  color: white;
  padding: 8px 12px;
}
```

---

## Development Setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run CLI
./hitta_ansikten.py --help

# Run API server
python -m api.server
```

### Frontend

```bash
cd frontend
npm install
npm run build:workspace

# Run app
npx electron .

# Watch mode
npm run watch:workspace
```

---

## Testing

Currently no automated test suite exists. Testing is manual:

### Backend Testing

```bash
# Dry-run processing
./hitta_ansikten.py --simulate *.NEF

# Check database
./analysera_ansikten.py

# Inspect encodings
python inspect_encodings.py
```

### Frontend Testing

1. Start workspace: `npx electron .`
2. Test each module manually
3. Test in both light and dark themes
4. Test keyboard shortcuts
5. Check console for errors

### Contributing Tests

Setting up test infrastructure would be valuable:
- Backend: pytest
- Frontend: Jest or Vitest
- Integration: Playwright or Cypress

---

## Documentation

### Where to Document

| Type | Location |
|------|----------|
| User guides | `docs/user/` |
| Developer docs | `docs/dev/` |
| Agent instructions | `CLAUDE.md` |
| Code style | `AGENTS.md` |
| Project overview | `README.md` |

### Documentation Style

- Clear and concise
- Use code examples where helpful
- Keep up to date with code changes
- English for technical docs

---

## Review Process

### Before Requesting Review

1. Self-review your changes
2. Test functionality manually
3. Check for console errors/warnings
4. Ensure code follows style guidelines
5. Update documentation if needed

### During Review

- Respond to feedback constructively
- Ask questions if unclear
- Make requested changes promptly
- Push updates to same branch

### Merging

1. PR approved by reviewer
2. CI passes (when available)
3. No merge conflicts
4. Squash or rebase as appropriate

---

## Getting Help

1. Check existing documentation
2. Search codebase for similar implementations
3. Open a discussion issue
4. Ask specific, focused questions

**Good question format:**
```
I'm trying to [goal] in [file/component].

I've tried:
- [attempt 1]
- [attempt 2]

Current error:
[specific error]

What I don't understand:
[specific confusion]
```
