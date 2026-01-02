# Theming

CSS variable system and styling guidelines for Hitta ansikten workspace.

---

## Design Philosophy

### Retro Terminal Aesthetic

- **Terminal Beige (Light)**: Inspired by Commodore 64, Amiga, Apple II
- **CRT Phosphor (Dark)**: Classic green/amber CRT monitor feel
- Clear contrasts, easy on the eyes
- Monospace for technical data, sans-serif for UI
- Subtle shadows and discreet transitions
- Limited color palette for nostalgic feel

### Accessibility

- All color combinations meet WCAG 2.1 AA (4.5:1 contrast)
- Clear button/interactive element separation
- Obvious hover states without being flashy

---

## CSS Variables

### Usage

Variables defined in `theme.css`, auto-loaded by renderer:

```css
.my-component {
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
}
```

### Background Colors

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--bg-primary` | #c8b088 | #0f0f0f | Main background |
| `--bg-secondary` | #b09060 | #1a1a1a | Sections, panels |
| `--bg-tertiary` | #987840 | #252525 | Headers, toolbars |
| `--bg-elevated` | #d8c8a0 | #2a2a2a | Cards, modals |
| `--bg-hover` | #a08050 | #303030 | Hover states |
| `--bg-active` | #886830 | #383838 | Active/selected |

### Text Colors

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--text-primary` | #1a1008 | #d4d2c0 | Main text |
| `--text-secondary` | #2d1810 | #a8a698 | Secondary text |
| `--text-tertiary` | #483020 | #7a7870 | Muted text |
| `--text-inverse` | #f8f0e0 | #0f0f0f | Text on accent bg |
| `--text-on-accent` | #ffffff | #ffffff | Text on accent buttons |

### Border Colors

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--border-subtle` | #a08858 | #353535 | Subtle dividers |
| `--border-medium` | #886830 | #454545 | Standard borders |
| `--border-strong` | #684818 | #555555 | Emphasized borders |

### Accent Colors

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--accent-primary` | #38a818 | #9acd32 | Primary actions |
| `--accent-primary-hover` | #2a8010 | #b8e856 | Primary hover |
| `--accent-secondary` | #e85820 | #daa520 | Secondary actions |
| `--accent-secondary-hover` | #c03810 | #eebb30 | Secondary hover |

### Semantic Colors

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--color-success` | #38a818 | #9acd32 | Success state |
| `--color-success-bg` | #b0e898 | #1a2a1a | Success background |
| `--color-warning` | #f87820 | #ffa500 | Warning state |
| `--color-warning-bg` | #ffc898 | #2a2015 | Warning background |
| `--color-error` | #e83020 | #ff6347 | Error state |
| `--color-error-bg` | #ffb0a8 | #2a1515 | Error background |
| `--color-info` | #1888d8 | #87ceeb | Info state |
| `--color-info-bg` | #a0d0f8 | #15202a | Info background |

---

## Spacing System

Based on 4px grid:

| Variable | Value | Usage |
|----------|-------|-------|
| `--space-xs` | 4px | Tight spacing |
| `--space-sm` | 8px | Small spacing |
| `--space-md` | 12px | Medium spacing |
| `--space-lg` | 16px | Large spacing |
| `--space-xl` | 24px | Extra large |
| `--space-2xl` | 32px | Section gaps |

---

## Typography

### Font Sizes

| Variable | Value | Usage |
|----------|-------|-------|
| `--font-xs` | 10px | Tiny labels |
| `--font-sm` | 11px | Small text |
| `--font-base` | 13px | Default |
| `--font-md` | 14px | Slightly larger |
| `--font-lg` | 16px | Headings |
| `--font-xl` | 18px | Large headings |
| `--font-2xl` | 22px | Page titles |

### Font Families

| Variable | Value | Usage |
|----------|-------|-------|
| `--font-sans` | System fonts | UI text |
| `--font-mono` | Monaco, Menlo | Code, logs, filenames |

---

## Border Radius

| Variable | Value | Usage |
|----------|-------|-------|
| `--radius-sm` | 3px | Buttons, inputs |
| `--radius-md` | 4px | Cards |
| `--radius-lg` | 6px | Large cards |
| `--radius-full` | 999px | Pills, badges |

---

## Transitions

| Variable | Value | Usage |
|----------|-------|-------|
| `--transition-fast` | 0.1s ease | Quick feedback |
| `--transition-base` | 0.15s ease | Standard |
| `--transition-slow` | 0.3s ease | Smooth animations |

---

## Shadows

| Variable | Usage |
|----------|-------|
| `--shadow-sm` | Subtle elevation |
| `--shadow-md` | Cards, dropdowns |
| `--shadow-lg` | Modals, overlays |

---

## Component Patterns

### Module Container

```css
.module {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--font-base);
  overflow: hidden;
}
```

### Module Header

```css
.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-medium);
  flex-shrink: 0;
}
```

### Buttons

```css
/* Base */
.btn {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--font-sm);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-base);
}

