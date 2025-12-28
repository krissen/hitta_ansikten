# AGENTS.md

## Automated Agent Instructions

Instructions for AI coding assistants working on this project.

### Coding Principles

- **KISS**: Keep It Simple, Stupid - prefer simple, readable solutions over clever ones
- **DRY**: Don't Repeat Yourself - extract common logic into reusable functions
- **YAGNI**: You Aren't Gonna Need It - don't add features speculatively

### Comments and Documentation

- All code must be commented for clarity
- All documentation and comments must be in **English**
- Docstrings for all public functions/classes
- Inline comments for non-obvious logic

### Code Style

**Backend (Python):**
- Follow PEP 8
- Type hints where appropriate
- Descriptive variable names

**Frontend (JavaScript/Electron):**
- Use ES6+ features (async/await, destructuring, etc.)
- JSDoc comments for functions
- Consistent naming: camelCase for variables/functions, PascalCase for classes

### Git Commit Messages

- Use conventional commits format: `(scope) description`
- Scopes: filename, feature name, or change type (fix, docs, style, refactor, perf, test, chore)
- **NO Claude references** in commit messages (see CLAUDE.md)
- Examples:
  - `(utils.py) Add retry logic`
  - `(auth) Implement OAuth2 flow`
  - `(refactor) Replace print with logging`

### Project Context

**For implementation details:** See `SESSION_SUMMARY.md` (local file) and `CLAUDE.md`
**For roadmap:** See `~/.claude/plans/mighty-brewing-pearl.md`
