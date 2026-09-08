/**
 * ConfirmDialog Component
 *
 * Confirmation overlay for the two review edge cases: confirming a name that
 * differs from the high-confidence top match ('name-mismatch'), and ignoring a
 * face that has a high-confidence match ('ignore-high-confidence'). Enter
 * confirms, Esc cancels.
 *
 * Rendered on the shared {@link ../shared/Modal.jsx Modal} base (native
 * `<dialog>`), which shields the review module's global keyboard layer from keys
 * typed here and provides Esc-to-cancel via its `cancel` event. The public props
 * are unchanged.
 */

import React from 'react';
import { Modal } from '../shared/Modal.jsx';
import { Button } from '../shared/Button.jsx';
import { Kbd } from '../shared/Kbd.jsx';
import { t } from '../../../i18n/index.js';

export function ConfirmDialog({
  type,
  topMatch,
  chosenName,
  onConfirm,
  onCancel,
}) {
  const isNameMismatch = type === 'name-mismatch';

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button variant="primary" onClick={onConfirm}>
        {t('common.confirm')}
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={onCancel}
      onKeyDown={handleKeyDown}
      title={
        isNameMismatch
          ? t('review.dialog.confirmNameChange')
          : t('review.dialog.confirmIgnore')
      }
      footer={footer}
      size="sm"
      className="confirm"
    >
      <div className="match-info">
        {t('review.dialog.bestMatch')} <strong>{topMatch.name}</strong> (
        {topMatch.confidence}%)
      </div>
      <p className="modal__message">
        {isNameMismatch
          ? t('review.dialog.nameMismatch', { name: chosenName })
          : t('review.dialog.ignoreConfirm')}
      </p>
      <div className="modal__hint">
        <Kbd>Enter</Kbd> {t('review.dialog.hintConfirms')} · <Kbd>Esc</Kbd>{' '}
        {t('review.dialog.hintCancels')}
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
