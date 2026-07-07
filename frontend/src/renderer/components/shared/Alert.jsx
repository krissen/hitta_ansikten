/**
 * Alert — persistent inline status surface.
 *
 * Unlike a toast (transient, global), an Alert stays in the layout until the
 * consumer removes it. It is the shared replacement for the ad-hoc
 * `.status-message` banners scattered across module CSS (migrated in phase B),
 * and is styled against the same `--color-*-bg/-text` tokens so the swap is
 * visually lossless.
 *
 * Accessibility: `error` announces assertively via `role="alert"`; the other
 * variants use `role="status"` (polite). See docs/dev/accessibility.md.
 *
 * @param {object} props
 * @param {'error'|'warning'|'info'|'success'} [props.variant='info'] - Visual/semantic variant.
 * @param {React.ReactNode} [props.icon] - Optional leading icon/element.
 * @param {Function} [props.onDismiss] - When provided, renders a dismiss button.
 * @param {string} [props.className] - Extra classes appended to the contract classes.
 * @param {React.ReactNode} props.children - Alert body (Swedish strings supplied by caller).
 * @returns {JSX.Element}
 */

import React from 'react';
import { IconButton } from './IconButton.jsx';
import { t } from '../../../i18n/index.js';
import './shared.css';

export function Alert({
  variant = 'info',
  icon,
  onDismiss,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'alert',
    `alert--${variant}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      role={variant === 'error' ? 'alert' : 'status'}
      {...rest}
    >
      {icon && <span className="alert__icon" aria-hidden="true">{icon}</span>}
      <span className="alert__body">{children}</span>
      {onDismiss && (
        <IconButton
          icon="close"
          label={t('common.dismiss')}
          variant="ghost"
          size="sm"
          className="alert__dismiss"
          onClick={onDismiss}
        />
      )}
    </div>
  );
}

export default Alert;
