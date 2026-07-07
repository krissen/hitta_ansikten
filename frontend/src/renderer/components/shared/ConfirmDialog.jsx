/**
 * ConfirmDialog — generic confirm/cancel dialog built on the {@link Modal} base.
 *
 * Presentational only; the promise wiring lives in
 * {@link ../../context/ConfirmContext.jsx ConfirmProvider}/`useConfirm()`. Enter
 * confirms, Esc cancels (via the Modal's native `cancel` event). The `danger`
 * variant renders the confirm button as `Button variant="danger"`; otherwise it
 * is `primary`. Cancel is always `secondary`.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the dialog is shown.
 * @param {React.ReactNode} [props.title] - Optional heading.
 * @param {React.ReactNode} props.message - Body text / prompt.
 * @param {string} [props.confirmLabel] - Confirm button label (defaults to common.confirm).
 * @param {string} [props.cancelLabel] - Cancel button label (defaults to common.cancel).
 * @param {'default'|'danger'} [props.variant='default'] - Confirm button emphasis.
 * @param {Function} props.onConfirm - Called on confirm (button or Enter).
 * @param {Function} props.onCancel - Called on cancel (button, Esc or backdrop).
 * @returns {JSX.Element}
 */

import React, { useRef } from 'react';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';
import { Kbd } from './Kbd.jsx';
import { t } from '../../../i18n/index.js';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  // Enter confirms from anywhere in the dialog (there is no text input to type
  // into). The Modal shields this from the app's global shortcut layers.
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm?.();
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onCancel}>
        {cancelLabel || t('common.cancel')}
      </Button>
      <Button
        ref={confirmRef}
        variant={variant === 'danger' ? 'danger' : 'primary'}
        onClick={onConfirm}
      >
        {confirmLabel || t('common.confirm')}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={footer}
      size="sm"
      initialFocusRef={confirmRef}
      onKeyDown={handleKeyDown}
      className="confirm"
    >
      <p className="modal__message">{message}</p>
      <div className="modal__hint">
        <Kbd>Enter</Kbd> {t('review.dialog.hintConfirms')} · <Kbd>Esc</Kbd>{' '}
        {t('review.dialog.hintCancels')}
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
