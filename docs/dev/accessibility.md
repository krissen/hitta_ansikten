# Accessibility

House accessibility (a11y) patterns for the Ansikten workspace. This is the
canonical reference for keyboard navigation, ARIA roles, status feedback and
reduced-motion handling. When you build a new interactive surface, match the
patterns below rather than inventing new ones.

The shared feedback and control primitives referenced below (`IconButton`,
`Modal`/`useConfirm`, the toast system, `Alert`, `ProgressBar`) are implemented
and live in [`components/shared/`](../../frontend/src/renderer/components/shared/)
and [`context/`](../../frontend/src/renderer/context/). Build on them rather than
hand-rolling equivalents. Module-level migration onto them happens in phase B.

---

## 1. Collections with keyboard navigation

The reference implementation is
[`CullingGrid.jsx`](../../frontend/src/renderer/components/CullingGrid.jsx) — copy
its shape for any list/grid the user arrows through.

- **Container** carries the collection role and owns DOM focus:
  - `role="listbox"` (single-column list) or `role="grid"` (2-D grid).
  - `tabIndex={0}` so the container itself is focusable — arrow keys are
    handled by a `keydown` listener on the container, **not** on each item.
  - `aria-label` describing the collection (Swedish, user-facing).
  - `aria-activedescendant={id-of-active-item}` points at the currently active
    item's `id`. This is how screen readers announce the "cursor" without
    moving DOM focus off the container.
- **Items** are static (they never receive DOM focus themselves):
  - `role="option"` (in a listbox) or `role="gridcell"` (in a grid).
  - `aria-selected={bool}` for the active/selected item.
  - a stable `id` matching what `aria-activedescendant` references
    (e.g. `culling-grid-cell-${index}`).
- **Do not** put `tabIndex` on every item and rely on roving focus — the house
  pattern keeps focus on the container and moves the virtual cursor via
  `aria-activedescendant`. This scrolls better with large collections and keeps
  keyboard handling in one place.
- When the active item changes, scroll it into view with `scrollIntoView`
  gated on reduced motion (see §6).

## 2. Clickable non-buttons

If an element performs an action on click, it must be operable by keyboard.

- **Prefer a real `<button>`.** It gets focusability, Enter/Space activation and
  the correct role for free. Reset its appearance with CSS rather than reaching
  for a `<div>`.
- **If a real button is impossible**, make the element button-like:
  - `role="button"`
  - `tabIndex={0}`
  - a `keydown` handler that fires the same action on **Enter and Space**
    (and calls `preventDefault()` on Space to suppress page scroll).
- A bare `<div onClick>` with no role/tabindex/key handler is not acceptable for
  anything the user is expected to activate.

## 3. Icon-only buttons

Any control whose visible content is only an icon **must** carry an
`aria-label` (Swedish, user-facing) so its purpose is announced.

- Use the shared
  [`IconButton`](../../frontend/src/renderer/components/shared/IconButton.jsx)
  primitive, which requires an accessible `label` by construction (it becomes
  both `aria-label` and `title`).

## 4. Status feedback

Non-modal feedback must be announced without stealing focus, via ARIA live
regions.

- **Transient / global status** (startup progress, "connecting…"): a container
  with `role="status"` + `aria-live="polite"`. Polite waits for a pause before
  announcing. See
  [`StartupStatus.jsx`](../../frontend/src/renderer/components/StartupStatus.jsx).
- **Errors / lost connection**: `role="alert"` + `aria-live="assertive"` so it
  interrupts. See
  [`ConnectionStatus.jsx`](../../frontend/src/renderer/components/ConnectionStatus.jsx),
  which is `alert`/`assertive` when the backend is unreachable and downgrades to
  `status`/`polite` for the benign "connecting" state.
- **Toasts**: the toast system
  ([`context/ToastContext.jsx`](../../frontend/src/renderer/context/ToastContext.jsx))
  carries the live-region wiring centrally — the container is
  `role="status"` + `aria-live="polite"` and `error` toasts announce
  assertively via `role="alert"`. Emit toasts through `useToast()` rather than
  hand-rolling a live region per module. Signature:
  `showToast(message, 'error')` or `showToast(message, { type, duration })`
  (variants: `success`/`error`/`info`/`warning`); each toast carries an
  `IconButton` dismiss control.
- **Persistent inline status**: render through the shared
  [`Alert`](../../frontend/src/renderer/components/shared/Alert.jsx) primitive
  (`variant="error|warning|info|success"`, optional `onDismiss`) so styling and
  semantics stay consistent — `error` is `role="alert"`, the rest `role="status"`.
  It replaces the ad-hoc `.status-message` banners (migrated in phase B).
