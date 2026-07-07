/**
 * SuffixDialog Component
 *
 * Small dialog to attach a free-text filename suffix to the current image.
 * Shows a live, client-normalized preview mirroring the backend. Enter saves,
 * Esc cancels.
 *
 * Rendered on the shared {@link ../shared/Modal.jsx Modal} base (native
 * `<dialog>`). The Modal shields the review module's global keyboard layer from
 * keys typed in the field, so the old ad-hoc `stopPropagation` is gone; Esc
 * cancels via the Modal's `cancel` event. The public props are unchanged.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '../shared/Modal.jsx';
import { Button } from '../shared/Button.jsx';
import { Kbd } from '../shared/Kbd.jsx';
import { normalizeSuffix } from '../../shared/manualSuffix.js';
import { t } from '../../../i18n/index.js';

export function SuffixDialog({ initialValue, originalName, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef(null);

  useEffect(() => {
    // Select the field on open so re-editing is quick. The Modal focuses it via
    // initialFocusRef; this additionally selects the existing text.
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSave(value);
    }
  };

  const normalized = normalizeSuffix(value);
  // Build a filename preview: strip an existing extension for display of the stem.
  const dotIdx = originalName.lastIndexOf('.');
  const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
  const previewName = normalized ? `${stem}_${normalized}${ext}` : `${stem}${ext}`;

  const footer = (
    <>
      <Button variant="secondary" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button variant="primary" onClick={() => onSave(value)}>
        {t('common.save')}
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={onCancel}
      onKeyDown={handleKeyDown}
      title={t('review.manualSuffix.title')}
      footer={footer}
      size="sm"
      initialFocusRef={inputRef}
      className="suffix"
    >
      <input
        ref={inputRef}
        type="text"
        className="suffix-input"
        value={value}
        placeholder={t('review.manualSuffix.placeholder')}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="match-info">
        {t('review.manualSuffix.previewLabel')} <strong>{previewName}</strong>
      </div>
      <div className="modal__hint">
        {t('review.manualSuffix.hint')} · <Kbd>Enter</Kbd> {t('review.dialog.hintConfirms')} · <Kbd>Esc</Kbd> {t('review.dialog.hintCancels')}
      </div>
    </Modal>
  );
}

export default SuffixDialog;
