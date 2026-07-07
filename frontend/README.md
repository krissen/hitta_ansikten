# Ansikten — Frontend

Electron + React (FlexLayout) desktop app for viewing and annotating faces in
RAW images. The app auto-starts the FastAPI backend on port 5001.

## Develop

```bash
npm install
npm run build:workspace   # Build the React workspace bundle
npx electron .            # Run the app (auto-starts backend)
npm run watch:workspace   # Rebuild on change
npm test                  # Vitest (tests/)
```

## Build for distribution

```bash
npm run build:mac         # or build:win / build:linux
```

See [frontend/CLAUDE.md](CLAUDE.md) for the file structure and module map, and
the [main repository](https://github.com/krissen/ansikten) plus
[docs/dev/](../docs/dev/) for full documentation.