- **Progress**: use the shared
  [`ProgressBar`](../../frontend/src/renderer/components/shared/ProgressBar.jsx)
  (`role="progressbar"` with `aria-valuenow/-valuemin/-valuemax`; indeterminate
  mode omits `aria-valuenow`). `LoadingOverlay` from the same module is a polite
  status region.

## 5. Modals

Modal dialogs use the **`Modal`** base built on the native `<dialog>` element
([`components/shared/Modal.jsx`](../../frontend/src/renderer/components/shared/Modal.jsx)).
Native `<dialog>` (opened via `showModal()`) gives the platform's **top-layer**
rendering — always above the FlexLayout tabsets, no z-index wars — plus focus
trapping, the `::backdrop` pseudo-element and `Esc`-to-close (the native `cancel`
event) for free. Do not build ad-hoc fixed-overlay divs; use `Modal`.

```jsx
<Modal open={open} onClose={close} title="Titel" footer={buttons} size="sm">
  {body}
</Modal>
```

- `open` drives `showModal()` / `close()`; `onClose` fires on `Esc` and on a
  backdrop click (opt out with `closeOnBackdrop={false}`). `title` is wired to
  `aria-labelledby`. `initialFocusRef` focuses a specific element on open,
  otherwise the platform autofocuses the first focusable child.
- **Keyboard shielding.** The app's global shortcut layers (e.g.
  `useReviewKeyboard`) attach *native* `document` keydown listeners, and a native
  `<dialog>` does not stop keydown from bubbling to `document`. `Modal` therefore
  calls `stopPropagation()` in a single `onKeyDown` on the dialog element — a
  React synthetic `stopPropagation()` also stops the underlying native event, so
  the bubble halts before reaching the `document` listeners. This is the one
  robust shield for every consumer (it replaces the per-component
  `stopPropagation` the old review dialogs each carried). `Esc` is unaffected —
  the browser delivers it as the separate `cancel` event.

**Confirmations.** Use promise-based
[`useConfirm()`](../../frontend/src/renderer/context/ConfirmContext.jsx) instead
of `window.confirm()`:

```js
const confirm = useConfirm();
if (await confirm({ message: 'Radera personen?', variant: 'danger' })) { … }
```

`ConfirmProvider` (mounted beside `ToastProvider`) renders a single shared
`ConfirmDialog` on the `Modal` base — `Enter` confirms, `Esc` cancels, and the
`danger` variant renders the confirm button as `Button variant="danger"`.

**jsdom note.** jsdom does not implement `showModal`/`close`; the Vitest setup
([`frontend/tests/setup.js`](../../frontend/tests/setup.js)) polyfills them so
`Modal`-based component tests can run.

## 6. Reduced motion

The OS "reduce motion" preference must be honoured. There are two halves:

**Declarative (CSS).** A global block at the end of
[`theme.css`](../../frontend/src/renderer/theme.css) neutralises all animation,
transition and CSS smooth-scroll under
`@media (prefers-reduced-motion: reduce)`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

You do not need to opt individual components in — this covers every CSS
transition/animation automatically.

**Motion tokens.** `--motion-duration-fast` / `--motion-duration-base` in the
invariant `:root` block of `theme.css` are raw durations (kept in sync with the
`--transition-*` tokens) for any future JS-friendly or composed animation. Use
them instead of hard-coding durations.

**Imperative (JS).** CSS cannot reach `element.scrollIntoView({ behavior:
'smooth' })` — the behavior is chosen in JS. Gate it with the shared util
[`shared/motion.js`](../../frontend/src/renderer/shared/motion.js):

```js
import { scrollBehavior } from '../shared/motion.js';

el.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
```

`scrollBehavior()` returns `'auto'` (instant) when reduced motion is requested,
`'smooth'` otherwise. `prefersReducedMotion()` from the same module is available
for any other JS-driven motion decision.

### Manual verification

On macOS, toggle **System Settings → Accessibility → Display → Reduce motion**.
With it **on**: startup toast, queue/review auto-scroll and all hover
transitions should snap instantly (no animation). With it **off**: motion is
unchanged from before. Users without the preference see zero visual difference —
that is the contract for this work.

---

## Related docs

- [Theming](theming.md) — CSS variables, tokens, retro-terminal aesthetic
- [Contributing](contributing.md)
