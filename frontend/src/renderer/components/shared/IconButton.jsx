/**
 * IconButton — icon-only button primitive.
 *
 * Renders a single {@link Icon} inside an accessible button. Because there is no
 * visible text, `label` is REQUIRED and becomes both `aria-label` and `title`.
 * A missing label is a developer error and is surfaced via a dev-warning
 * (there is no prop-types dependency in this project).
 *
 * Replaces the legacy `.btn-icon` toolbar class (kept as an alias until B7).
 * The default `elevated` variant mirrors `.btn-icon` exactly (raised chip,
 * hover shadow) so migrations are visually lossless; `ghost` is the opt-in
 * flat/low-profile variant.
 */

import React from 'react';
import { Icon } from '../Icon.jsx';
import { debugWarn } from '../../shared/debug.js';
import './shared.css';

/**
 * @param {object} props
 * @param {string} props.icon - Icon name (see Icon.jsx ICON_NAMES).
 * @param {string} props.label - Accessible label; required, becomes aria-label + title.
 * @param {'elevated'|'ghost'|'danger'} [props.variant='elevated'] - Visual/semantic variant.
 * @param {'sm'|'md'} [props.size='md'] - Control size.
 * @param {boolean} [props.disabled=false] - Disable interaction.
 * @param {string} [props.className] - Extra classes appended to the contract classes.
 * @param {Function} [props.onClick] - Click handler.
 * @returns {JSX.Element}
 */
export function IconButton({
  icon,
  label,
  variant = 'elevated',
  size = 'md',
  disabled = false,
  className = '',
  ...rest
}) {
  if (!label) {
    debugWarn('IconButton', `Missing required "label" prop for icon "${icon}" (needed for aria-label + title)`);
  }

  const classes = [
    'icon-btn',
    `icon-btn--${variant}`,
    `icon-btn--${size}`,
    className,
  ].filter(Boolean).join(' ');

  // Icon scales with the button size; sm renders a slightly smaller glyph.
  const iconSize = size === 'sm' ? 14 : 16;

  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      title={label}
      disabled={disabled}
      {...rest}
    >
      <Icon name={icon} size={iconSize} aria-hidden="true" />
    </button>
  );
}

export default IconButton;
