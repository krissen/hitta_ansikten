# AGENTS.md

Instructions for AI coding assistants working on this project.

---

## Coding Principles

### Core

- **KISS**: Keep It Simple, Stupid - prefer simple, readable solutions
- **DRY**: Don't Repeat Yourself - extract common logic
- **YAGNI**: You Aren't Gonna Need It - no speculative features

### Comments and Documentation

- All code must be commented for clarity
- All documentation and comments in **English**
- Docstrings for all public functions/classes
- Inline comments for non-obvious logic

---

## Code Style

### Python (Backend)

- Follow PEP 8
- Type hints where appropriate
- Descriptive variable names

```python
def process_image(path: str, options: dict = None) -> dict:
    """
    Process an image for face detection.

    Args:
        path: Path to the image file
        options: Optional processing options

    Returns:
        Dictionary with detected faces
    """
```

### JavaScript (Frontend)

- ES6+ features (async/await, destructuring)
- JSDoc comments for functions
- camelCase for variables/functions
- PascalCase for classes/components

```javascript
/**
 * Load and process an image file.
 * @param {string} path - Path to image
 * @returns {Promise<Object>} - Processing result
 */
async function loadImage(path) {
  // ...
}
```

### CSS

- Use CSS variables for all colors, spacing, fonts
- Test in both light and dark themes
- Follow patterns in [docs/dev/theming.md](docs/dev/theming.md)

---

## Git Commit Messages

Format: `(scope) description`

Scope priority:
1. `(filename)` - single file
2. `(feature)` - multi-file feature
3. `(type)` - fix, docs, style, refactor, perf, test, chore

Examples:
```
(utils.py) Add retry logic
(auth) Implement OAuth2 flow
(refactor) Replace print with logging
(docs) Update installation guide
```

**CRITICAL**: No Claude/AI references in commits or PRs.

---

## Documentation Maintenance

**Always assess if code changes require documentation updates.**

| Change Type | Documentation Action |
|-------------|---------------------|
| Bug fix | Usually no update needed |
| API change | Update [API Reference](docs/dev/api-reference.md) |
| Feature added | Update relevant user/dev docs |
| Feature removed | Update relevant user/dev docs |
| Config change | Update [Database](docs/dev/database.md) |
| UI change | Update [Workspace Guide](docs/user/workspace-guide.md) |
| Keyboard shortcut | Update [Workspace Guide](docs/user/workspace-guide.md) |

**Requirements:**
- **MINIMUM**: Note documentation gaps in [TODO.md](TODO.md) under "Kända brister > Dokumentation"
- **IDEAL**: Update the actual documentation alongside code changes

**Example TODO.md entry:**
```markdown
- [ ] API: `/api/new-endpoint` added but not documented in api-reference.md
```

---

## Project Documentation

| Topic | Location |
|-------|----------|
| Git workflow | [docs/dev/contributing.md](docs/dev/contributing.md) |
| Architecture | [docs/dev/architecture.md](docs/dev/architecture.md) |
| API | [docs/dev/api-reference.md](docs/dev/api-reference.md) |
| Database | [docs/dev/database.md](docs/dev/database.md) |
| Theming | [docs/dev/theming.md](docs/dev/theming.md) |
| Roadmap | [TODO.md](TODO.md) |
