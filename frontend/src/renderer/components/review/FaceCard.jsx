/**
 * FaceCard Component
 *
 * Renders one detected face: thumbnail, match-case indicator, keyboard-selectable
 * match alternatives, and either a name-autocomplete input (unconfirmed) or a
 * confirmed/ignored status badge.
 */

import React, { useState } from 'react';
import { useThumbnail } from '../../shared/thumbnail-cache.js';
import { Autocomplete } from '../shared/Autocomplete.jsx';
import { rank } from './nameAutocomplete.js';
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

  const filteredPeople = React.useMemo(
    () => rank(typedValue, people),
    [typedValue, people]
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
          <div className="match-case manual">{t('review.badges.manual')}</div>
        )}
        {face.match_case === 'ign' && !face.is_confirmed && (
          <div className="match-case probable-ignore">{t('review.badges.probableIgnore')}</div>
        )}
        {face.match_case === 'uncertain_ign' && !face.is_confirmed && (
          <div className="match-case uncertain">
            {t('review.badges.uncertainIgn', {
              conf: face.ignore_confidence,
              name: face.person_name || face.match_alternatives?.[0]?.name || t('review.unknown'),
            })}
          </div>
        )}
        {face.match_case === 'uncertain_name' && !face.is_confirmed && (
          <div className="match-case uncertain">
            {t('review.badges.uncertainName', {
              conf: face.ignore_confidence,
              name: face.person_name || face.match_alternatives?.[0]?.name || t('review.unknown'),
            })}
          </div>
        )}
        {face.disambiguated && !face.is_confirmed && (
          <div
            className="match-case twin-disambig"
            title={t('review.twinDisambig.title', { between: face.disambiguated.between.join(' / ') })}
          >
            {t('review.twinDisambig.label', { chosen: face.disambiguated.chosen })}
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
          <Autocomplete
            value={inputValue}
            options={filteredPeople}
            inputRef={inputRef}
            inputClassName={people.includes(inputValue) ? 'name-match' : ''}
            placeholder={t('review.placeholder')}
            ariaLabel={t('review.placeholder')}
            openOnFocus
            navigateWithTab
            selectOnEnter={false}
            onInputChange={(val) => {
              setInputValue(val);
              setTypedValue(val);
            }}
            onHighlight={(name) => setInputValue(name)}
            onSelect={(name) => {
              setInputValue(name);
              setTypedValue(name);
            }}
            onEscape={() => setInputValue(typedValue)}
          />
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
