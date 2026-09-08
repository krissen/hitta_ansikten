/**
 * Button — shared button primitive.
 *
 * Semantic variants map onto the retro theme tokens (see theme.css / theming.md
 * "Button Categories"). Prefer this over the legacy `.btn-action`/`.btn-secondary`/
 * `.btn-danger` classes, which remain as aliases until the cleanup PR (B7).
 *
 * Rules of thumb:
 *  - `primary`   — the single main action of a view/panel (Start, Save). Max one per view.
 *  - `secondary` — standard actions (Refresh, Reload, Rename).
 *  - `ghost`     — low-emphasis / tertiary actions (Clear, Remove, close).
 *  - `danger`    — destructive actions (Delete permanently, Purge).
 *
 * The class contract is `btn btn--{variant} btn--{size}`, styled in shared.css.
 */

import React from 'react';
import './shared.css';

/**
 * @param {object} props
 * @param {'primary'|'secondary'|'ghost'|'danger'} [props.variant='secondary'] - Visual/semantic variant.
 * @param {'sm'|'md'} [props.size='md'] - Control size.
 * @param {boolean} [props.disabled=false] - Disable interaction.
 * @param {boolean} [props.loading=false] - Show inline spinner; implies disabled + aria-busy.
 * @param {'button'|'submit'|'reset'} [props.type='button'] - Native button type.
 * @param {string} [props.className] - Extra classes appended to the contract classes.
 * @param {React.ReactNode} props.children - Button label content (Swedish strings supplied by caller).
 * @param {Function} [props.onClick] - Click handler.
 * @returns {JSX.Element}
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  disabled = false,
  loading = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export default Button;
