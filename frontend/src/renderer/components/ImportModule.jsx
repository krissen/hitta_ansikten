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
import { useModuleEvent } from '../hooks/useModuleEvent.js';
import { preferences } from '../workspace/preferences.js';
import { ProgressBar } from './ProgressBar.jsx';
import './ImportModule.css';

const DEFAULT_DEST = '~/Pictures/nerladdat';
const isMac = navigator.platform.toLowerCase().includes('mac');

export function ImportModule() {
  const { api } = useBackend();

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
  const [error, setError] = useState(null);

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

  // Live progress.
  const onProgress = useCallback((data) => {
    if (!data) return;
    setProgress(data.percent ?? null);
    setProgressLabel(`${data.current}/${data.total} · ${data.file || ''}`);
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
  // field and is persisted (mirrors onDestinationChange); no destination is a
  // no-op, leaving the preference default in place. The source card is
  // autodetected via loadVolumes, independent of this.
  useModuleEvent('import-load', (data) => {
    const dest = data?.destination;
    if (!dest) return;
    setDestination(dest);
    preferences.set('import.destination', dest);
  });

  const runImport = useCallback(async () => {
    if (!selectedMount || !destination.trim()) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress(0);
    setProgressLabel('');
    try {
      const res = await api.post('/api/v1/import/run', {
        volume_mount: selectedMount,
        destination: destination.trim(),
        mode,
        eject,
      });
      setResult(res);
      loadVolumes(); // card is likely gone after eject; refresh the list
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [api, selectedMount, destination, mode, eject, loadVolumes]);

  const selected = volumes.find((v) => v.mount === selectedMount);
  const canRun = !running && !!selectedMount && destination.trim() !== '';

  return (
    <div className="module-container import">
      <div className="module-header">
        <h3 className="module-title">Importera</h3>
        <div className="button-group">
          <button className="btn-secondary" onClick={loadVolumes} disabled={loadingVolumes || running}>
            {loadingVolumes ? '…' : 'Uppdatera'}
          </button>
        </div>
      </div>

      <div className="module-body import-body">
        {error && <div className="status-message error">Fel: {error}</div>}

        <label className="import-field">
          <span className="import-label">Minneskort</span>
          {volumes.length === 0 ? (
            <span className="import-empty">{loadingVolumes ? 'Söker…' : 'Inget minneskort hittat'}</span>
          ) : (
            <select
              className="form-select"
              value={selectedMount}
              onChange={(e) => setSelectedMount(e.target.value)}
              disabled={running}
            >
              {volumes.map((v) => (
                <option key={v.mount} value={v.mount}>
                  {v.name} — {v.nef_count} NEF ({formatBytes(v.total_bytes)})
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="import-field">
          <span className="import-label">Målmapp</span>
          <span className="import-dest-row">
            <input
              className="form-input import-dest"
              type="text"
              value={destination}
              onChange={onDestinationChange}
              disabled={running}
            />
            <button className="btn-secondary" onClick={pickDestination} disabled={running}>Välj…</button>
          </span>
        </label>

        <div className="import-field">
          <span className="import-label">Överföring</span>
          <span className="import-radios">
            <label className="form-checkbox">
              <input type="radio" name="mode" checked={mode === 'move'} onChange={() => setMode('move')} disabled={running} />
              Flytta
            </label>
            <label className="form-checkbox">
              <input type="radio" name="mode" checked={mode === 'copy'} onChange={() => setMode('copy')} disabled={running} />
              Kopiera
            </label>
          </span>
        </div>

        <label className="form-checkbox import-eject">
          <input type="checkbox" checked={eject} onChange={(e) => setEject(e.target.checked)} disabled={running || !isMac} />
          Mata ut efter överföring{!isMac && ' (endast macOS)'}
        </label>

        <div className="import-actions">
          <button className="btn-primary" onClick={runImport} disabled={!canRun}>
            {running ? 'Importerar…' : 'Importera'}
          </button>
          {selected && !running && (
            <span className="import-hint">{selected.nef_count} NEF redo att {mode === 'move' ? 'flyttas' : 'kopieras'}</span>
          )}
        </div>

        {running && (
          <div className="import-progress">
            <ProgressBar value={progress} size="md" showPercent />
            <span className="import-progress-label">{progressLabel}</span>
          </div>
        )}

        {result && !running && (
          <div className="import-result">
            <div><strong>{result.transferred.length}</strong> överförda{result.skipped.length > 0 && `, ${result.skipped.length} överhoppade`}</div>
            {result.ejected
              ? <div className="import-ok">Kortet utmatat ✓</div>
              : (eject && <div className="import-warn">Kortet ej utmatat</div>)}
            {result.errors.length > 0 && (
              <details className="import-errors">
                <summary>{result.errors.length} fel</summary>
                <ul>{result.errors.map((e, i) => <li key={i}>{e.path}: {e.error}</li>)}</ul>
              </details>
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
