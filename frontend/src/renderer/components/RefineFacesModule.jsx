/**
 * RefineFacesModule - React component for encoding refinement
 *
 * Features:
 * - Filter outlier encodings (std deviation, cluster, or Mahalanobis)
 * - Repair inconsistent encoding shapes
 * - Remove deprecated dlib encodings
 * - Preview changes before applying with statistics
 *
 * Only InsightFace encodings are supported. dlib is deprecated.
 */

import React, { useState, useCallback } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useOperationStatus } from '../hooks/useOperationStatus.js';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { Alert, Button, Modal } from './shared';
import { debugError } from '../shared/debug.js';
import { t } from '../../i18n/index.js';
import './RefineFacesModule.css';

/**
 * RefineFacesModule Component
 */
export function RefineFacesModule() {
  const { api } = useBackend();
  const showToast = useToast();
  const confirm = useConfirm();

  // Mode selection
  const [mode, setMode] = useState('std');  // 'std', 'cluster', 'mahalanobis', 'shape'

  // Configuration
  const [config, setConfig] = useState({
    stdThreshold: 2.0,
    clusterDist: 0.35,
    clusterMin: 6,
    mahalanobisThreshold: 3.0,
    minEncodings: 8,
    person: ''    // Empty = all people
  });

  // State
  const [preview, setPreview] = useState(null);
  // Shape-repair dry-run detail list shown in a modal (null = closed).
  const [repairPreview, setRepairPreview] = useState(null);

  // Operation status: persistent errors surfaced via Alert; transient success
  // receipts go to toasts.
  const { isLoading, setIsLoading, status, showError, clearStatus } = useOperationStatus();

  /**
   * Fetch preview from API
   */
  const handlePreview = useCallback(async () => {
    setIsLoading(true);
    setPreview(null);
    clearStatus();

    try {
      const params = new URLSearchParams();
      params.set('mode', mode);

      if (config.person.trim()) {
        params.set('person', config.person.trim());
      } else {
        params.set('person', '*');
      }

      params.set('std_threshold', config.stdThreshold.toString());
      params.set('cluster_dist', config.clusterDist.toString());
      params.set('cluster_min', config.clusterMin.toString());
      params.set('mahalanobis_threshold', config.mahalanobisThreshold.toString());
      params.set('min_encodings', config.minEncodings.toString());

      const result = await api.get(`/api/v1/refinement/preview?${params.toString()}`);
      setPreview(result);

      if (result.summary.total_remove === 0) {
        showToast(t('refineFaces.messages.noEncodingsToRemove'), { type: 'info' });
      }
    } catch (err) {
      debugError('RefineFaces', 'Preview failed:', err);
      showError(t('refineFaces.messages.previewFailed', { error: err.message }));
    } finally {
      setIsLoading(false);
    }
  }, [api, mode, config]);

  /**
   * Apply filtering
   */
  const handleApply = useCallback(async (dryRun = false) => {
    if (!preview || preview.summary.total_remove === 0) {
      showError(t('refineFaces.messages.runPreviewFirst'));
      return;
    }

    const confirmKey = dryRun ? 'refineFaces.messages.simulateConfirm' : 'refineFaces.messages.removeConfirm';
    const confirmMsg = t(confirmKey, {
      count: preview.summary.total_remove,
      people: preview.summary.affected_people
    });

    if (!dryRun && !(await confirm({ message: confirmMsg, variant: 'danger' }))) return;

    setIsLoading(true);

    try {
      const body = {
        mode,
        persons: config.person.trim() ? [config.person.trim()] : null,
        std_threshold: config.stdThreshold,
        cluster_dist: config.clusterDist,
        cluster_min: config.clusterMin,
        mahalanobis_threshold: config.mahalanobisThreshold,
        min_encodings: config.minEncodings,
        dry_run: dryRun
      };

      const result = await api.post('/api/v1/refinement/apply', body);

      if (dryRun) {
        showToast(t('refineFaces.messages.dryRunRemoved', { count: result.removed }), { type: 'info' });
      } else {
        showToast(t('refineFaces.messages.removed', { count: result.removed }), { type: 'success' });
        setPreview(null);  // Clear preview after successful apply
      }
    } catch (err) {
      debugError('RefineFaces', 'Apply failed:', err);
      showError(t('refineFaces.messages.applyFailed', { error: err.message }));
    } finally {
      setIsLoading(false);
    }
  }, [api, mode, config, preview, confirm, showToast]);

  /**
   * Apply shape repair
   */
  const handleRepairShapes = useCallback(async (dryRun = false) => {
    setIsLoading(true);
    clearStatus();

    try {
      const body = {
        persons: config.person.trim() ? [config.person.trim()] : null,
        dry_run: dryRun
      };

      const result = await api.post('/api/v1/refinement/repair-shapes', body);

      if (result.total_removed === 0) {
        showToast(t('refineFaces.messages.noInconsistentShapes'), { type: 'info' });
        return;
      }

      if (dryRun) {
        // Show the detailed per-person breakdown in a modal (replaces alert()).
        setRepairPreview({ count: result.total_removed, rows: result.repaired });
        showToast(t('refineFaces.messages.dryRunWrongShape', { count: result.total_removed }), { type: 'info' });
      } else {
        showToast(t('refineFaces.messages.inconsistentShapeRemoved', { count: result.total_removed }), { type: 'success' });
      }
    } catch (err) {
      debugError('RefineFaces', 'Repair shapes failed:', err);
      showError(t('refineFaces.messages.repairFailed', { error: err.message }));
    } finally {
      setIsLoading(false);
    }
  }, [api, config.person, showToast]);

  return (
    <div className="module-container refine-faces">
      <div className="module-header">
        <h3 className="module-title">{t('refineFaces.title')}</h3>
      </div>

      <div className="module-body">
        {/* Filter Mode Selection */}
        <div className="section-card">
          <h4 className="section-title">{t('refineFaces.sections.filterMode')}</h4>
          <div className="mode-selection">
            <label className="mode-option">
              <input
                type="radio"
                name="mode"
                value="std"
                checked={mode === 'std'}
                onChange={(e) => setMode(e.target.value)}
              />
              <span className="mode-label">{t('refineFaces.modes.std.label')}</span>
              <span className="mode-desc">{t('refineFaces.modes.std.desc')}</span>
            </label>

            <label className="mode-option">
              <input
                type="radio"
                name="mode"
                value="cluster"
                checked={mode === 'cluster'}
                onChange={(e) => setMode(e.target.value)}
              />
              <span className="mode-label">{t('refineFaces.modes.cluster.label')}</span>
              <span className="mode-desc">{t('refineFaces.modes.cluster.desc')}</span>
            </label>

            <label className="mode-option">
              <input
                type="radio"
                name="mode"
                value="mahalanobis"
                checked={mode === 'mahalanobis'}
                onChange={(e) => setMode(e.target.value)}
              />
              <span className="mode-label">{t('refineFaces.modes.mahalanobis.label')}</span>
              <span className="mode-desc">{t('refineFaces.modes.mahalanobis.desc')}</span>
            </label>

            <label className="mode-option">
              <input
                type="radio"
                name="mode"
                value="shape"
                checked={mode === 'shape'}
                onChange={(e) => setMode(e.target.value)}
              />
              <span className="mode-label">{t('refineFaces.modes.shape.label')}</span>
              <span className="mode-desc">{t('refineFaces.modes.shape.desc')}</span>
            </label>
          </div>
        </div>

        {/* Configuration */}
        <div className="section-card">
          <h4 className="section-title">{t('refineFaces.sections.settings')}</h4>
          <div className="config-grid">
            {/* Std threshold - only for std mode */}
            {mode === 'std' && (
              <div className="config-row">
                <label>{t('refineFaces.settings.stdThreshold')}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="5"
                  value={config.stdThreshold}
                  onChange={(e) => setConfig(prev => ({ ...prev, stdThreshold: parseFloat(e.target.value) || 2.0 }))}
                />
                <span className="config-unit">σ</span>
                <span className="config-hint">{t('refineFaces.settings.stdHint')}</span>
              </div>
            )}

            {/* Cluster distance - only for cluster mode */}
            {mode === 'cluster' && (
              <>
                <div className="config-row">
                  <label>{t('refineFaces.settings.clusterDist')}</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="1.0"
                    value={config.clusterDist}
                    onChange={(e) => setConfig(prev => ({ ...prev, clusterDist: parseFloat(e.target.value) || 0.35 }))}
                  />
                  <span className="config-hint">{t('refineFaces.settings.clusterDistHint')}</span>
                </div>
                <div className="config-row">
                  <label>{t('refineFaces.settings.clusterMin')}</label>
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={config.clusterMin}
                    onChange={(e) => setConfig(prev => ({ ...prev, clusterMin: parseInt(e.target.value, 10) || 6 }))}
                  />
                </div>
              </>
            )}

            {/* Mahalanobis threshold - only for mahalanobis mode */}
            {mode === 'mahalanobis' && (
              <div className="config-row">
                <label>{t('refineFaces.settings.mahalThreshold')}</label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="10"
                  value={config.mahalanobisThreshold}
                  onChange={(e) => setConfig(prev => ({ ...prev, mahalanobisThreshold: parseFloat(e.target.value) || 3.0 }))}
                />
                <span className="config-hint">{t('refineFaces.settings.mahalHint')}</span>
              </div>
            )}

            {/* Common settings - not for shape mode */}
            {mode !== 'shape' && (
              <div className="config-row">
                <label>{t('refineFaces.settings.minEncodings')}</label>
                <input
                  type="number"
                  min="2"
                  max="50"
                  value={config.minEncodings}
                  onChange={(e) => setConfig(prev => ({ ...prev, minEncodings: parseInt(e.target.value, 10) || 8 }))}
                />
                <span className="config-hint">{t('refineFaces.settings.minEncodingsHint')}</span>
              </div>
            )}

            {/* Person filter */}
            <div className="config-row">
              <label>{t('refineFaces.settings.person')}</label>
              <input
                type="text"
                placeholder={t('refineFaces.settings.personPlaceholder')}
                value={config.person}
                onChange={(e) => setConfig(prev => ({ ...prev, person: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="action-buttons">
          {mode === 'shape' ? (
            <>
              <Button
                variant="secondary"
                onClick={() => handleRepairShapes(true)}
                disabled={isLoading}
              >
                {t('refineFaces.buttons.simulateRepair')}
              </Button>
              <Button
                variant="danger"
                onClick={() => handleRepairShapes(false)}
                disabled={isLoading}
              >
                {t('refineFaces.buttons.repairShapes')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                onClick={handlePreview}
                loading={isLoading}
              >
                {isLoading ? t('refineFaces.buttons.loading') : t('refineFaces.buttons.preview')}
              </Button>
              {preview && preview.summary.total_remove > 0 && (
                <Button
                  variant="danger"
                  onClick={() => handleApply(false)}
                  disabled={isLoading}
                >
                  {t('refineFaces.buttons.applyFiltering')}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Preview Results */}
        {preview && preview.preview.length > 0 && (
          <div className="section-card preview-results">
            <h4 className="section-title">{t('refineFaces.preview.title')}</h4>
            {preview.warnings && preview.warnings.length > 0 && (
              <div className="preview-warnings">
                {preview.warnings.map((warning, idx) => (
                  <Alert key={idx} variant="warning">{warning}</Alert>
                ))}
              </div>
            )}
            <div className="preview-table-container">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>{t('refineFaces.table.person')}</th>
                    <th>{t('refineFaces.table.keep')}</th>
                    <th>{t('refineFaces.table.remove')}</th>
                    <th>{t('refineFaces.table.statistics')}</th>
                    <th>{t('refineFaces.table.reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row, idx) => (
                    <tr key={idx}>
                      <td className="cell-person">{row.person}</td>
                      <td className="cell-keep">{row.keep}</td>
                      <td className="cell-remove">{row.remove}</td>
                      <td className="cell-stats">
                        {row.stats ? (
                          <span title={`min=${row.stats.min_dist.toFixed(4)}, max=${row.stats.max_dist.toFixed(4)}`}>
                            μ={row.stats.mean_dist.toFixed(3)}, σ={row.stats.std_dist.toFixed(3)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="cell-reason">{formatReason(row.reason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="preview-summary">
              {t('refineFaces.preview.summaryPre')} <strong>{preview.summary.total_remove}</strong> {t('refineFaces.preview.summaryEncodings')} <strong>{preview.summary.affected_people}</strong> {t('refineFaces.preview.summaryOf', { total: preview.summary.total_people })}
            </div>
          </div>
        )}

        {/* Persistent error status */}
        {status.message && (
          <Alert
            variant={status.type === 'error' ? 'error' : (status.type || 'info')}
            onDismiss={clearStatus}
          >
            {status.message}
          </Alert>
        )}

        {/* Info Box */}
        <div className="info-box">
          <h5>{t('refineFaces.about.title')}</h5>
          <p>
            {t('refineFaces.about.supportedPre')} <strong>InsightFace</strong> {t('refineFaces.about.supportedPost')}
          </p>
          <p>
            <strong>{t('refineFaces.modes.std.label')}</strong> {t('refineFaces.about.stdText')}<br />
            <strong>{t('refineFaces.modes.cluster.label')}</strong> {t('refineFaces.about.clusterText')}<br />
            <strong>{t('refineFaces.modes.mahalanobis.label')}</strong> {t('refineFaces.about.mahalanobisText')}
          </p>
        </div>
      </div>

      {/* Shape-repair dry-run breakdown (replaces native alert) */}
      <Modal
        open={repairPreview !== null}
        onClose={() => setRepairPreview(null)}
        title={t('refineFaces.messages.repairModalTitle')}
        size="md"
        footer={
          <Button variant="secondary" onClick={() => setRepairPreview(null)}>
            {t('common.dismiss')}
          </Button>
        }
      >
        {repairPreview && (
          <>
            <p className="repair-modal-summary">
              {t('refineFaces.messages.dryRunWrongShape', { count: repairPreview.count })}
            </p>
            <ul className="repair-modal-list">
              {repairPreview.rows.map((r, idx) => (
                <li key={idx}>
                  {t('refineFaces.messages.repairDetail', {
                    person: r.person,
                    removed: r.removed,
                    total: r.total,
                    shape: r.kept_shape.join('x')
                  })}
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </div>
  );
}

/**
 * Format reason code to a localized display string.
 */
function formatReason(reason) {
  const key = `refineFaces.reasons.${reason}`;
  const label = t(key);
  return label === key ? reason : label;
}

export default RefineFacesModule;
