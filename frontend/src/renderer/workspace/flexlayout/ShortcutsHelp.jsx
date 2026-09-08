/**
 * ShortcutsHelp - keyboard-shortcuts overlay for the workspace.
 *
 * Rendered by FlexLayoutWorkspace when the user presses '?'. Consumes the
 * SHORTCUT_SECTIONS catalog and highlights the section matching the active
 * module.
 */

import React, { useEffect } from 'react';
import { t } from '../../../i18n/index.js';
import { SHORTCUT_SECTIONS } from './shortcutSections.js';
import './ShortcutsHelp.css';

function ShortcutRow({ shortcut }) {
  const { keys, desc, sep = '+' } = shortcut;
  return (
    <div className="shortcut-row">
      {keys.map((key, i) => (
        <span key={key}>
          {i > 0 && <span className="key-sep">{sep}</span>}
          <kbd>{key}</kbd>
        </span>
      ))}
      <span className="shortcut-desc">{desc}</span>
    </div>
  );
}

export function ShortcutsHelpOverlay({ onClose, activeModule }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2>{t('shortcuts.header')}</h2>
          <button type="button" className="shortcuts-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="shortcuts-content">
          {SHORTCUT_SECTIONS.map((section) => {
            const isActive =
              section.modules.length > 0 &&
              section.modules.includes(activeModule);
            return (
              <div
                key={section.id}
                className={`shortcuts-section ${isActive ? 'active-module' : ''}`}
              >
                <h3>{section.title}</h3>
                {section.shortcuts.map((shortcut) => (
                  <ShortcutRow key={shortcut.desc} shortcut={shortcut} />
                ))}
              </div>
            );
          })}
        </div>
        <div className="shortcuts-footer">
          {t('shortcuts.footer.before')}
          <kbd>?</kbd>
          {t('shortcuts.footer.or')}
          <kbd>Esc</kbd>
          {t('shortcuts.footer.after')}
        </div>
      </div>
    </div>
  );
}

export default ShortcutsHelpOverlay;