/* Primary - use --text-on-accent for contrast */
.btn-primary {
  background: var(--accent-primary);
  color: var(--text-on-accent);
}

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-medium);
}
```

### Inputs

```css
.input {
  padding: var(--space-sm);
  font-size: var(--font-sm);
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-sm);
}

.input:focus {
  outline: none;
  border-color: var(--accent-primary);
}
```

### Badges

```css
.badge {
  display: inline-block;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-xs);
  font-weight: 600;
  text-transform: uppercase;
  border-radius: var(--radius-full);
}

.badge-success {
  background: var(--color-success-bg);
  color: var(--color-success);
}
```

---

## Dark Mode CRT Effects

```css
/* Text glow */
[data-theme="dark"] .text-glow {
  text-shadow: 0 0 2px currentColor;
}

/* Accent glow */
[data-theme="dark"] .accent-glow {
  box-shadow: 0 0 8px var(--accent-primary);
}
```

---

## Module-Specific Guidelines

### LogViewer
- Use `--font-mono` for all text
- Color-code log levels with semantic colors
- Minimal chrome, focus on readability

### StatisticsDashboard
- Table headers use `--accent-primary` background with `--text-on-accent`
- Section titles use `--accent-primary` color
- Compact spacing for data-dense display

### ReviewModule
- Face cards use `--bg-elevated`
- Active card gets `--accent-primary` border
- In dark mode, use `accent-glow` on active card

### FileQueueModule
- Use `--font-mono` for filenames
- Active file highlighted with `--accent-primary`
- Compact list layout

---

## Icons

Use the `Icon` component for all UI icons:

```jsx
import Icon from '../components/Icon.jsx';

<Icon name="plus" size={16} />
<Icon name="folder" />
<Icon name="settings" className="toolbar-icon" />
```

Available icons: `plus`, `folder`, `folder-plus`, `play`, `pause`, `settings`, `close`, `check`, `refresh`, `trash`, `file`, `warning`, `error`, `error-outline`, `user`, `block`, `check-circle`, `check-circle-outline`, `skip-next`, `skip-previous`, `bolt`, `circle`, `chevron-up`, `chevron-down`

Icons use `currentColor` and adapt to theme automatically.

---

## Migration Checklist

When converting a component to use CSS variables:

1. Replace hardcoded hex colors with CSS variables
2. Replace hardcoded pixel values with spacing variables
3. Replace font sizes with typography variables
4. Add appropriate hover/active states
5. Test in both light and dark mode
6. Verify contrast meets WCAG AA

### Common Replacements

```
#2a2a2a  →  var(--bg-secondary)
#1a1a1a  →  var(--bg-primary)
#d4d4d4  →  var(--text-primary)
#888     →  var(--text-tertiary)
12px     →  var(--space-md)
4px      →  var(--radius-md)
```

## Text Variable Rules

**Core Principle:** Variables must work correctly in BOTH themes without dark-mode overrides. If you need a `:root[data-theme="dark"]` override for text color, you're using the wrong variable.

### When to Use Each Variable

| Variable | Use For | Background |
|----------|---------|------------|
| `--text-primary` | Main body text, headings on normal bg | `--bg-*` variables |
| `--text-secondary` | Secondary/muted text, labels, hints | `--bg-*` variables |
| `--text-tertiary` | Disabled text, timestamps, metadata | `--bg-*` variables |
| `--text-inverse` | Text on **colored** backgrounds only | `--color-*`, `--accent-*` (solid) |
| `--text-on-accent` | Text on accent buttons specifically | `--accent-primary`, `--accent-secondary` |
| `--accent-primary` | Emphasized headings, highlighted text | `--bg-*` variables |

### NEVER Use `--text-inverse` On:

- Normal backgrounds (`--bg-primary`, `--bg-secondary`, `--bg-elevated`, etc.)
- Elements without an explicit colored background
- Headings or labels in general UI

**Why:** In light theme `--text-inverse` is light (#f8f0e0), in dark theme it's dark (#0f0f0f). Using it on a normal background gives zero contrast in one theme.

### Correct `--text-inverse` Usage:

```css
/* CORRECT - on colored background */
.toast.success {
  background: var(--color-success);
  color: var(--text-inverse);
}

