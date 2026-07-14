/**
 * ImportModule - Transfer NEF off a camera card + eject.
 *
 * GUI for the import step: pick a detected card volume and a destination, choose
 * move/copy, transfer all NEFs (+ .xmp sidecars) with live progress, then eject.
 * Import-only — renaming (rename_nef) is a separate step.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useModuleEvent, useEmitEvent } from '../hooks/useModuleEvent.js';
import { useToast } from '../context/ToastContext.jsx';
import { preferences } from '../workspace/preferences.js';
import { setWorkingFolder } from '../shared/workingFolder.js';
import { Button, Alert, ProgressBar } from './shared';
import { t } from '../../i18n/index.js';
import './ImportModule.css';

const DEFAULT_DEST = '~/Pictures/nerladdat';
const isMac = navigator.platform.toLowerCase().includes('mac');

export function ImportModule() {
  const { api } = useBackend();
  const showToast = useToast();
  const emit = useEmitEvent();

  const [volumes, setVolumes] = useState([]);
  const [selectedMount, setSelectedMount] = useState('');
  const [destination, setDestination] = useState(
    () => preferences.get('import.destination') || DEFAULT_DEST
  );
  const [mode, setMode] = useState('move');
  const [eject, setEject] = useState(isMac);

  const [loadingVolumes, setLoadingVolumes] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [progressLabel, setProgressLabel] = useState('');
  const [result, setResult] = useState(null);
  // Completion summary from the WS "done" event (counts only). Backs the result
  // panel when the HTTP response is lost — a long import can outlive the request.
  const [doneSummary, setDoneSummary] = useState(null);
  const [error, setError] = useState(null);
  // Destination the last completed import actually wrote to. Captured at run
  // time so the "Döp om filer…" hand-off targets that folder even if the field
  // is edited afterwards.
  const [importedDest, setImportedDest] = useState('');

  const loadVolumes = useCallback(async () => {
    setLoadingVolumes(true);
    try {
      const data = await api.get('/api/v1/import/volumes');
      const vols = data.volumes || [];
      setVolumes(vols);
      setSelectedMount((prev) => {
        if (prev && vols.some((v) => v.mount === prev)) return prev;
        return vols[0]?.mount || '';
      });
      setError(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoadingVolumes(false);
    }
  }, [api]);

  useEffect(() => { loadVolumes(); }, [loadVolumes]);

  // Live progress + terminal "done" event.
  const onProgress = useCallback((data) => {
    if (!data) return;
    if (data.phase === 'done') {
      // Sole source of the summary when the HTTP response was lost, and a
      // harmless duplicate of it otherwise (the panel prefers the HTTP result).
      setDoneSummary({
        transferredCount: data.transferred,
        skippedCount: data.skipped,
        errorCount: data.errors,
        ejected: data.ejected,
        ejectError: data.eject_error,
        destination: data.destination,
      });
      if (data.destination) {
        setImportedDest(data.destination);
        setWorkingFolder({ roots: [data.destination], step: 'import' });
      }
      // Clear any error banner raised by a lost HTTP response — the transfer
      // completed server-side, so the summary must not sit under a stale error.
      setError(null);
      setRunning(false);
      setProgress(null);
      return;
    }
    setProgress(data.percent ?? null);
    setProgressLabel(t('import.progressLabel', {
      current: data.current,
      total: data.total,
      file: data.file || '',
    }));
  }, []);
  useWebSocket('import-progress', onProgress);

  const pickDestination = useCallback(async () => {
    try {
      const paths = await window.ansiktenAPI.invoke('open-folder-paths');
      if (paths && paths.length) {
        setDestination(paths[0]);
        preferences.set('import.destination', paths[0]);
      }
    } catch (err) {
      console.error('[Import] folder pick failed', err);
    }
  }, []);

  const onDestinationChange = useCallback((e) => {
    setDestination(e.target.value);
    preferences.set('import.destination', e.target.value);
  }, []);

  // CLI hand-off from `ansikten import [DEST]`. A given destination pre-fills the
  // field and is persisted (mirrors onDestinationChange); no destination leaves
  // the preference default in place.
  useModuleEvent('import-load', (data) => {
    const dest = data?.destination;
    if (dest) {
      setDestination(dest);
      preferences.set('import.destination', dest);
    }
    // A CLI `ansikten import` is the most likely "I just inserted a card"
    // moment. loadVolumes otherwise runs only on mount, so an already-open
    // module would show a stale/empty card dropdown until manual refresh —
    // re-scan here so the command delivers on its "card autodetected" promise.
    loadVolumes();
  }, [loadVolumes]);

  const runImport = useCallback(async () => {
    if (!selectedMount || !destination.trim()) return;
    setRunning(true);
    setResult(null);
    setDoneSummary(null);
    setError(null);
    setProgress(0);
    setProgressLabel('');
    const usedDestination = destination.trim();
    // No client timeout: a large card import (hundreds of NEF, tens of GB) runs
    // for minutes and must not be aborted mid-transfer.
    let ongoing = false;
    try {
      const res = await api.post('/api/v1/import/run', {
        volume_mount: selectedMount,
        destination: usedDestination,
        mode,
        eject,
      }, { timeout: 0 });
      setResult(res);
      setImportedDest(usedDestination);
      // Anchor the pipeline on the just-imported folder so the rename step can
      // pre-fill from it (opt-in; the anchor is a pointer, not an auto-load).
      setWorkingFolder({ roots: [usedDestination], step: 'import' });
      // Transient receipt of the completed transfer; the result panel below
      // keeps the persistent, inspectable breakdown (skipped/errors/eject).
      const count = res.transferred?.length ?? 0;
      showToast(t('import.doneToast', { count, dest: usedDestination }), {
        type: res.errors?.length ? 'warning' : 'success',
      });
      loadVolumes(); // card is likely gone after eject; refresh the list
    } catch (err) {
      // A lost response — timed out, offline, or a reset connection — is not a
      // failure: the transfer is still running server-side and the WS "done"
      // event owns the final summary. Such errors carry no HTTP status
      // (`statusCode == null`); only a genuine backend response (4xx/5xx, which
      // sets `statusCode`) surfaces as an error here. Without this a dropped
      // connection would show a false error and re-enable the button mid-import,
      // and the WS summary would later render under a stale error banner.
      if (err?.statusCode == null) {
        ongoing = true;
      } else {
        setError(err.message || String(err));
      }
    } finally {
      if (!ongoing) {
        setRunning(false);
        setProgress(null);
      }
    }
  }, [api, selectedMount, destination, mode, eject, loadVolumes, showToast]);

  // Hand the just-imported folder to the rename step (opt-in; never auto-opened).
  const openRename = useCallback(() => {
    if (!importedDest) return;
    emit('open-rename-nef', { roots: [importedDest] });
  }, [emit, importedDest]);

  const selected = volumes.find((v) => v.mount === selectedMount);
  const canRun = !running && !!selectedMount && destination.trim() !== '';

  // Completion summary, normalized from whichever source arrived: the HTTP
  // response (full detail, incl. the per-file error list) is preferred; the WS
  // "done" event (counts only) is the fallback when the response was lost.
  const summary = result
    ? {
        transferredCount: result.transferred.length,
        skippedCount: result.skipped.length,
        errorCount: result.errors.length,
        errorList: result.errors,
        ejected: result.ejected,
        ejectError: result.eject_error,
        destination: importedDest,
      }
    : doneSummary;

  return (
    <div className="module-container import">
      <div className="module-header">
        <h3 className="module-title">{t('import.title')}</h3>
        <div className="button-group">
          <Button variant="secondary" size="sm" onClick={loadVolumes} disabled={loadingVolumes || running}>
            {loadingVolumes ? '…' : t('import.refresh')}
          </Button>
        </div>
      </div>

      <div className="module-body import-body">
        {error && <Alert variant="error">{t('import.errorPrefix', { message: error })}</Alert>}

        <label className="import-field">
          <span className="import-label">{t('import.cardLabel')}</span>
          {volumes.length === 0 ? (
            <span className="import-empty">{loadingVolumes ? t('import.searching') : t('import.noCard')}</span>
          ) : (
            <select
              className="form-select"
              value={selectedMount}
              onChange={(e) => setSelectedMount(e.target.value)}
              disabled={running}
            >
              {volumes.map((v) => (
                <option key={v.mount} value={v.mount}>
                  {t('import.volumeOption', {
                    name: v.name,
                    count: v.nef_count,
                    size: formatBytes(v.total_bytes),
                  })}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="import-field">
          <span className="import-label">{t('import.destLabel')}</span>
          <span className="import-dest-row">
            <input
              className="form-input import-dest"
              type="text"
              value={destination}
              onChange={onDestinationChange}
              disabled={running}
            />
            <Button variant="secondary" onClick={pickDestination} disabled={running}>{t('import.pick')}</Button>
          </span>
        </label>

        <div className="import-field">
          <span className="import-label">{t('import.transferLabel')}</span>
          <span className="import-radios">
            <label className="form-checkbox">
              <input type="radio" name="mode" checked={mode === 'move'} onChange={() => setMode('move')} disabled={running} />
              {t('import.move')}
            </label>
            <label className="form-checkbox">
              <input type="radio" name="mode" checked={mode === 'copy'} onChange={() => setMode('copy')} disabled={running} />
              {t('import.copy')}
            </label>
          </span>
        </div>

        <label className="form-checkbox import-eject">
          <input type="checkbox" checked={eject} onChange={(e) => setEject(e.target.checked)} disabled={running || !isMac} />
          {isMac ? t('import.eject') : t('import.ejectMacOnly')}
        </label>

        <div className="import-actions">
          <Button variant="primary" onClick={runImport} disabled={!canRun}>
            {running ? t('import.running') : t('import.run')}
          </Button>
          {selected && !running && (
            <span className="import-hint">
              {t(mode === 'move' ? 'import.readyToMove' : 'import.readyToCopy', { count: selected.nef_count })}
            </span>
          )}
        </div>

        {running && (
          <div className="import-progress">
            <ProgressBar value={progress} size="md" showPercent />
            <span className="import-progress-label">{progressLabel}</span>
          </div>
        )}

        {summary && !running && (
          <div className="import-result">
            <div>
              <strong>{summary.transferredCount}</strong> {t('import.transferred')}
              {summary.skippedCount > 0 && t('import.skippedSuffix', { count: summary.skippedCount })}
            </div>
            {summary.destination && (
              <div className="import-dest-used">{t('import.destUsed', { path: summary.destination })}</div>
            )}
            {summary.ejected && <div className="import-ok">{t('import.ejected')}</div>}
            {!summary.ejected && summary.ejectError && (
              <div className="import-warn">{t('import.ejectFailed')}</div>
            )}
            {Array.isArray(summary.errorList) && summary.errorList.length > 0 && (
              <details className="import-errors">
                <summary>{t('import.errorsSummary', { count: summary.errorList.length })}</summary>
                <ul>{summary.errorList.map((e, i) => <li key={i}>{e.path}: {e.error}</li>)}</ul>
              </details>
            )}
            {!summary.errorList && summary.errorCount > 0 && (
              <div className="import-warn">{t('import.errorsSummary', { count: summary.errorCount })}</div>
            )}
            {importedDest && (
              <div className="import-next">
                <Button variant="secondary" size="sm" onClick={openRename}>
                  {t('import.openRename')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export default ImportModule;
