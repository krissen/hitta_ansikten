/**
 * ProgressBar — themeable progress indicator (shared primitive).
 *
 * Supports determinate (percentage) and indeterminate (loading) modes. The
 * track carries the `role="progressbar"` semantics; in determinate mode it
 * exposes `aria-valuenow/-valuemin/-valuemax`, while indeterminate mode omits
 * `aria-valuenow` (the ARIA convention for "amount unknown").
 *
 * Theme variables used:
 * - --progress-track-bg: Background of the track
 * - --progress-fill: Fill color
 * - --progress-text: Text color (for labels)
 * - --progress-height: Height of the bar
 * - --progress-radius: Border radius
 */

import React from 'react';
import { t } from '../../../i18n/index.js';
import './ProgressBar.css';

/**
 * ProgressBar - Visual progress indicator
 *
 * @param {object} props
 * @param {number} [props.value] - Progress value (0-100), or undefined/null for indeterminate.
 * @param {string} [props.label] - Optional visible label text.
 * @param {string} [props.ariaLabel] - Accessible label; falls back to a string `label`, then a default.
 * @param {'sm'|'md'|'lg'} [props.size='md'] - Size variant.
 * @param {boolean} [props.showPercent=false] - Show percentage text.
 * @param {string} [props.className] - Additional CSS classes.
 */
export function ProgressBar({
  value,
  label,
  ariaLabel,
  size = 'md',
  showPercent = false,
  className = '',
}) {
  const isIndeterminate = value === undefined || value === null;
  const percent = isIndeterminate ? 0 : Math.min(100, Math.max(0, value));

  const classes = [
    'progress-bar',
    `progress-bar--${size}`,
    isIndeterminate ? 'progress-bar--indeterminate' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Prefer an explicit ariaLabel; otherwise a string label; otherwise a default.
  const resolvedAriaLabel =
    ariaLabel ||
    (typeof label === 'string' ? label : undefined) ||
    t('common.progress');

  return (
    <div className={classes}>
      {label && <div className="progress-bar__label">{label}</div>}
      <div
        className="progress-bar__track"
        role="progressbar"
        aria-label={resolvedAriaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        // Indeterminate omits aria-valuenow (unknown amount of progress).
        aria-valuenow={isIndeterminate ? undefined : Math.round(percent)}
      >
        <div
          className="progress-bar__fill"
          style={{ width: isIndeterminate ? '30%' : `${percent}%` }}
        />
      </div>
      {showPercent && !isIndeterminate && (
        <div className="progress-bar__percent">{Math.round(percent)}%</div>
      )}
    </div>
  );
}

/**
 * LoadingSpinner - Circular loading indicator
 *
 * @param {object} props
 * @param {'sm'|'md'|'lg'} [props.size='md'] - Size variant.
 * @param {string} [props.className] - Additional CSS classes.
 */
export function LoadingSpinner({ size = 'md', className = '' }) {
  const classes = ['loading-spinner', `loading-spinner--${size}`, className]
    .filter(Boolean)
    .join(' ');

  return <div className={classes} />;
}

/**
 * LoadingOverlay - Full-area loading overlay with spinner and optional message.
 *
 * Announced as a polite status region so assistive tech learns a load started
 * and finished.
 *
 * @param {object} props
 * @param {string} [props.message] - Optional loading message.
 * @param {boolean} [props.visible=true] - Whether the overlay is visible.
 */
export function LoadingOverlay({ message, visible = true }) {
  if (!visible) return null;

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <LoadingSpinner size="lg" />
      {message && <div className="loading-overlay__message">{message}</div>}
    </div>
  );
}

export default ProgressBar;
