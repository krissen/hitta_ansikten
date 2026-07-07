/**
 * SuffixDialog Component
 *
 * Small dialog to attach a free-text filename suffix to the current image.
 * Shows a live, client-normalized preview mirroring the backend. Enter saves,
 * Esc cancels. Reuses the confirm-overlay/confirm-dialog styling.
 */

import React, { useState, useEffect, useRef } from 'react';
import { normalizeSuffix } from '../../shared/manualSuffix.js';
import { t } from '../../../i18n/index.js';

export function SuffixDialog({ initialValue, originalName, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef(null);

  useEffect(() => {
    // Focus and select the field on open so re-editing is quick.
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const handleKeyDown = (e) => {
    // Keep the dialog's own keys from reaching the module keyboard handler.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      onSave(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const normalized = normalizeSuffix(value);
  // Build a filename preview: strip an existing extension for display of the stem.
  const dotIdx = originalName.lastIndexOf('.');
  const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
  const previewName = normalized ? `${stem}_${normalized}${ext}` : `${stem}${ext}`;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{t('review.manualSuffix.title')}</h3>
        <input
          ref={inputRef}
          type="text"
          className="suffix-input"
          value={value}
          placeholder={t('review.manualSuffix.placeholder')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="match-info">
          {t('review.manualSuffix.previewLabel')} <strong>{previewName}</strong>
        </div>
        <div className="confirm-buttons">
          <button className="btn-cancel" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn-confirm" onClick={() => onSave(value)}>
            {t('common.save')}
          </button>
        </div>
        <div className="confirm-hint">
          {t('review.manualSuffix.hint')} · <kbd>Enter</kbd> {t('review.dialog.hintConfirms')} · <kbd>Esc</kbd> {t('review.dialog.hintCancels')}
        </div>
      </div>
    </div>
  );
}

export default SuffixDialog;
