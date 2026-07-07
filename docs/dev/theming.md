# Theming

CSS variable system and styling guidelines for Ansikten workspace.

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

For keyboard navigation, ARIA roles, status live-regions and the
reduced-motion policy, see [Accessibility](accessibility.md).

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
| `--bg-active` | #c8a060 | #383838 | Active/selected |

### Text Colors

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--text-primary` | #1a1008 | #d4d2c0 | Main text |
| `--text-secondary` | #2d1810 | #a8a698 | Secondary text |
| `--text-tertiary` | #483020 | #7a7870 | Muted text |
| `--text-inverse` | #f8f0e0 | #0f0f0f | Text on accent bg |
| `--text-on-accent` | #0a0a0a | #0a0a0a | Text on accent buttons |

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
| `--accent-primary-alpha-20` | rgba(56,168,24,0.2) | rgba(154,205,50,0.2) | Faint accent tint (selected rows) |
| `--accent-secondary` | #e85820 | #daa520 | Secondary actions |
| `--accent-secondary-hover` | #c03810 | #eebb30 | Secondary hover |

### Semantic Colors

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--color-success` | #38a818 | #9acd32 | Success state |
| `--color-success-bg` | #d8dcc8 | #1a2a1a | Success background |
| `--color-success-text` | #1f6b0a | #9acd32 | Success text (theme-legible) |
| `--color-warning` | #f87820 | #ffa500 | Warning state |
| `--color-warning-bg` | #e8d8c8 | #2a2015 | Warning background |
| `--color-warning-text` | #b34a00 | #ffa500 | Warning text (theme-legible) |
| `--color-error` | #e83020 | #ff6347 | Error state |
| `--color-error-bg` | #e8c8c8 | #2a1515 | Error background |
| `--color-error-text` | #b81e10 | #ff6347 | Error text (theme-legible) |
| `--color-info` | #1888d8 | #87ceeb | Info state |
| `--color-info-bg` | #c8dce8 | #15202a | Info background |

> `--color-*-text` variants are the theme-legible text colors (dark on beige in
> light, bright on near-black in dark). Use them for status *text*; pair with the
> matching `--color-*-bg` for the fill. There is no `--color-info-text` — use
> `--color-info` for info text.

### Row / Selection Highlights

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--bg-row-hover` | #e8d8b0 | #252525 | List/table row hover |
| `--bg-row-active` | `--accent-primary-alpha-20` | `--accent-primary-alpha-20` | Selected/current row tint |
| `--dropdown-selected-bg` | `--color-info-bg` | #454545 | Highlighted dropdown option |

### Canvas Face Boxes

Colors for face bounding boxes drawn over the photo in `ImageViewer`. They are
read once via `getComputedStyle` and cached (invalidated on theme change). Kept
equal across themes because they sit on image pixels, not the UI chrome.

| Variable | Value | Usage |
|----------|-------|-------|
| `--face-active-highlight` | #e85820 (light) / #00bcd4 (dark) | Active face outline |
| `--face-confirmed-color` / `-bg` | green | Confirmed name |
| `--face-ignored-color` / `-bg` | gray | Ignored face |
| `--face-uncertain-color` / `-bg` | #ffc107 | Uncertain name/ignore band |
| `--face-confidence-medium-color` / `-bg` | #2196f3 | Medium confidence (≥0.50) |
| `--face-confidence-low-color` / `-bg` | #ff9800 | Low confidence (≥0.35) |
| `--face-confidence-none-color` / `-bg` | #f44336 | Very low confidence (<0.35) |

### Overlay

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--overlay-bg` | #987840 | #0a0a0a | Overlay/scrim background |
| `--overlay-text` | #f8f0e0 | #d4d2c0 | Text on overlay |

### Progress

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--progress-track-bg` | #a08858 | #353535 | Progress track |
| `--progress-fill` | `--accent-primary` | `--accent-primary` | Progress fill |
| `--progress-text` | `--text-primary` | `--text-primary` | Progress label |
| `--progress-height` | 4px | 4px | Bar height |
| `--progress-radius` | 2px | 2px | Bar radius |

### Button Hover States

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--btn-secondary-hover-bg` | #e8d8b0 | `--bg-hover` | Secondary button hover |
| `--btn-icon-hover-bg` | #e8d8b0 | `--bg-hover` | Icon button hover |

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

## Z-Index Scale

Theme-independent stacking order. Reference these instead of raw z-index values.

