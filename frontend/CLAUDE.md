# Frontend CLAUDE.md

Frontend-specific instructions. See root [CLAUDE.md](../CLAUDE.md) for general project guidelines.

---

## Quick Start

```bash
npm run build:workspace
npx electron .

# Watch mode
npm run watch:workspace
```

---

## File Structure

```
frontend/
├── main.js                    # Electron entry
├── src/
│   ├── main/
│   │   ├── index.js           # Main process
│   │   ├── menu.js            # App menu + shortcuts
│   │   ├── cli-args.js        # CLI arg parsing/routing
│   │   └── backend-service.js # FastAPI auto-start
│   └── renderer/
│       ├── workspace-flex.html
│       ├── workspace/
│       │   └── flexlayout/    # Workspace: layouts, moduleRegistry, menuCommands, tabsetUtils
│       ├── components/        # React module components (*.jsx)
│       │   ├── review/        #   ReviewModule sub-parts (FaceCard, reviewActions, keyboard)
│       │   ├── culling/       #   CullingModule sub-parts (FilterBar, StatsPanel, preview hook)
│       │   └── fileQueue/     #   FileQueueModule sub-parts (reducer, prefs, rename/preprocess hooks)
│       ├── hooks/             # Shared hooks (useActiveTabset, useWebSocket, …)
│       ├── context/           # React context providers
│       └── shared/            # Shared utilities (api-client, etc.)
└── scripts/
    └── build-workspace.js     # esbuild bundler
```

---

## Modules

All modules are React components in `src/renderer/components/`:

| Module | File | Description |
|--------|------|-------------|
| ImageViewer | `ImageViewer.jsx` | Canvas rendering, zoom/pan |
| ReviewModule | `ReviewModule.jsx` | Face review UI, keyboard nav |
| FileQueueModule | `FileQueueModule.jsx` | File queue, preprocessing, rename |
| RefineFacesModule | `RefineFacesModule.jsx` | Outlier detection, centroid refinement |
| DatabaseManagement | `DatabaseManagement.jsx` | Rename/merge/delete persons |
| StatisticsDashboard | `StatisticsDashboard.jsx` | Processing statistics |
| LogViewer | `LogViewer.jsx` | Frontend + backend logs |
| OriginalView | `OriginalView.jsx` | NEF comparison view |
| PreferencesModule | `PreferencesModule.jsx` | Settings and preferences |
| ThemeEditor | `ThemeEditor.jsx` | Theme customization |

---

## Module API

Each module receives a `ModuleAPI` instance:

```javascript
api.emit(event, data)         // Broadcast to modules
api.on(event, callback)       // Listen for events
api.http.get/post(path, data) // Backend calls
api.ws.on(event, callback)    // WebSocket events
api.workspace.openModule(id)  // Open module
```

---

## Key Shortcuts

See [Workspace Guide](../docs/user/workspace-guide.md) for complete list.

**Essential:**
- `Cmd+O` - Open file
- `+`/`-` - Zoom
- `=` - 1:1 zoom
- `0` - Auto-fit
- `Cmd+1-5` - Layout presets

---

## Styling

Use CSS variables for all colors. See [Theming](../docs/dev/theming.md).

```css
.my-component {
  background: var(--bg-primary);
  color: var(--text-primary);
}
```

---

## Related Docs

- [Architecture](../docs/dev/architecture.md)
- [Theming](../docs/dev/theming.md)
- [Workspace Guide](../docs/user/workspace-guide.md)