/* CORRECT - on accent background */
.badge-warning {
  background: var(--color-warning);
  color: var(--text-inverse);
}

/* WRONG - on normal background */
.section-title {
  color: var(--text-inverse);  /* Invisible in dark theme! */
}
```

### For Headings

Use `--text-primary` with `font-weight: 600`:

```css
/* CORRECT - works in both themes */
.section h4 {
  color: var(--text-primary);
  font-weight: 600;
}

/* AVOID - accent-primary has contrast issues in light mode */
.section h4 {
  color: var(--accent-primary);  /* Only 2.16:1 on --bg-secondary! */
}
```

**Standard heading hierarchy:**
- Module titles (h3): `--font-xl`, `--text-primary`, `font-weight: 600`
- Section titles (h4): `--font-md`, `--text-primary`, `font-weight: 600`
- Sidebar titles: `--font-sm`, `--text-secondary`, `text-transform: uppercase`

### Avoiding Dark-Mode Overrides

If you find yourself writing:

```css
/* This is a code smell */
:root[data-theme="dark"] .my-text {
  color: var(--text-primary);
}
```

You're probably using the wrong variable in the base rule. Fix the base rule instead.

### Quick Reference

| I want... | Use |
|-----------|-----|
| Normal readable text | `--text-primary` |
| Less prominent text | `--text-secondary` |
| Very subtle text | `--text-tertiary` |
| Text on a colored button/toast/badge | `--text-inverse` |
| Text on an accent-colored button | `--text-on-accent` |
| Section headings | `--text-primary` + `font-weight: 600` |
| Icon on semantic background | `--color-success`, `--color-info`, etc. |

---

## Button Categories

Standardized button styles for consistency across all modules:

| Category | Background | Text | Hover | Use For |
|----------|------------|------|-------|---------|
| **Primary** | `--accent-primary` | `--text-on-accent` | `--accent-primary-hover` | Main action (Start, Save) |
| **Secondary** | `--bg-tertiary` | `--text-primary` | `--bg-hover` | Secondary action (Refresh, Reload) |
| **Ghost** | `transparent` | `--text-secondary` | `--bg-hover` | Tertiary action (Clear, Remove) |
| **Danger** | `--color-error` | `--text-inverse` | brightness filter | Destructive (Delete, Purge) |

### Examples

```css
/* Primary button */
.btn-primary {
  background: var(--accent-primary);
  color: var(--text-on-accent);
}
.btn-primary:hover {
  background: var(--accent-primary-hover);
}

/* Secondary button */
.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
.btn-secondary:hover {
  background: var(--bg-hover);
}

/* Ghost button */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-medium);
}
.btn-ghost:hover {
  background: var(--bg-hover);
}
```

### Button Semantics

- **Refresh/Reload actions** → Secondary (not Primary)
- **Clear queue** → Ghost (not Danger - it's not destructive)
- **Delete permanently** → Danger
- **Start/Save/Submit** → Primary

---

## Theme Editor

Users can customize themes via the ThemeEditor module:

1. Select category (backgrounds, text, accents, etc.)
2. Adjust colors with color picker or hex input
3. Save as custom preset
4. Bind presets to light/dark system modes

Custom presets stored in localStorage.
