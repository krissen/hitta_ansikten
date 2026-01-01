# Styling Reference

This document defines the styling system for hitta_ansikten workspace. All components should use CSS variables for colors, spacing, and typography.

## Design Philosophy

### Retro Terminal Aesthetic
- **Terminal Beige (Light)**: Inspired by Commodore 64, Amiga, Apple II
- **CRT Phosphor (Dark)**: Classic green/amber CRT monitor feel
- Clear contrasts but easy on the eyes
- Monospace for technical data, sans-serif for UI
- Subtle shadows and discreet transitions
- Limited color palette for nostalgic feel

### Accessibility
- All color combinations must meet WCAG 2.1 AA (4.5:1 contrast)
- Clear button/interactive element separation
- Obvious hover states without being flashy

---

## CSS Variables

### How to Use

Import theme.css at the top of any component CSS:
```css
/* At the top of your component's CSS file */
/* theme.css is auto-loaded by the main renderer */

.my-component {
  background: var(--bg-primary);
  color: var(--text-primary);
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
| `--font-mono` | Monaco, Menlo, etc | Code, logs, filenames |

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

### Section
```css
.module-section {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
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

/* Primary */
.btn-primary {
  background: var(--accent-primary);
  color: var(--text-inverse);
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
  box-shadow: 0 0 0 2px var(--accent-primary-alpha-20);
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

## Dark Mode CRT Effects (Optional)

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
- Table headers use `--accent-primary` background
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

### DatabaseManagement
- Form-focused layout
- Clear action buttons
- Use semantic alerts for feedback

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
#2a2a2a  ->  var(--bg-secondary)
#1a1a1a  ->  var(--bg-primary)  /* dark */
#d4d4d4  ->  var(--text-primary)
#888     ->  var(--text-tertiary)
12px     ->  var(--space-md)
4px      ->  var(--radius-md)
```

---

## References

- **WCAG Guidelines**: https://www.w3.org/WAI/WCAG21/quickref/
