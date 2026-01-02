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
│   │   └── backend-service.js # FastAPI auto-start
│   └── renderer/
│       ├── workspace-flex.html
│       ├── workspace/
│       │   └── flexlayout/    # React components
│       ├── modules/           # UI modules (vanilla JS)
│       └── components/        # Shared React components
└── scripts/
    └── build-workspace.js     # esbuild bundler
```

---

## Modules

| Module | Location | Description |
|--------|----------|-------------|
| ImageViewer | `modules/image-viewer/` | Canvas rendering, zoom/pan |
| ReviewModule | `modules/review-module/` | Face review UI |
| FileQueueModule | `modules/file-queue/` | File management |
| LogViewer | `modules/log-viewer/` | Frontend + backend logs |
| OriginalView | `modules/original-view/` | NEF comparison |
| StatisticsDashboard | `modules/statistics-dashboard/` | Stats display |
| DatabaseManagement | `modules/database-management/` | DB admin |
| PreferencesModule | `components/PreferencesModule.jsx` | Settings |
| ThemeEditor | `components/ThemeEditor.jsx` | Theme customization |

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
