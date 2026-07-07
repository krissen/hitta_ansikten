/**
 * FaceCard Component
 *
 * Renders one detected face: thumbnail, match-case indicator, keyboard-selectable
 * match alternatives, and either a name-autocomplete input (unconfirmed) or a
 * confirmed/ignored status badge.
 */

import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useThumbnail } from '../../shared/thumbnail-cache.js';
import { useDropdownPosition } from '../../hooks/useDropdownPosition.js';
import { Icon } from '../Icon.jsx';
import { t } from '../../../i18n/index.js';

export function FaceCard({ face, index, isActive, imagePath, people, cardRef, inputRef, onSelect, onConfirm, onIgnore, onUnconfirm, maxAlternatives, onSelectAlternative, clearInputTrigger }) {
  const isProbableIgnoreCase = face.match_case === 'ign' || face.match_case === 'uncertain_ign';
  const initialValue = isProbableIgnoreCase ? '' : (face.person_name || '');
  const [inputValue, setInputValue] = useState(initialValue);
  const [typedValue, setTypedValue] = useState(initialValue);

  // Use cached thumbnail
  const { url: thumbnailUrl, loading: thumbnailLoading, error: thumbnailError } = useThumbnail(
    imagePath,
    face.bounding_box
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const localInputRef = useRef(null);

  const setInputRef = useCallback((el) => {
    localInputRef.current = el;
    if (inputRef) {
      if (typeof inputRef === 'function') inputRef(el);
      else inputRef.current = el;
    }
  }, [inputRef]);

  React.useEffect(() => {
    const newValue = isProbableIgnoreCase ? '' : (face.person_name || '');
    setInputValue(newValue);
    setTypedValue(newValue);
  }, [face.face_id, face.match_case, isProbableIgnoreCase, face.person_name]);

  React.useEffect(() => {
    if (clearInputTrigger > 0) {
      setInputValue('');
      setTypedValue('');
    }
  }, [clearInputTrigger]);

  const filteredPeople = React.useMemo(() => {
    if (!typedValue?.trim()) return [];
    const typed = typedValue.toLowerCase();
    const startsWithMatch = people.filter(p => p.toLowerCase().startsWith(typed));
    const containsMatch = people.filter(p =>
      !p.toLowerCase().startsWith(typed) && p.toLowerCase().includes(typed)
    );
    return [...startsWithMatch, ...containsMatch].slice(0, 8);
  }, [typedValue, people]);

  const dropdownStyle = useDropdownPosition(
    showSuggestions && filteredPeople.length > 0,
    localInputRef.current,
    { maxHeight: 200, gap: 4 }
  );

  // Determine if this is a probable-ignore case
  const isProbableIgnore = face.match_case === 'ign' || face.match_case === 'uncertain_ign';

  const cardClass = [
    'face-card',
    face.is_confirmed && !face.is_rejected ? 'confirmed' : '',
    face.is_rejected ? 'rejected' : '',
    face.is_manual ? 'manual' : '',
    isProbableIgnore && !face.is_confirmed ? 'probable-ignore' : '',
    isActive ? 'active' : ''
  ].filter(Boolean).join(' ');

  const handleDoubleClick = (e) => {
    if (face.is_confirmed && onUnconfirm) {
      e.stopPropagation();
      onUnconfirm();
    }
  };

  return (
    <div ref={cardRef} className={cardClass} onClick={onSelect} onDoubleClick={handleDoubleClick}>
      <div className="face-number">{index + 1}</div>

      <div className="face-thumbnail">
        {thumbnailLoading ? (
          <div className="thumbnail-loading" />
        ) : thumbnailUrl && !thumbnailError ? (
          <img
            src={thumbnailUrl}
            alt={face.person_name || t('review.unknown')}
          />
        ) : (
          <Icon name="user" size={32} />
        )}
      </div>

      <div className="face-info">
        {/* Match case indicator */}
        {face.is_manual && (
          <div className="match-case manual">Manuellt tillagd</div>
        )}
        {face.match_case === 'ign' && !face.is_confirmed && (
          <div className="match-case probable-ignore">Trolig ignorering</div>
        )}
        {face.match_case === 'uncertain_ign' && !face.is_confirmed && (
          <div className="match-case uncertain">
            ign ({face.ignore_confidence}%) / {face.person_name || face.match_alternatives?.[0]?.name || 'Okänd'}
          </div>
        )}
        {face.match_case === 'uncertain_name' && !face.is_confirmed && (
          <div className="match-case uncertain">
            {face.person_name || face.match_alternatives?.[0]?.name || 'Okänd'} / ign ({face.ignore_confidence}%)
          </div>
        )}
        {face.disambiguated && !face.is_confirmed && (
          <div
            className="match-case twin-disambig"
            title={`Lika ansikten ${face.disambiguated.between.join(' / ')} — valt via k-NN-röstning över bekräftade foton`}
          >
            Tvilling-särskiljning → {face.disambiguated.chosen}
          </div>
        )}
      </div>

      {/* Match alternatives - only shown on active unconfirmed face */}
      {isActive && !face.is_confirmed && face.match_alternatives?.length > 0 && (
        <div className="face-alternatives">
          {face.match_alternatives.slice(0, maxAlternatives || 5).map((alt, idx) => (
            <div
              key={idx}
              className={`alt-chip ${idx === 0 ? 'recommended' : ''} ${alt.is_ignored ? 'ignored' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAlternative?.(alt.name);
              }}
            >
              <span className="kbd">{idx + 1}</span>
              <span className="alt-name">{alt.name}</span>
              <span className="alt-conf">{alt.confidence}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="face-actions">
        {!face.is_confirmed ? (
          <div className="autocomplete-wrapper">
            <input
              ref={setInputRef}
              type="text"
              className={people.includes(inputValue) ? 'name-match' : ''}
              placeholder={t('review.placeholder')}
              value={inputValue}
              onChange={(e) => {
                const val = e.target.value;
                setInputValue(val);
                setTypedValue(val);
                setSelectedSuggestion(-1);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowSuggestions(false);
                  setInputValue(typedValue);
                  setSelectedSuggestion(-1);
                  e.target.blur();
                  e.stopPropagation();
                  return;
                }
                // Arrow Down / Tab - select next suggestion (wraps)
                if ((e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) &&
                    showSuggestions && filteredPeople.length > 0) {
                  e.preventDefault();
                  const newIdx = selectedSuggestion >= filteredPeople.length - 1
                    ? 0
                    : selectedSuggestion + 1;
                  setSelectedSuggestion(newIdx);
                  setInputValue(filteredPeople[newIdx]);
                  return;
                }
                // Arrow Up / Shift+Tab - select previous suggestion (wraps)
                if ((e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) &&
                    showSuggestions && filteredPeople.length > 0) {
                  e.preventDefault();
                  const newIdx = selectedSuggestion <= 0
                    ? filteredPeople.length - 1
                    : selectedSuggestion - 1;
                  setSelectedSuggestion(newIdx);
                  setInputValue(filteredPeople[newIdx]);
                  return;
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
            {showSuggestions && filteredPeople.length > 0 && createPortal(
              <div className="autocomplete-dropdown" style={dropdownStyle}>
                {filteredPeople.map((name, idx) => (
                  <div
                    key={name}
                    className={`autocomplete-item ${idx === selectedSuggestion ? 'selected' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setInputValue(name);
                      setTypedValue(name);
                      setShowSuggestions(false);
                    }}
                  >
                    {name}
                  </div>
                ))}
              </div>,
              document.body
            )}
          </div>
        ) : (
          <div
            className={`status-text ${face.is_rejected ? 'rejected' : 'confirmed'}`}
            title={t('review.undoTitle')}
          >
            {face.is_rejected ? (
              <><Icon name="block" size={12} /> {t('review.ignoredBadge')}</>
            ) : (
              <><Icon name="check" size={12} /> {face.person_name}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default FaceCard;
