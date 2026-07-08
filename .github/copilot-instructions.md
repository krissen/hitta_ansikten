# Copilot instructions

**Canonical source: [../CLAUDE.md](../CLAUDE.md).** The essentials are inlined
below because GitHub Copilot code-review does not follow links — when you change
shared guidance, update CLAUDE.md (canonical) and mirror anything essential here.

## Critical
- **No Claude/AI references** in commits, PR descriptions, code comments, or any public text.

## Coding principles
- KISS, DRY, YAGNI — prefer the simplest correct solution; reuse existing code.
- Comments and documentation in **English**; user-facing strings in **Swedish**.

## Code style
- **Python**: PEP 8; type hints where appropriate; docstrings for public functions/classes; inline comments for non-obvious logic.
- **JavaScript**: ES6+ (async/await, destructuring); JSDoc on functions; camelCase for variables/functions, PascalCase for classes/components.
- **CSS**: CSS variables for colors/spacing/fonts; test in light and dark themes (see `docs/dev/theming.md`).

## Git
- `master` is protected; `dev` is the main branch — branch features off `dev`, PR into `dev`.
- Commit format: `(scope) description` — `(filename)`, `(feature)`, or `(type)` (fix/docs/style/refactor/perf/test/chore).

## Testing (run before pushing)
- Backend: `cd backend && pytest`  (tests in `backend/tests/`)
- Frontend: `cd frontend && npm test`  (Vitest, `frontend/tests/`)
- Also test manually in the Electron app (light + dark themes).

## Documentation maintenance
| Change | Update |
|--------|--------|
| API | `docs/dev/api-reference.md` |
| UI / keyboard shortcut | `docs/user/workspace-guide.md` |
| Config | `docs/dev/database.md` |

Minimum: note gaps in `ROADMAP.md` under "Kända brister > Dokumentation". Ideal: update docs alongside code.

## Working process
- **One PR per thing**; don't fold unrelated work together.
- **Log TODOs immediately** in `ROADMAP.md` so they aren't lost between sessions.
- **Keep `ROADMAP.md` (roadmap) and `CHANGELOG.md` `[Unreleased]` current** with every change.
