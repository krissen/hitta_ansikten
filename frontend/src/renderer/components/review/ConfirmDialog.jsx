/**
 * ConfirmDialog Component
 *
 * Confirmation overlay for the two review edge cases: confirming a name that
 * differs from the high-confidence top match ('name-mismatch'), and ignoring a
 * face that has a high-confidence match ('ignore-high-confidence'). Enter
 * confirms, Esc cancels.
 */

import React, { useEffect, useRef } from 'react';
import { t } from '../../../i18n/index.js';

export function ConfirmDialog({ type, topMatch, chosenName, onConfirm, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onConfirm, onCancel]);

  const isNameMismatch = type === 'name-mismatch';

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{isNameMismatch ? t('review.dialog.confirmNameChange') : t('review.dialog.confirmIgnore')}</h3>
        <div className="match-info">
          {t('review.dialog.bestMatch')} <strong>{topMatch.name}</strong> ({topMatch.confidence}%)
        </div>
        <p>
          {isNameMismatch
            ? t('review.dialog.nameMismatch', { name: chosenName })
            : t('review.dialog.ignoreConfirm')}
        </p>
        <div className="confirm-buttons">
          <button className="btn-cancel" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn-confirm" onClick={onConfirm}>
            {t('common.confirm')}
          </button>
        </div>
        <div className="confirm-hint">
          <kbd>Enter</kbd> {t('review.dialog.hintConfirms')} · <kbd>Esc</kbd> {t('review.dialog.hintCancels')}
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