| Variable | Value | Usage |
|----------|-------|-------|
| `--z-base` | 1 | Default raised elements |
| `--z-dropdown` | 100 | Dropdowns, autocomplete popups |
| `--z-sticky` | 200 | Sticky headers/toolbars |
| `--z-modal` | 1000 | Modals, dialogs |
| `--z-tooltip` | 2000 | Tooltips, transient overlays |

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

Prefer the shared `<Button>` / `<IconButton>` primitives (`components/shared/`)
for new and migrated UI — see the "Button Categories" section for the semantic
model and the migration table. The legacy classes in `theme.css` — `.btn-action`
(primary CTA), `.btn-secondary` (standard action), `.btn-danger` (destructive),
and `.btn-icon` (toolbar icon) — remain as aliases until the cleanup PR (B7) and
still back any un-migrated call site. They share a base rule.

```css
/* Primary action (Start, Save, Confirm) - use --text-on-accent for contrast */
.btn-action {
  background: var(--accent-primary);
  color: var(--text-on-accent);
  border: none;
}

/* Secondary action (Refresh, Clear, Rename) */
.btn-secondary {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
}

/* Danger (Delete permanently) */
.btn-danger {
  background: var(--color-error);
  color: var(--text-inverse);
  border: none;
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

### Icon Buttons

```css
/* Toolbar icon button - square, hover-elevated */
.btn-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon:hover {
  background: var(--btn-icon-hover-bg);
  box-shadow: var(--shadow-sm);
}
```

### Feedback surfaces

Shared feedback primitives live in
[`components/shared/`](../../frontend/src/renderer/components/shared/) and are
styled in `shared.css` against the semantic tokens — reuse them instead of
hand-rolling banners.

- **`Alert`** (`.alert` + `.alert--{success|warning|info|error}`) — persistent
  inline status. Uses the `--color-*-bg` / `--color-*-text` / `--color-*` token
  trio, matching the legacy `.status-message` banners so phase-B swaps are
  visually lossless.
- **Toasts** (`.global-toast` + variant class, in `flexlayout-overrides.css`) —
  transient global feedback on the solid `--color-{success|info|warning|error}`
  fills with `--text-inverse`; each carries an `IconButton` dismiss
  (`.global-toast__dismiss`, inherits the pill text colour).
- **`ProgressBar` / `LoadingOverlay`** (`ProgressBar.css`) — driven by the
  `--progress-*` tokens (see [Progress](#progress) below).
- **`EmptyState`** (`.empty-state` + `.empty-state__{icon,title,description,action}`)
  — builds on the base `.empty-state` layout; mirrors the legacy ImageViewer
  placeholder (48px icon, `--text-tertiary`, `.hint` secondary line).

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

Buttons are a **semantic model**, not a per-file style. The canonical implementation
is the shared `<Button>` / `<IconButton>` primitives in
`components/shared/` — prefer these over hand-rolled `<button className="btn-…">`.
The primitives render the class contract `btn btn--{variant} btn--{size}` (and
`icon-btn icon-btn--{variant} icon-btn--{size}`), styled in
`components/shared/shared.css` directly against the theme tokens.

```jsx
import { Button, IconButton, Kbd } from '../shared';

