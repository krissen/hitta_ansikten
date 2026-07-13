/**
 * RenameNefModule - EXIF-based NEF renaming (YYMMDD_HHMMSS.NEF).
 *
 * GUI for the rename_nef CLI: pick a folder (optionally narrow by glob), preview
 * the EXIF-derived rename mapping, then confirm. Preview is the dry-run; execute
 * renames NEFs (+ .xmp sidecars), never overwriting an existing target.
 */

import React, { useState, useCallback } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useModuleEvent, useEmitEvent } from '../hooks/useModuleEvent.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { preferences } from '../workspace/preferences.js';
import { getWorkingFolder, setWorkingFolder } from '../shared/workingFolder.js';
import { Button, IconButton, Alert, EmptyState, ProgressBar } from './shared';
import { t } from '../../i18n/index.js';
import './RenameNefModule.css';

export function RenameNefModule() {
  const { api } = useBackend();
  const showToast = useToast();
  const emit = useEmitEvent();

  // Pre-fill so the common "import then rename" flow starts pointed at the
  // right folder. Prefer the working-folder anchor (set by the just-run import),
  // then fall back to the import.destination preference, then empty. Backend
  // file_resolver expands ~, so a stored ~-path is fine to pass through.
  const [roots, setRoots] = useState(() => {
    const anchored = getWorkingFolder()?.roots;
    if (anchored && anchored.length) return [...anchored];
    const dest = preferences.get('import.destination');
    return dest ? [dest] : [];
  });
  const [glob, setGlob] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  // Roots that the last execute actually ran on, frozen at execute-start so the
  // "Granska ansikten…" hand-off scopes Review to the renamed folder even if the
  // live `roots` selection is edited afterwards (cf. ImportModule.importedDest).
  const [resultRoots, setResultRoots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Latest rename-nef-progress event (null until the first arrives → the bar
  // shows an indeterminate "preparing" state rather than looking frozen).
  const [progress, setProgress] = useState(null);

  const onProgress = useCallback((data) => {
    if (data) setProgress(data);
  }, []);
  useWebSocket('rename-nef-progress', onProgress);

  const params = useCallback(() => ({
    roots,
    globs: glob.trim() ? [glob.trim()] : [],
    recursive: true,
  }), [roots, glob]);

  // Hand-off from Import ("Döp om filer…"): scope the module strictly to the
  // imported folder(s). REPLACE roots (not union) — the pre-filled default root
  // can be stale (the import destination field may have been edited after the
  // import). Also CLEAR any leftover glob: params() forwards it and the backend
  // resolver unions glob matches with the root scan, so a stale pattern like
  // /old/*.NEF would pull in files outside the just-imported folder.
  useModuleEvent('rename-nef-load', (data) => {
    const incoming = data?.roots || [];
    if (incoming.length) {
      setRoots(Array.from(new Set(incoming)));
      setGlob('');
      // The import hand-off is authoritative about the event folder; keep the
      // anchor in step with it (still tagged 'import' — rename hasn't run yet).
      setWorkingFolder({ roots: incoming, step: 'import' });
    }
    setPreview(null);
    setResult(null);
    setError(null);
  }, []);

  const addFolder = useCallback(async () => {
    try {
      const paths = await window.ansiktenAPI.invoke('open-folder-paths');
      if (paths && paths.length) {
        setRoots((r) => Array.from(new Set([...r, ...paths])));
        setPreview(null);
        setResult(null);
      }
    } catch (err) {
      console.error('[RenameNef] folder pick failed', err);
    }
  }, []);

  const doPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const data = await api.post('/api/v1/rename-nef/preview', params());
      setPreview(data);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [api, params]);

  const doExecute = useCallback(async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    // Freeze the folders this run targets before the await.
    const usedRoots = [...roots];
    try {
      const data = await api.post('/api/v1/rename-nef/execute', params());
      setResult(data);
      setResultRoots(usedRoots);
      setPreview(null);
      // Rename finished on these folders — advance the anchor to 'rename' so the
      // next step (review/count) can pre-fill from the same event folder.
      if (usedRoots.length) setWorkingFolder({ roots: usedRoots, step: 'rename' });
      // Transient receipt; the result panel keeps the persistent breakdown.
      const count = data.renamed?.length ?? 0;
      showToast(t('renameNef.doneToast', { count }), {
        type: data.errors?.length ? 'warning' : 'success',
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [api, params, roots, showToast]);

  const canPreview = !busy && (roots.length > 0 || glob.trim() !== '');
  const canExecute = !busy && preview && preview.to_rename > 0;

  return (
    <div className="module-container rename-nef" data-keyboard-scope="isolated">
      <div className="rename-nef-bar">
        <Button variant="secondary" onClick={addFolder} disabled={busy}>{t('renameNef.addFolder')}</Button>
        <input
          className="form-input rename-nef-glob"
          type="text"
          aria-label={t('renameNef.globLabel')}
          placeholder={t('renameNef.globPlaceholder')}
          value={glob}
          onChange={(e) => { setGlob(e.target.value); setPreview(null); setResult(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') canPreview && doPreview(); }}
          disabled={busy}
        />
        <Button variant="secondary" onClick={doPreview} disabled={!canPreview}>
          {busy ? '…' : t('renameNef.preview')}
        </Button>
        <Button variant="primary" onClick={doExecute} disabled={!canExecute}>
          {t('renameNef.execute')}
        </Button>
      </div>

      {roots.length > 0 && (
        <div className="rename-nef-roots">
          {roots.map((r) => (
            <span className="rename-nef-chip" key={r} title={r}>
              {basename(r)}
              <IconButton
                icon="close"
                label={t('renameNef.removeFolder', { name: basename(r) })}
                variant="ghost"
                size="sm"
                className="rename-nef-chip-x"
                onClick={() => { setRoots((rs) => rs.filter((x) => x !== r)); setPreview(null); }}
                disabled={busy}
              />
            </span>
          ))}
        </div>
      )}

      {busy && (
        <div className="rename-nef-progress">
          <ProgressBar
            value={progress ? progress.percent : null}
            size="md"
            showPercent
          />
          <span className="rename-nef-progress-label">
            {progress
              ? t('renameNef.progressLabel', { current: progress.current, total: progress.total })
              : t('renameNef.progressPreparing')}
          </span>
        </div>
      )}

      <div className="module-body rename-nef-body">
        {error && <Alert variant="error">{t('renameNef.errorPrefix', { message: error })}</Alert>}

        {!preview && !result && !error && (
          <EmptyState
            title={
              <>
                {t('renameNef.emptyPromptPrefix')}
                <strong>{t('renameNef.emptyPromptAction')}</strong>
                {t('renameNef.emptyPromptSuffix')}
              </>
            }
          />
        )}

        {preview && (
          <>
            <div className="rename-nef-summary">
              <strong>{preview.to_rename}</strong> {t('renameNef.summaryCount')}
              {preview.already_named > 0 && t('renameNef.alreadyNamedSuffix', { count: preview.already_named })}
              {preview.no_date.length > 0 && t('renameNef.noDateSuffix', { count: preview.no_date.length })}
            </div>
            {preview.to_rename === 0 ? (
              <EmptyState title={t('renameNef.nothingToRename')} />
            ) : (
              <table className="rename-nef-table">
                <thead><tr><th>{t('renameNef.tableOriginal')}</th><th></th><th>{t('renameNef.tableNewName')}</th></tr></thead>
                <tbody>
                  {preview.items.map((it) => (
                    <tr key={it.original_path}>
                      <td>{it.original}</td>
                      <td className="rename-nef-arrow">→</td>
                      <td>{it.new_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview.no_date.length > 0 && (
              <details className="rename-nef-nodate">
                <summary>{t('renameNef.noDateSummary', { count: preview.no_date.length })}</summary>
                <ul>{preview.no_date.map((n) => <li key={n}>{n}</li>)}</ul>
              </details>
            )}
          </>
        )}

        {result && (
          <div className="rename-nef-result">
            <div>
              <strong>{result.renamed.length}</strong> {t('renameNef.renamed')}
              {result.skipped.length > 0 && t('renameNef.skippedSuffix', { count: result.skipped.length })}
            </div>
            {result.skipped.length > 0 && (
              <details><summary>{t('renameNef.skippedDetails')}</summary>
                <ul>{result.skipped.map((s, i) => <li key={i}>{basename(s.path)}: {s.reason}</li>)}</ul>
              </details>
            )}
            {result.errors.length > 0 && (
              <details className="rename-nef-errors"><summary>{t('renameNef.errorsSummary', { count: result.errors.length })}</summary>
                <ul>{result.errors.map((e, i) => <li key={i}>{e.path}: {e.error}</li>)}</ul>
              </details>
            )}
            {resultRoots.length > 0 && (
              <div className="rename-nef-result-actions">
                <Button
                  variant={result.errors.length > 0 ? 'secondary' : 'primary'}
                  onClick={() => emit('open-review-queue', { roots: resultRoots })}
                >
                  {t('renameNef.reviewFaces')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function basename(p) {
  const parts = String(p).replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

export default RenameNefModule;
