/**
 * EmptyState — shared empty/placeholder surface.
 *
 * Consolidates the ad-hoc empty placeholders scattered across modules (e.g.
 * ImageViewer's "Ingen bild inläst" icon + title + hint). Visual match with
 * those is intentional so phase-B migrations are lossless.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.icon] - Optional leading icon/emoji.
 * @param {React.ReactNode} props.title - Primary line (Swedish, supplied by caller).
 * @param {React.ReactNode} [props.description] - Optional secondary hint line.
 * @param {React.ReactNode} [props.action] - Optional trailing action (e.g. a Button).
 * @param {string} [props.className] - Extra classes appended to the contract classes.
 * @returns {JSX.Element}
 */

import React from 'react';
import './shared.css';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
  ...rest
}) {
  const classes = ['empty-state', className].filter(Boolean).join(' ');

  return (
    <div className={classes} {...rest}>
      {icon && <div className="empty-state__icon" aria-hidden="true">{icon}</div>}
      {title && <div className="empty-state__title">{title}</div>}
      {description && <div className="empty-state__description hint">{description}</div>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export default EmptyState;
