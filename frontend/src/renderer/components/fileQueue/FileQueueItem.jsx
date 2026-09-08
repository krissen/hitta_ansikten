/**
 * FileQueueItem - single row in the FileQueueModule list.
 *
 * Presentational subcomponent: renders status icon/text, preprocessing
 * indicator, face count, inline rename preview, confirmed-names strip and the
 * hover tooltip for one queued file. Receives all state via props.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PreprocessingStatus } from '../../services/preprocessing/index.js';
import { Icon } from '../Icon.jsx';
import { IconButton } from '../shared';
import {
  formatNamesToFit,
  measureTextWidth,
} from '../../shared/nameFormatter.js';
import { t } from '../../../i18n/index.js';

function FileQueueItem({
  item,
  index,
  isActive,
  isFocused,
  isSelected,
  isRovingTarget,
  onRove,
  onClick,
  onDoubleClick,
  onToggleSelect,
  onRemove,
  onForceReprocess,
  fixMode,
  preprocessingStatus,
  showPreview,
  previewInfo,
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [namesDisplay, setNamesDisplay] = useState('');
  const itemRef = useRef(null);
  const nameAreaRef = useRef(null);
  const tooltipTimerRef = useRef(null);

  const handleMouseEnter = (e) => {
    if (itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      setTooltipPos({ x: rect.left, y: rect.bottom + 4 });
    }
    tooltipTimerRef.current = setTimeout(() => setShowTooltip(true), 400);
  };

  const handleMouseLeave = () => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setShowTooltip(false);
  };

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, []);

  // Calculate confirmed names display based on available width
  // Dependencies: confirmedNames, shouldShowPreview, item.fileName are calculated later in component
  // but useEffect runs after render so they're available via closure
  const truncateFilenameForMeasure = useCallback((name, maxLen = 25) => {
    const chars = [...name];
    if (chars.length <= maxLen) return name;
    const lastDotIndex = name.lastIndexOf('.');
    const hasExt = lastDotIndex !== -1;
    const ext = hasExt ? name.slice(lastDotIndex) : '';
    const base = hasExt ? name.slice(0, lastDotIndex) : name;
    const baseChars = [...base];
    const extLen = [...ext].length;
    const availableForBase = Math.max(0, maxLen - 3 - extLen);
    const truncatedBase = baseChars.slice(0, availableForBase).join('');
    return truncatedBase + '...' + ext;
  }, []);

  // Compute these early so useEffect can use them
  const ppPersonsEarly = preprocessingStatus?.persons;
  const confirmedNamesEarly =
    previewInfo?.persons ||
    item.reviewedFaces?.map((f) => f.personName).filter(Boolean) ||
    ppPersonsEarly ||
    [];
  const shouldShowPreviewEarly =
    showPreview &&
    (item.status === 'completed' || item.isAlreadyProcessed) &&
    previewInfo;

  useEffect(() => {
    // Only show names when NOT showing preview and we have names
    if (shouldShowPreviewEarly || !confirmedNamesEarly.length) {
      setNamesDisplay('');
      return;
    }

    if (!nameAreaRef.current) return;

    const calculateNames = () => {
      const container = nameAreaRef.current;
      if (!container) return;

      const style = getComputedStyle(container);
      const font = `${style.fontSize} ${style.fontFamily}`;

      // Measure filename width
      const fileNameText = truncateFilenameForMeasure(item.fileName);
      const fileNameWidth = measureTextWidth(fileNameText, font);

      // Available space: container width - filename - padding (40px for gaps and margins)
      const availableWidth = container.offsetWidth - fileNameWidth - 40;

      if (availableWidth > 30) {
        const result = formatNamesToFit(
          confirmedNamesEarly,
          availableWidth,
          font,
        );
        setNamesDisplay(result.text);
      } else {
        setNamesDisplay('');
      }
    };

    calculateNames();

    const observer = new ResizeObserver(calculateNames);
    observer.observe(nameAreaRef.current);

    return () => observer.disconnect();
  }, [
    confirmedNamesEarly,
    shouldShowPreviewEarly,
    item.fileName,
    truncateFilenameForMeasure,
  ]);

  const getStatusIcon = () => {
    switch (item.status) {
      case 'completed':
        return (
          <span className="status-icon completed">
            <Icon name="check" size={12} />
          </span>
        );
      case 'active':
        return (
          <span className="status-icon active">
            <Icon name="play" size={12} />
          </span>
        );
      case 'error':
        return (
          <span className="status-icon error">
            <Icon name="close" size={12} />
          </span>
        );
      case 'missing':
        return (
          <span
            className="status-icon missing"
            title={t('fileQueue.tooltips.fileNotFound')}
          >
            <Icon name="warning" size={12} />
          </span>
        );
      default:
        if (item.isAlreadyProcessed) {
          if (fixMode) {
            // Fix-mode ON: same icon as pending, but with green tint
            return (
              <span className="status-icon pending-reprocess">
                <Icon name="circle" size={12} />
              </span>
            );
          } else {
            // Fix-mode OFF: checkmark to show "already done"
            return (
              <span className="status-icon already-done">
                <Icon name="check" size={12} />
              </span>
            );
          }
        }
        return (
          <span className="status-icon pending">
            <Icon name="circle" size={12} />
          </span>
        );
    }
  };

  const getStatusText = () => {
    switch (item.status) {
      case 'completed':
        return t('fileQueue.status.done');
      case 'active':
        return t('fileQueue.status.active');
      case 'error':
        return t('fileQueue.status.error');
      case 'missing':
        return t('fileQueue.status.notFound');
      default:
        if (item.isAlreadyProcessed) {
          return fixMode
            ? t('fileQueue.status.queuedReprocess')
            : t('fileQueue.status.processed');
        }
        return t('fileQueue.status.queued');
    }
  };

  // Get preprocessing indicator
  // preprocessingStatus is now an object: { status, faceCount }
  const ppStatus = preprocessingStatus?.status || preprocessingStatus; // Handle both formats
  const ppFaceCount = preprocessingStatus?.faceCount;

  const getPreprocessingIndicator = () => {
    // No status recorded yet
    if (!ppStatus) {
      return null;
    }
    // Show checkmark for completed preprocessing
    if (ppStatus === PreprocessingStatus.COMPLETED) {
      return (
        <Icon
          name="bolt"
          size={14}
          className="preprocess-indicator completed"
          title={t('fileQueue.tooltips.cached')}
        />
      );
    }
    if (ppStatus === PreprocessingStatus.FILE_NOT_FOUND) {
      return null; // Status already shown in main icon
    }
    if (ppStatus === PreprocessingStatus.ERROR) {
      return (
        <span
          className="preprocess-indicator error"
          title={t('fileQueue.tooltips.preprocessingFailed')}
        >
          !
        </span>
      );
    }
    // Show spinner for any in-progress state
    return (
      <Icon
        name="refresh"
        size={14}
        className="preprocess-indicator loading"
        title={t('fileQueue.tooltips.preprocessing', { status: ppStatus })}
      />
    );
  };

  // Truncate filename for display (Unicode-safe, preserves extension)
  const truncateFilename = (name, maxLen = 25) => {
    const chars = [...name]; // Spread to handle multi-byte Unicode correctly
    if (chars.length <= maxLen) return name;
    const lastDotIndex = name.lastIndexOf('.');
    const hasExt = lastDotIndex !== -1;
    const ext = hasExt ? name.slice(lastDotIndex) : '';
    const base = hasExt ? name.slice(0, lastDotIndex) : name;
    const baseChars = [...base];
    const extLen = [...ext].length;
    const availableForBase = Math.max(0, maxLen - 3 - extLen);
    const truncatedBase = baseChars.slice(0, availableForBase).join('');
    return truncatedBase + '...' + ext;
  };

  // Show preview info if available (for completed or already-processed files)
  // Don't show if new name is identical to current name (nothing would change)
  const newName = previewInfo?.newName;
  const previewStatus = previewInfo?.status;
  const nameWouldChange = newName && newName !== item.fileName;
  const shouldShowPreview =
    showPreview &&
    (item.status === 'completed' || item.isAlreadyProcessed) &&
    previewInfo;

  // Face count priority: reviewedFaces (from review-complete) > ppFaceCount (from preprocessing)
  // Using || instead of ?? because ppFaceCount=0 might be stale (race with faces-detected)
  const reviewedCount = item.reviewedFaces?.length;
  const detectedFaceCount =
    reviewedCount > 0 ? reviewedCount : ppFaceCount || null;
  const hasDetectedFaces = detectedFaceCount !== null;

  // Confirmed names: previewInfo (rename) > reviewedFaces (this session) > preprocessingStatus (from file stats)
  const ppPersons = preprocessingStatus?.persons;
  const confirmedNames =
    previewInfo?.persons ||
    item.reviewedFaces?.map((f) => f.personName).filter(Boolean) ||
    ppPersons ||
    [];
  const confirmedCount = confirmedNames.length;

  // Sidecars from rename preview
  const sidecars = previewInfo?.sidecars || [];
  const hasSidecars = sidecars.length > 0;

  // Keyboard for the row (roving tabindex, accessibility.md §2a). Only the
  // roving-target row is tabbable (tabIndex 0); the rest are -1, so the list is
  // a single tab stop instead of ~4 per row. Arrow keys move the roving cursor
  // between rows; Enter/Space loads the file (mouse equivalent is double-click).
  // Only act when the row itself is focused so key presses on the nested
  // checkbox/buttons don't also trigger these. The module's n/p navigation
  // lives on a document listener and is unaffected.
  const handleRowKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onDoubleClick?.();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const sibling =
        e.key === 'ArrowDown'
          ? itemRef.current?.nextElementSibling
          : itemRef.current?.previousElementSibling;
      if (sibling && sibling.classList.contains('file-item')) {
        e.preventDefault();
        const targetIndex = Number(sibling.getAttribute('data-index'));
        if (!Number.isNaN(targetIndex)) onRove?.(targetIndex);
        sibling.focus();
      }
    }
  };

  return (
    <div
      ref={itemRef}
      className={`file-item ${item.status} ${isActive ? 'active' : ''} ${isFocused ? 'focused' : ''} ${isSelected ? 'selected' : ''} ${item.isAlreadyProcessed ? 'already-processed' : ''} ${shouldShowPreview ? 'with-preview' : ''}`}
      role="button"
      tabIndex={isRovingTarget ? 0 : -1}
      data-index={index}
      aria-label={t('fileQueue.item.ariaLabel', {
        fileName: item.fileName,
        status: getStatusText(),
      })}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleRowKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <input
        type="checkbox"
        className="file-select-checkbox"
        tabIndex={isRovingTarget ? 0 : -1}
        checked={isSelected}
        onChange={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        onClick={(e) => e.stopPropagation()}
      />
      {getStatusIcon()}
      {/* Wrapper for file name + preview to maintain consistent right-column alignment */}
      <div className="file-name-area" ref={nameAreaRef}>
        <span className="file-name">
          {/* When showing preview, don't pre-truncate - let CSS handle it */}
          {shouldShowPreview ? item.fileName : truncateFilename(item.fileName)}
          {hasSidecars && shouldShowPreview && (
            <span
              className="sidecar-indicator"
              title={sidecars.map((s) => s.split('/').pop()).join(', ')}
            >
              {/* Show extension badges for each sidecar */}
              {[
                ...new Set(
                  sidecars.map((s) => s.split('.').pop().toLowerCase()),
                ),
              ].map((ext) => (
                <span key={ext} className="sidecar-badge">
                  {ext}
                </span>
              ))}
            </span>
          )}
        </span>
        {/* Confirmed names display (when not showing preview) */}
        {!shouldShowPreview && namesDisplay && (
          <span className="confirmed-names" title={confirmedNames.join(', ')}>
            {namesDisplay}
          </span>
        )}
        {/* Inline preview of new name (only if name would actually change) */}
        {shouldShowPreview && nameWouldChange && (
          <span className="inline-preview">
            <span className="arrow">→</span>
            <span className="new-name">{newName}</span>
          </span>
        )}
        {shouldShowPreview &&
          !newName &&
          previewStatus &&
          previewStatus !== 'ok' && (
            <span
              className={`inline-preview ${previewStatus === 'no_persons' || previewStatus === 'already_renamed' ? 'muted' : 'error'}`}
            >
              <span className="arrow">→</span>
              <span
                className={
                  previewStatus === 'no_persons' ||
                  previewStatus === 'already_renamed'
                    ? 'preview-muted'
                    : 'preview-error'
                }
              >
                {previewStatus === 'no_persons'
                  ? t('fileQueue.status.noPersons')
                  : previewStatus === 'already_renamed'
                    ? t('fileQueue.status.alreadyRenamed')
                    : previewStatus}
              </span>
            </span>
          )}
      </div>
      {/* Fixed-width columns for alignment */}
      <span className="preprocess-col">{getPreprocessingIndicator()}</span>
      <span
        className="face-count"
        title={
          confirmedNames.length > 0
            ? t('fileQueue.tooltips.confirmedList', {
                names: confirmedNames.join(', '),
              })
            : hasDetectedFaces
              ? t('fileQueue.tooltips.detectedCount', {
                  count: detectedFaceCount,
                })
              : t('fileQueue.tooltips.notLoaded')
        }
      >
        <Icon name="user" size={12} />
        {hasDetectedFaces ? detectedFaceCount : '–'}
      </span>
      <span className="file-status">{getStatusText()}</span>
      {!fixMode && item.isAlreadyProcessed ? (
        <IconButton
          icon="refresh"
          size="sm"
          variant="ghost"
          className="reprocess-btn"
          tabIndex={isRovingTarget ? 0 : -1}
          label={t('fileQueue.tooltips.reprocessFile')}
          onClick={(e) => {
            e.stopPropagation();
            onForceReprocess();
          }}
        />
      ) : (
        <span className="reprocess-btn-placeholder" />
      )}
      <IconButton
        icon="close"
        size="sm"
        variant="ghost"
        className="remove-btn"
        tabIndex={isRovingTarget ? 0 : -1}
        label={t('fileQueue.tooltips.removeFromQueue')}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      />

      {/* Unified tooltip */}
      {showTooltip && (
        <div
          className="file-tooltip"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="tooltip-row">
            <span className="tooltip-label">
              {t('fileQueue.tooltips.file')}
            </span>
            <span className="tooltip-value">{item.fileName}</span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-label">
              {t('fileQueue.tooltips.folder')}
            </span>
            <span className="tooltip-value tooltip-path">
              {item.filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')}
            </span>
          </div>
          {hasDetectedFaces && (
            <div className="tooltip-row">
              <span className="tooltip-label">
                {t('fileQueue.tooltips.detected')}
              </span>
              <span className="tooltip-value">
                {t('fileQueue.tooltips.faceCount', {
                  count: detectedFaceCount,
                })}
              </span>
            </div>
          )}
          {confirmedCount > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">
                {t('fileQueue.tooltips.confirmed', { count: confirmedCount })}
              </span>
              <span className="tooltip-value">{confirmedNames.join(', ')}</span>
            </div>
          )}
          {shouldShowPreview && nameWouldChange && (
            <div className="tooltip-row tooltip-newname">
              <span className="tooltip-label">
                {t('fileQueue.tooltips.newName')}
              </span>
              <span className="tooltip-value">{newName}</span>
            </div>
          )}
          {shouldShowPreview && hasSidecars && (
            <div className="tooltip-row tooltip-sidecars">
              <span className="tooltip-label">
                {t('fileQueue.tooltips.sidecars', { count: sidecars.length })}
              </span>
              <span className="tooltip-value">
                {sidecars.map((s) => s.split('/').pop()).join(', ')}
              </span>
            </div>
          )}
          {shouldShowPreview && !newName && previewStatus && (
            <div className="tooltip-row tooltip-error">
              <span className="tooltip-label">
                {t('fileQueue.tooltips.rename')}
              </span>
              <span className="tooltip-value">{previewStatus}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default FileQueueItem;