<Button variant="primary" onClick={onStart}>Starta</Button>
<Button variant="secondary" size="sm" onClick={onReload}>Ladda om</Button>
<Button variant="danger" loading={deleting} onClick={onDelete}>Radera</Button>
<IconButton icon="trash" label="Ta bort" variant="ghost" onClick={onRemove} />
<span>Tryck <Kbd>Enter</Kbd> för att bekräfta</span>
```

| Variant | Background | Text | Hover | Use For |
|---------|------------|------|-------|---------|
| **primary** | `--accent-primary` | `--text-on-accent` | `--accent-primary-hover` | The one main action of a view (Start, Save) |
| **secondary** | `--bg-elevated` | `--text-primary` | `--btn-secondary-hover-bg` | Standard action (Refresh, Reload, Rename) |
| **ghost** | `transparent` | `--text-secondary` | `--bg-hover` | Low-emphasis / tertiary action (Clear, Remove, close) |
| **danger** | `--color-error` | `--text-inverse` | brightness filter | Destructive (Delete, Purge) |

`IconButton` supports `elevated` (default — a raised chip mirroring legacy
`.btn-icon` exactly: resting `--bg-elevated`, hover `--btn-icon-hover-bg` +
`--shadow-sm`), `ghost` (flat/low-profile, opt-in) and `danger`. `Button`
supports all four variants and two sizes (`sm`, `md`). `loading` implies
`disabled`, sets
`aria-busy`, and renders an inline spinner whose animation is a CSS class
(so the reduced-motion guard can disable it). `IconButton`'s `label` is required
and becomes both `aria-label` and `title`.

The shared [`Autocomplete`](../../frontend/src/renderer/components/shared/Autocomplete.jsx)
combobox primitive uses the `.autocomplete-wrapper` / `.autocomplete-dropdown` /
`.autocomplete-item` classes, styled in `components/shared/shared.css` against
the theme tokens (`--bg-elevated`, `--border-medium`, `--shadow-lg`,
`--dropdown-selected-bg`, `--color-info`). The dropdown is portalled to `<body>`
and positioned with `useDropdownPosition`, so those rules are global; consumers
should not re-declare them. See [accessibility.md §1a](accessibility.md) for the
ARIA/keyboard contract.

### Semantics

- **Max ONE primary per view/panel.** Primary marks the single most important
  action. If two buttons look equally important, at most one is primary; the
  rest are secondary.
- **Refresh/Reload** → secondary (not primary).
- **Clear / Remove / close** → ghost (not danger — clearing a queue is not
  destructive to saved data).
- **Delete permanently / Purge** → danger.
- **Start / Save / Submit** → primary.

### Migration from the legacy `.btn-*` classes

The old classes in `theme.css` (`.btn-action`, `.btn-secondary`, `.btn-danger`,
`.btn-icon`) still exist and are **kept as aliases** until the cleanup PR (B7);
modules migrate to the primitives incrementally. Map old → new as follows:

| Legacy class | New primitive | Notes |
|--------------|---------------|-------|
| `.btn-primary` / `.btn-confirm` | `<Button variant="primary">` | |
| `.btn-cancel` | `<Button variant="secondary">` | |
| `.btn-secondary` | `<Button variant="secondary">` **or** `variant="ghost"` | Triage per use: Refresh/Reload → secondary; Clear/Remove/close → ghost |
| `.btn-action` | `<Button variant="primary">` **or** `variant="secondary">` | Triage per use; enforce **max one primary per view** |
| `.btn-danger` | `<Button variant="danger">` | |
| `.btn-icon` | `<IconButton>` | Default `elevated` variant = visual parity with `.btn-icon`; use `variant="ghost"` for low-profile buttons. Requires a `label` (aria-label + title) |

---

## Modals

Modal dialogs use the shared `<Modal>` primitive
(`components/shared/Modal.jsx`), a native `<dialog showModal()>` styled in
`shared.css` against the theme tokens: a retro-sharp surface (low `--radius-sm`,
strong `1px` `--border-strong` border, `--bg-secondary`, `--shadow-lg`) with a
dimmed `::backdrop` (`--overlay-opacity`). The open animation uses
`--motion-duration-base` and is disabled under `prefers-reduced-motion`. Class
contract:

| Class | Role |
|-------|------|
| `.modal` / `.modal--{sm,md,lg}` | The `<dialog>` surface + width preset |
| `.modal__content` | Padded inner wrapper (clicks here are *not* backdrop clicks) |
| `.modal__title` | Heading (wired to `aria-labelledby`) |
| `.modal__body` | Body content slot |
| `.modal__footer` | Right-aligned action row (use `<Button>` primitives) |
| `.modal__message` / `.modal__hint` | Prompt text / `<Kbd>` keyboard-hint row |

Prefer `<Modal>` over ad-hoc fixed-overlay divs. For confirm/cancel prompts use
the promise-based `useConfirm()` (see
[accessibility.md](accessibility.md#5-modals) for the full pattern, keyboard
shielding, and top-layer rationale).

---

## Theme Editor

Users can customize themes via the ThemeEditor module:

1. Select category (backgrounds, text, accents, etc.)
2. Adjust colors with color picker or hex input
3. Save as custom preset
4. Bind presets to light/dark system modes

Custom presets stored in localStorage.

---

## Tailwind Utility Layer

Tailwind v4 is available as a **utility layer on top of the token system** — it
does not replace it. `theme.css` remains the single source of truth for every
design value; Tailwind only exposes utilities that reference those same
`var(--…)` tokens. Because the utilities point straight at the live variables,
both themes, the tri-state switch, and the ThemeEditor's runtime overrides
(`setProperty` on `<html>`) keep working through the utilities with no extra
wiring.

### Build

- Source: [`src/renderer/tailwind.css`](../../frontend/src/renderer/tailwind.css).
- Compiled by the Tailwind CLI (spawned from
  [`scripts/build-workspace.js`](../../frontend/scripts/build-workspace.js),
  alongside esbuild) to `workspace/dist/tailwind-bundle.css`.
- Linked in `workspace-flex.html` **after** `workspace-bundle.css`.
- No npm-script or CSP changes; watch mode runs `--watch=always` in parallel
  with the esbuild watcher.

### Naming scheme (1:1, grep-able)

Utilities map 1:1 onto the token names via `@theme inline`, so the class name
tells you the token:

| Utility | Token | Note |
|---------|-------|------|
| `bg-bg-primary` | `--bg-primary` | background |
| `text-text-primary` | `--text-primary` | **color** |
| `border-border-medium` | `--border-medium` | border color |
| `text-success` / `bg-success-bg` | `--color-success` / `--color-success-bg` | semantic |
| `p-md`, `gap-lg`, `m-xs` | `--space-*` | spacing scale |
| `text-base`, `text-2xl` | `--font-*` | **font size** |
| `font-sans`, `font-mono` | `--font-sans/-mono` | font family |
| `rounded-lg`, `shadow-md` | `--radius-*`, `--shadow-*` | |

Two things to keep straight:

- **`text-base` is a font *size*; `text-text-primary` is a *color*.** The
  `text-` prefix is overloaded by Tailwind — size utilities read a `--text-*`
  key, color utilities read a `--color-text-*` key.
- **Accent uses a short-form.** The only naming deviation: `accent`,
  `accent-hover`, `accent-secondary` map to `--accent-primary`,
  `--accent-primary-hover`, `--accent-secondary` (so `bg-accent`,
  `text-accent`, `border-accent`).

Not mapped: `--z-*` (use arbitrary values, e.g. `z-(--z-modal)`) and
`--transition-*` (keep using the legacy vars directly).

### Coexistence rules

The token layer and the utility layer live side by side. Rules that keep them
from fighting:

1. **Legacy (unlayered) CSS always wins over Tailwind.** Component CSS and
   `theme.css` are unlayered; Tailwind's output lives in `@layer theme/base/…/utilities`.
   Unlayered declarations beat *any* layered declaration regardless of
   specificity — which is also *why* the token definitions in `theme.css`
   override Tailwind's self-referential `:root` theme emissions. So dropping a
   utility onto an element that a legacy rule already styles is inert until the
   legacy rule is removed.
2. **No `!` utilities.** `!`-important utilities would break rule 1 and let a
   utility silently override component CSS. Forbidden.
3. **Migrate, don't layer.** When a component is migrated to utilities, remove
   its now-dead legacy CSS rules **in the same PR**. Don't leave both.
4. **Known name collisions:** `text-success` / `text-warning` / `text-error` /
   `text-info` exist as *both* legacy classes (in `theme.css`, colored via
   `--color-*-text`) and Tailwind utilities (colored via `--color-*`). Legacy
   wins today, so behavior is unchanged; the collision is logged in
   [ROADMAP.md](../../ROADMAP.md) and is cleaned up when the `.status`/`.text-*`
   layer is migrated.

### Preflight is off (deliberately)

Tailwind's Preflight (its opinionated reset) is **not** imported. The project
owns its resets — `theme.css` sets `box-sizing` globally, and component CSS
assumes browser defaults for margins/typography. Pulling in Preflight would
silently restyle every existing element (headings, lists, form controls).

There is **no base border reset either** (not even Preflight's minimal
`border: 0 solid`): several unmigrated form controls (`<select>`/`<input>` in
TrashPanel, LogViewer, StatisticsDashboard, RenameNefModule) have no border
styling of their own and rely on UA defaults, which any author-level reset —
layered or not — would zero out. Consequence for utility authors: **border
utilities must set an explicit border style**, e.g.
`border border-solid border-border-medium` (a bare `border` only sets the
width). A base border reset can be reconsidered once the form controls are
migrated to shared primitives (phase A/B) and nothing depends on UA-default
borders.

Re-enabling Preflight, if ever, is a deliberate final cleanup PR, not a
foundation concern.
