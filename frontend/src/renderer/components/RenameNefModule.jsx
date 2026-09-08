/**
 * RenameNefModule - EXIF-based NEF renaming (YYMMDD_HHMMSS.NEF).
 *
 * GUI for the rename_nef CLI: pick a folder (optionally narrow by glob), preview
 * the EXIF-derived rename mapping, then confirm. Preview is the dry-run; execute
 * renames NEFs (+ .xmp sidecars), never overwriting an existing target.
 *
 * Already-named files (their stem already carries the EXIF timestamp, with an
 * optional -N burst / _Name suffix) are protected by default; the "include
 * named" opt-in renames them anyway and strips the suffix. A separate recovery
 * action re-applies confirmed names by SHA1 lookup after an accidental strip.
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
  // Persisted (default off): whether to descend into subfolders.
  const [recursive, setRecursive] = useState(
    () => preferences.get('renameNef.recursive') === true,
  );
  // NOT persisted — always starts off each session, so a destructive strip of
  // already-named files can never be armed silently.
  const [includeNamed, setIncludeNamed] = useState(false);
  const [preview, setPreview] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [result, setResult] = useState(null);
  const [restoreResult, setRestoreResult] = useState(null);
  // Undo (reverse the last rename/move batch from the journal).
  const [undoBatches, setUndoBatches] = useState([]);
  const [undoBatchId, setUndoBatchId] = useState(null);
  const [undoPreview, setUndoPreview] = useState(null);
  const [undoResult, setUndoResult] = useState(null);
  // Roots that the last execute actually ran on, frozen at execute-start so the
  // "Granska ansikten…" hand-off scopes Review to the renamed folder even if the
  // live `roots` selection is edited afterwards (cf. ImportModule.importedDest).
  const [resultRoots, setResultRoots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Latest progress event (null until the first arrives → the bar shows an
  // indeterminate "preparing" state rather than looking frozen).
  const [progress, setProgress] = useState(null);

  const onProgress = useCallback((data) => {
    if (data) setProgress(data);
  }, []);
  useWebSocket('rename-nef-progress', onProgress);
  useWebSocket('restore-names-progress', onProgress);

  const params = useCallback(
    () => ({
      roots,
      globs: glob.trim() ? [glob.trim()] : [],
      recursive,
      include_named: includeNamed,
    }),
    [roots, glob, recursive, includeNamed],
  );

  // Drop pending previews (scope changed) but KEEP any result panel — the last
  // run's result stays visible (and its frozen resultRoots hand-off usable) even
  // as the live selection is edited afterwards.
  const clearPreviews = useCallback(() => {
    setPreview(null);
    setRestorePreview(null);
  }, []);

  const clearAll = useCallback(() => {
    setPreview(null);
    setRestorePreview(null);
    setResult(null);
    setRestoreResult(null);
    setUndoPreview(null);
    setUndoResult(null);
  }, []);

  // Hand-off from Import ("Döp om filer…"): scope the module strictly to the
  // imported folder(s). REPLACE roots (not union) — the pre-filled default root
  // can be stale (the import destination field may have been edited after the
  // import). Also CLEAR any leftover glob: params() forwards it and the backend
  // resolver unions glob matches with the root scan, so a stale pattern like
  // /old/*.NEF would pull in files outside the just-imported folder.
  useModuleEvent(
    'rename-nef-load',
    (data) => {
      const incoming = data?.roots || [];
      if (incoming.length) {
        setRoots(Array.from(new Set(incoming)));
        setGlob('');
        // The import hand-off is authoritative about the event folder; keep the
        // anchor in step with it (still tagged 'import' — rename hasn't run yet).
        setWorkingFolder({ roots: incoming, step: 'import' });
      }
      // Re-arming a new working set must not carry a live strip opt-in.
      setIncludeNamed(false);
      clearAll();
      setError(null);
    },
    [clearAll],
  );

  const addFolder = useCallback(async () => {
    try {
      const paths = await window.ansiktenAPI.invoke('open-folder-paths');
      if (paths && paths.length) {
        setRoots((r) => Array.from(new Set([...r, ...paths])));
        clearAll();
      }
    } catch (err) {
      console.error('[RenameNef] folder pick failed', err);
    }
  }, [clearAll]);

  const doPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    clearAll();
    setProgress(null);
    try {
      const data = await api.post('/api/v1/rename-nef/preview', params());
      setPreview(data);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [api, params, clearAll]);

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
      // A destructive strip is a one-shot action — disarm after it runs.
      setIncludeNamed(false);
      // Rename finished on these folders — advance the anchor to 'rename' so the
      // next step (review/count) can pre-fill from the same event folder.
      if (usedRoots.length)
        setWorkingFolder({ roots: usedRoots, step: 'rename' });
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

  const restoreParams = useCallback(
    () => ({
      roots,
      globs: glob.trim() ? [glob.trim()] : [],
      recursive,
    }),
    [roots, glob, recursive],
  );

  const doRestorePreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    clearAll();
    setProgress(null);
    try {
      const data = await api.post(
        '/api/v1/rename-nef/restore-names/preview',
        restoreParams(),
      );
      setRestorePreview(data);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [api, restoreParams, clearAll]);

  const doRestoreExecute = useCallback(async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const data = await api.post(
        '/api/v1/rename-nef/restore-names/execute',
        restoreParams(),
      );
      setRestoreResult(data);
      setRestorePreview(null);
      const count = data.renamed?.length ?? 0;
      showToast(t('renameNef.restoreDoneToast', { count }), {
        type: data.errors?.length ? 'warning' : 'success',
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [api, restoreParams, showToast]);

  // Preview undoing a specific batch (dry-run: shows from → to, skip marks).
  const previewUndoBatch = useCallback(
    async (batchId) => {
      const data = await api.post('/api/v1/rename-journal/undo', {
        batch_id: batchId,
        execute: false,
      });
      setUndoPreview(data);
      setUndoBatchId(batchId);
    },
    [api],
  );

  // "Ångra senaste namnbyte…": fetch undoable batches, default to the newest.
  const doUndoPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    clearAll();
    setProgress(null);
    try {
      const { batches } = await api.get('/api/v1/rename-journal/batches');
      const undoable = (batches || []).filter((b) => b.undoable);
      setUndoBatches(undoable);
      if (undoable.length === 0) {
        showToast(t('renameNef.undoNoBatches'), { type: 'info' });
        return;
      }
      await previewUndoBatch(undoable[0].batch_id);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [api, clearAll, previewUndoBatch, showToast]);

  // Re-preview when the user picks a different batch from the selector.
  const onSelectUndoBatch = useCallback(
    async (batchId) => {
      setBusy(true);
      setError(null);
      setUndoResult(null);
      try {
        await previewUndoBatch(batchId);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        setBusy(false);
      }
    },
    [previewUndoBatch],
  );

  const doUndoExecute = useCallback(async () => {
    if (!undoBatchId) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const data = await api.post('/api/v1/rename-journal/undo', {
        batch_id: undoBatchId,
        execute: true,
      });
      setUndoResult(data);
      setUndoPreview(null);
      const count = data.reverted ?? 0;
      showToast(t('renameNef.undoDoneToast', { count }), {
        type: data.errors > 0 ? 'warning' : 'success',
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [api, undoBatchId, showToast]);

  const hasScope = roots.length > 0 || glob.trim() !== '';
  const canPreview = !busy && hasScope;
  const canExecute = !busy && preview && preview.to_rename > 0;
  const canRestore = !busy && restorePreview && restorePreview.to_restore > 0;
  const canUndo = !busy && undoPreview && undoPreview.to_revert > 0;

  return (
    <div className="module-container rename-nef" data-keyboard-scope="isolated">
      <div className="rename-nef-bar">
        <Button variant="secondary" onClick={addFolder} disabled={busy}>
          {t('renameNef.addFolder')}
        </Button>
        <input
          className="form-input rename-nef-glob"
          type="text"
          aria-label={t('renameNef.globLabel')}
          placeholder={t('renameNef.globPlaceholder')}
          value={glob}
          onChange={(e) => {
            setGlob(e.target.value);
            clearAll();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') canPreview && doPreview();
          }}
          disabled={busy}
        />
        <Button variant="secondary" onClick={doPreview} disabled={!canPreview}>
          {busy ? '…' : t('renameNef.preview')}
        </Button>
        <Button variant="primary" onClick={doExecute} disabled={!canExecute}>
          {t('renameNef.execute')}
        </Button>
        <Button
          variant="secondary"
          onClick={doRestorePreview}
          disabled={!canPreview}
        >
          {t('renameNef.restore')}
        </Button>
        <Button variant="secondary" onClick={doUndoPreview} disabled={busy}>
          {t('renameNef.undo')}
        </Button>
      </div>

      <div className="rename-nef-options">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => {
              const v = e.target.checked;
              setRecursive(v);
              preferences.set('renameNef.recursive', v);
              clearPreviews();
            }}
            disabled={busy}
          />
          {t('renameNef.recursiveLabel')}
        </label>
        <label className="form-checkbox rename-nef-danger-toggle">
          <input
            type="checkbox"
            checked={includeNamed}
            onChange={(e) => {
              setIncludeNamed(e.target.checked);
              setPreview(null);
              setResult(null);
            }}
            disabled={busy}
          />
          {t('renameNef.includeNamedLabel')}
        </label>
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
                onClick={() => {
                  setRoots((rs) => rs.filter((x) => x !== r));
                  clearPreviews();
                }}
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
              ? t('renameNef.progressLabel', {
                  current: progress.current,
                  total: progress.total,
                })
              : t('renameNef.progressPreparing')}
          </span>
        </div>
      )}

      <div className="module-body rename-nef-body">
        {error && (
          <Alert variant="error">
            {t('renameNef.errorPrefix', { message: error })}
          </Alert>
        )}

        {!preview &&
          !restorePreview &&
          !result &&
          !restoreResult &&
          !undoPreview &&
          !undoResult &&
          !error && (
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
              {preview.already_named > 0 &&
                t('renameNef.alreadyNamedSuffix', {
                  count: preview.already_named,
                })}
              {preview.no_date.length > 0 &&
                t('renameNef.noDateSuffix', { count: preview.no_date.length })}
            </div>
            {preview.named_affected > 0 && (
              <Alert variant="warning">
                {t('renameNef.namedAffectedWarning', {
                  count: preview.named_affected,
                })}
              </Alert>
            )}
            {preview.to_rename === 0 ? (
              <EmptyState title={t('renameNef.nothingToRename')} />
            ) : (
              <table className="rename-nef-table">
                <thead>
                  <tr>
                    <th>{t('renameNef.tableOriginal')}</th>
                    <th></th>
                    <th>{t('renameNef.tableNewName')}</th>
                  </tr>
                </thead>
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
                <summary>
                  {t('renameNef.noDateSummary', {
                    count: preview.no_date.length,
                  })}
                </summary>
                <ul>
                  {preview.no_date.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {restorePreview && (
          <>
            <div className="rename-nef-summary">
              <strong>{restorePreview.to_restore}</strong>{' '}
              {t('renameNef.restoreSummaryCount')}
              {restorePreview.already_correct > 0 &&
                t('renameNef.restoreCorrectSuffix', {
                  count: restorePreview.already_correct,
                })}
              {restorePreview.no_record.length > 0 &&
                t('renameNef.restoreNoRecordSuffix', {
                  count: restorePreview.no_record.length,
                })}
            </div>
            {restorePreview.to_restore === 0 ? (
              <EmptyState
                title={
                  restorePreview.total_files > 0
                    ? t('renameNef.restoreNothing')
                    : t('renameNef.restoreEmptyPrompt')
                }
              />
            ) : (
              <>
                <table className="rename-nef-table">
                  <thead>
                    <tr>
                      <th>{t('renameNef.tableOriginal')}</th>
                      <th></th>
                      <th>{t('renameNef.tableNewName')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restorePreview.items.map((it) => (
                      <tr key={it.original_path}>
                        <td>{it.original}</td>
                        <td className="rename-nef-arrow">→</td>
                        <td>{it.new_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="rename-nef-result-actions">
                  <Button
                    variant="primary"
                    onClick={doRestoreExecute}
                    disabled={!canRestore}
                  >
                    {t('renameNef.restoreExecute')}
                  </Button>
                </div>
              </>
            )}
            {restorePreview.no_record.length > 0 && (
              <details className="rename-nef-nodate">
                <summary>
                  {t('renameNef.restoreNoRecordSummary', {
                    count: restorePreview.no_record.length,
                  })}
                </summary>
                <ul>
                  {restorePreview.no_record.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {result && (
          <div className="rename-nef-result">
            <div>
              <strong>{result.renamed.length}</strong> {t('renameNef.renamed')}
              {result.skipped.length > 0 &&
                t('renameNef.skippedSuffix', { count: result.skipped.length })}
            </div>
            {result.skipped.length > 0 && (
              <details>
                <summary>{t('renameNef.skippedDetails')}</summary>
                <ul>
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      {basename(s.path)}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {result.errors.length > 0 && (
              <details className="rename-nef-errors">
                <summary>
                  {t('renameNef.errorsSummary', {
                    count: result.errors.length,
                  })}
                </summary>
                <ul>
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      {e.path}: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {resultRoots.length > 0 && (
              <div className="rename-nef-result-actions handoff-next">
                <Button
                  variant="primary"
                  onClick={() =>
                    emit('open-review-queue', { roots: resultRoots })
                  }
                >
                  {t('renameNef.reviewFaces')}
                </Button>
              </div>
            )}
          </div>
        )}

        {restoreResult && (
          <div className="rename-nef-result">
            <div>
              <strong>{restoreResult.renamed.length}</strong>{' '}
              {t('renameNef.restored')}
              {restoreResult.skipped.length > 0 &&
                t('renameNef.skippedSuffix', {
                  count: restoreResult.skipped.length,
                })}
            </div>
            {restoreResult.skipped.length > 0 && (
              <details>
                <summary>{t('renameNef.skippedDetails')}</summary>
                <ul>
                  {restoreResult.skipped.map((s, i) => (
                    <li key={i}>
                      {basename(s.path)}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {restoreResult.errors.length > 0 && (
              <details className="rename-nef-errors">
                <summary>
                  {t('renameNef.errorsSummary', {
                    count: restoreResult.errors.length,
                  })}
                </summary>
                <ul>
                  {restoreResult.errors.map((e, i) => (
                    <li key={i}>
                      {e.path}: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {undoPreview && (
          <>
            {undoBatches.length > 1 && (
              <label className="rename-nef-undo-select">
                {t('renameNef.undoBatchLabel')}
                <select
                  className="form-input"
                  value={undoBatchId || ''}
                  onChange={(e) => onSelectUndoBatch(e.target.value)}
                  disabled={busy}
                >
                  {undoBatches.map((b) => (
                    <option key={b.batch_id} value={b.batch_id}>
                      {t('renameNef.undoBatchOption', {
                        label: undoLabel(b.tool),
                        count: b.count,
                        time: formatTime(b.ts),
                      })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="rename-nef-undo-header">
              {t('renameNef.undoPreviewHeader', {
                label: undoLabel(undoPreview.tool),
                count: undoPreview.count,
                time: formatTime(undoPreview.ts),
              })}
            </div>
            <div className="rename-nef-summary">
              <strong>{undoPreview.to_revert}</strong>{' '}
              {t('renameNef.undoSummaryPrefix')}
              {undoPreview.to_skip > 0 &&
                t('renameNef.undoSkipSuffix', { count: undoPreview.to_skip })}
            </div>
            {undoPreview.to_revert === 0 ? (
              <EmptyState title={t('renameNef.undoNothing')} />
            ) : (
              <>
                <table className="rename-nef-table">
                  <thead>
                    <tr>
                      <th>{t('renameNef.tableOriginal')}</th>
                      <th></th>
                      <th>{t('renameNef.tableNewName')}</th>
                      <th>{t('renameNef.undoSkipReasonColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {undoPreview.items.map((it) => (
                      <tr
                        key={it.from}
                        className={
                          it.status === 'skip'
                            ? 'rename-nef-row-skip'
                            : undefined
                        }
                      >
                        <td>{it.from_name}</td>
                        <td className="rename-nef-arrow">→</td>
                        <td>{it.to_name}</td>
                        <td>
                          {it.status === 'skip'
                            ? it.reason || t('renameNef.undoWillSkip')
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="rename-nef-result-actions">
                  <Button
                    variant="primary"
                    onClick={doUndoExecute}
                    disabled={!canUndo}
                  >
                    {t('renameNef.undoExecute')}
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {undoResult && (
          <div className="rename-nef-result">
            <div>
              <strong>{undoResult.reverted}</strong> {t('renameNef.undone')}
              {undoResult.skipped > 0 &&
                t('renameNef.skippedSuffix', { count: undoResult.skipped })}
            </div>
            {undoResult.results.some((r) => r.status !== 'reverted') && (
              <details>
                <summary>{t('renameNef.skippedDetails')}</summary>
                <ul>
                  {undoResult.results
                    .filter((r) => r.status !== 'reverted')
                    .map((r, i) => (
                      <li key={i}>
                        {basename(r.path)}: {r.reason || r.status}
                      </li>
                    ))}
                </ul>
              </details>
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

// Compact local time for the batch selector; falls back to the raw ISO string
// if the timestamp can't be parsed.
function formatTime(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? String(ts || '')
    : d.toLocaleString('sv-SE');
}

// Swedish label for an undo batch so the header/selector name the action being
// undone (e.g. "Namnbyte (NEF)") rather than a raw tool slug. Only rename
// batches are undoable (import moves/copies and trash are excluded), so every
// undoable batch's op is "rename" — the tool alone names it.
function undoLabel(tool) {
  return (
    {
      rename: t('renameNef.undoToolRename'),
      'rename-nef': t('renameNef.undoToolRenameNef'),
      'restore-names': t('renameNef.undoToolRestoreNames'),
      culling: t('renameNef.undoToolCulling'),
      undo: t('renameNef.undoToolUndo'),
      mixed: t('renameNef.undoToolMixed'),
    }[tool] || t('renameNef.undoToolUnknown')
  );
}

export default RenameNefModule;
