/**
 * DatabaseManagement - React component for database operations
 *
 * Features:
 * - Database state display
 * - Rename/Merge/Delete persons
 * - Move to/from ignored
 * - Undo file processing
 * - Purge encodings
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useModuleEvent } from '../hooks/useModuleEvent.js';
import { useOperationStatus } from '../hooks/useOperationStatus.js';
import { useFormState } from '../hooks/useFormState.js';
import { useToast } from '../context/ToastContext.jsx';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { Autocomplete, Button, IconButton, Alert, Modal } from './shared';
import { debugError } from '../shared/debug.js';
import { t } from '../../i18n/index.js';
import './DatabaseManagement.css';

function fuzzyMatch(text, query) {
  if (!query) return { match: true, score: 0 };
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return { match: true, score: 3 };
  if (t.startsWith(q)) return { match: true, score: 2 };
  if (t.includes(q)) return { match: true, score: 1 };
  return { match: false, score: 0 };
}

function formatBackendBreakdown(byBackend) {
  if (!byBackend || Object.keys(byBackend).length === 0) return null;
  if (Object.keys(byBackend).length === 1) {
    const [backend, count] = Object.entries(byBackend)[0];
    return `${count} ${backend}`;
  }
  return Object.entries(byBackend)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([backend, count]) => `${count} ${backend}`)
    .join(', ');
}

/**
 * DatabaseManagement Component
 */
export function DatabaseManagement() {
  const { api } = useBackend();
  const showToast = useToast();
  const confirm = useConfirm();

  // Database state
  const [databaseState, setDatabaseState] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  // Recent-files list shown in a modal (null = closed).
  const [recentFiles, setRecentFiles] = useState(null);

  // Duplicate-people detection
  const [duplicateThreshold, setDuplicateThreshold] = useState(0.35);
  const [duplicatePairs, setDuplicatePairs] = useState(null); // null = not run yet
  const [findingDuplicates, setFindingDuplicates] = useState(false);
  const [mergingPair, setMergingPair] = useState(false);
  // Confirmed-distinct pairs (e.g. twins) excluded from duplicate suggestions
  const [distinctPairs, setDistinctPairs] = useState([]);
  const [showExcluded, setShowExcluded] = useState(false);

  // Within-person redundant-encoding dedup
  const [redundantThreshold, setRedundantThreshold] = useState(0.0);
  const [scannedThreshold, setScannedThreshold] = useState(0.0); // threshold the list was computed at
  const [redundantPeople, setRedundantPeople] = useState(null); // null = not run
  const [scanningRedundant, setScanningRedundant] = useState(false);
  const [deduping, setDeduping] = useState(false);

  // Operation status: persistent errors only (transient receipts go to toasts).
  const { isLoading, setIsLoading, status, showError, clearStatus } =
    useOperationStatus();

  // Form states - using useFormState hook for cleaner reset handling
  const renameForm = useFormState({ oldName: '', newName: '' });
  const mergeForm = useFormState({
    source1: '',
    source2: '',
    target: '',
    backend: '',
  });
  const deleteForm = useFormState({ name: '' });
  const moveToIgnoreForm = useFormState({ name: '', backend: '' });
  const moveFromIgnoreForm = useFormState({
    count: '',
    target: '',
    backend: '',
  });
  const undoForm = useFormState({ pattern: '' });
  const purgeForm = useFormState({ name: '', count: '', backend: '' });

  // Wrap a handler so it can drive a native <form onSubmit> (Enter-to-submit)
  // without a page reload.
  const submit = (fn) => (e) => {
    e.preventDefault();
    fn();
  };

  const filteredPeople = useMemo(() => {
    if (!databaseState?.people) return [];
    if (!searchTerm.trim()) return databaseState.people;

    return databaseState.people
      .map((person) => ({ ...person, ...fuzzyMatch(person.name, searchTerm) }))
      .filter((p) => p.match)
      .sort((a, b) => b.score - a.score);
  }, [databaseState?.people, searchTerm]);

  /**
   * Load database state
   */
  const loadDatabaseState = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.get('/api/v1/management/database-state');
      setDatabaseState(response);
    } catch (err) {
      debugError('DatabaseMgmt', 'Failed to load:', err);
      showError(t('database.toasts.loadFailed', { error: err.message }));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  // Initial load
  useEffect(() => {
    loadDatabaseState();
  }, [loadDatabaseState]);

  // Listen for database updates
  useModuleEvent('database-updated', loadDatabaseState);

  /**
   * Operation handlers
   */
  const handleRename = async () => {
    const { oldName, newName } = renameForm.values;
    if (!oldName.trim() || !newName.trim()) {
      showError(t('database.toasts.enterBothNames'));
      return;
    }

    if (
      !(await confirm({
        message: t('database.dialogs.renameConfirm', {
          old: oldName.trim(),
          new: newName.trim(),
        }),
      }))
    )
      return;

    try {
      const result = await api.post('/api/v1/management/rename-person', {
        old_name: oldName.trim(),
        new_name: newName.trim(),
      });
      showToast(result.message, { type: 'success' });
      setDatabaseState(result.new_state);
      loadDistinctPairs(); // a rename rewrites the exclusion registry
      renameForm.reset();
    } catch (err) {
      showError(t('database.toasts.renameFailed', { error: err.message }));
    }
  };

  const handleMerge = async () => {
    const { source1, source2, target, backend } = mergeForm.values;
    if (!source1.trim() || !source2.trim()) {
      showError(t('database.toasts.enterTwoPeople'));
      return;
    }

    const targetName = target.trim() || source1.trim();
    const backendDesc = backend
      ? t('database.misc.backendOnly', { backend })
      : '';

    if (
      !(await confirm({
        message: t('database.dialogs.mergeConfirm', {
          source1: source1.trim(),
          source2: source2.trim(),
          target: targetName,
          backendDesc,
        }),
      }))
    )
      return;

    try {
      const result = await api.post('/api/v1/management/merge-people', {
        source_names: [source1.trim(), source2.trim()],
        target_name: targetName,
        backend_filter: backend || null,
      });
      let msg = result.message;
      if (result.warning) {
        msg += `\n⚠️ ${result.warning}`;
      }
      showToast(msg, { type: result.warning ? 'warning' : 'success' });
      setDatabaseState(result.new_state);
      loadDistinctPairs(); // a merge transfers/drops exclusion registry entries
      mergeForm.reset();
    } catch (err) {
      showError(t('database.toasts.mergeFailed', { error: err.message }));
    }
  };

  /**
   * Find pairs of distinctly-named people whose faces look like the same person.
   */
  const handleFindDuplicates = useCallback(async () => {
    setFindingDuplicates(true);
    try {
      // Guard against a cleared input (parseFloat('') → NaN), which would
      // otherwise serialize as threshold=NaN and break the JSON round-trip.
      const threshold = Number.isFinite(duplicateThreshold)
        ? duplicateThreshold
        : 0.35;
      const result = await api.get('/api/v1/management/find-duplicates', {
        threshold,
      });
      setDuplicatePairs(result.pairs);
      showToast(
        t('database.toasts.foundDuplicates', {
          count: result.pairs.length,
          people: result.people_compared,
          threshold: result.threshold,
        }),
        { type: 'success' },
      );
    } catch (err) {
      showError(
        t('database.toasts.duplicateScanFailed', { error: err.message }),
      );
    } finally {
      setFindingDuplicates(false);
    }
  }, [api, duplicateThreshold]);

  /**
   * Merge one duplicate pair: keep `keepName`, merge the other into it.
   */
  const handleMergePair = async (pair, keepName) => {
    if (mergingPair) return;
    const dropName = keepName === pair.name_a ? pair.name_b : pair.name_a;
    if (
      !(await confirm({
        message: t('database.dialogs.mergePairConfirm', {
          drop: dropName,
          keep: keepName,
        }),
      }))
    )
      return;
    setMergingPair(true);
    try {
      const result = await api.post('/api/v1/management/merge-people', {
        source_names: [dropName],
        target_name: keepName,
        backend_filter: null,
      });
      let msg = result.message;
      if (result.warning) msg += `\n⚠️ ${result.warning}`;
      showToast(msg, { type: result.warning ? 'warning' : 'success' });
      setDatabaseState(result.new_state);
      // Re-scan: the dropped name is gone, which invalidates other pairs too.
      // Buttons stay disabled until this lands so a stale pair can't be merged
      // against a name this merge just removed (which would resurrect it).
      loadDistinctPairs(); // the merge may have transferred/dropped exclusions
      await handleFindDuplicates();
    } catch (err) {
      showError(t('database.toasts.mergeFailed', { error: err.message }));
    } finally {
      setMergingPair(false);
    }
  };

  /**
   * Load the confirmed-distinct (excluded) pairs.
   */
  const loadDistinctPairs = useCallback(async () => {
    try {
      const result = await api.get('/api/v1/management/distinct-pairs');
      setDistinctPairs(result.pairs);
    } catch (err) {
      debugError('DatabaseMgmt', 'Failed to load distinct pairs:', err);
    }
  }, [api]);

  /**
   * Mark a pair as "not a duplicate" (confirmed-distinct, e.g. twins): record it
   * and drop it from the current list. Future scans skip it.
   */
  const handleNotADuplicate = async (pair) => {
    if (mergingPair) return;
    setMergingPair(true);
    try {
      await api.post('/api/v1/management/distinct-pair', {
        name_a: pair.name_a,
        name_b: pair.name_b,
      });
      setDuplicatePairs((prev) =>
        (prev || []).filter(
          (p) => !(p.name_a === pair.name_a && p.name_b === pair.name_b),
        ),
      );
      setDistinctPairs((prev) => [
        ...prev,
        { name_a: pair.name_a, name_b: pair.name_b },
      ]);
      showToast(
        t('database.toasts.markedNotDuplicate', {
          a: pair.name_a,
          b: pair.name_b,
        }),
        { type: 'success' },
      );
    } catch (err) {
      showError(t('database.toasts.excludePairFailed', { error: err.message }));
    } finally {
      setMergingPair(false);
    }
  };

  /**
   * Un-exclude a confirmed-distinct pair (it can be suggested again).
   */
  const handleRemoveDistinct = async (pair) => {
    try {
      await api.post('/api/v1/management/distinct-pair/remove', {
        name_a: pair.name_a,
        name_b: pair.name_b,
      });
      setDistinctPairs((prev) =>
        prev.filter(
          (p) => !(p.name_a === pair.name_a && p.name_b === pair.name_b),
        ),
      );
    } catch (err) {
      showError(
        t('database.toasts.removeExclusionFailed', { error: err.message }),
      );
    }
  };

  // Load excluded (confirmed-distinct) pairs on mount, for the count + list.
  useEffect(() => {
    loadDistinctPairs();
  }, [loadDistinctPairs]);

  /**
   * Scan for people with redundant (exact / near-identical) encodings.
   */
  const handleScanRedundant = useCallback(async () => {
    setScanningRedundant(true);
    try {
      const threshold = Number.isFinite(redundantThreshold)
        ? redundantThreshold
        : 0.0;
      const result = await api.get('/api/v1/management/redundant-encodings', {
        threshold,
      });
      setRedundantPeople(result.people);
      setScannedThreshold(result.threshold); // dedup must use the threshold shown, not the live slider
      showToast(
        t('database.toasts.foundRedundant', {
          count: result.total_redundant,
          people: result.people.length,
          peopleWord: t('database.misc.person', {
            count: result.people.length,
          }),
          threshold: result.threshold,
        }),
        { type: 'success' },
      );
    } catch (err) {
      showError(
        t('database.toasts.redundancyScanFailed', { error: err.message }),
      );
    } finally {
      setScanningRedundant(false);
    }
  }, [api, redundantThreshold]);

  /**
   * Remove redundant encodings from the given people (or all scanned).
   */
  const handleDedup = async (names) => {
    if (deduping || names.length === 0) return;
    // Count from the previewed list so the confirmation matches what's shown.
    const nameSet = new Set(names);
    const totalRedundant = (redundantPeople || [])
      .filter((p) => nameSet.has(p.name))
      .reduce((sum, p) => sum + p.redundant, 0);
    const who =
      names.length === 1
        ? `'${names[0]}'`
        : t('database.misc.peopleCount', { count: names.length });
    if (
      !(await confirm({
        message: t('database.dialogs.dedupConfirm', {
          count: totalRedundant,
          who,
        }),
        variant: 'danger',
      }))
    )
      return;
    setDeduping(true);
    try {
      // Use the threshold the previewed list was computed at (not the live slider),
      // so the dedup removes exactly what was shown.
      const result = await api.post('/api/v1/management/dedup-people', {
        names,
        threshold: scannedThreshold,
      });
      showToast(result.message, { type: 'success' });
      setDatabaseState(result.new_state);
      await handleScanRedundant(); // re-scan to refresh remaining redundancy
    } catch (err) {
      showError(t('database.toasts.dedupFailed', { error: err.message }));
    } finally {
      setDeduping(false);
    }
  };

  const handleDelete = async () => {
    const { name } = deleteForm.values;
    if (!name.trim()) {
      showError(t('database.toasts.enterPersonToDelete'));
      return;
    }

    if (
      !(await confirm({
        message: t('database.dialogs.deleteConfirm', { name: name.trim() }),
        variant: 'danger',
      }))
    )
      return;

    try {
      const result = await api.post('/api/v1/management/delete-person', {
        name: name.trim(),
      });
      showToast(result.message, { type: 'success' });
      setDatabaseState(result.new_state);
      loadDistinctPairs(); // a delete drops the person's exclusion registry entries
      deleteForm.reset();
    } catch (err) {
      showError(t('database.toasts.deleteFailed', { error: err.message }));
    }
  };

  const handleMoveToIgnore = async () => {
    const { name, backend } = moveToIgnoreForm.values;
    if (!name.trim()) {
      showError(t('database.toasts.enterPersonName'));
      return;
    }

    const backendDesc = backend
      ? t('database.misc.backendOnly', { backend })
      : '';
    if (
      !(await confirm({
        message: t('database.dialogs.moveToIgnoreConfirm', {
          name: name.trim(),
          backendDesc,
        }),
      }))
    )
      return;

    try {
      const result = await api.post('/api/v1/management/move-to-ignore', {
        name: name.trim(),
        backend_filter: backend || null,
      });
      showToast(result.message, { type: 'success' });
      setDatabaseState(result.new_state);
      loadDistinctPairs(); // moving a person to ignored can drop registry entries
      moveToIgnoreForm.reset();
    } catch (err) {
      showError(
        t('database.toasts.moveToIgnoreFailed', { error: err.message }),
      );
    }
  };

  const handleMoveFromIgnore = async () => {
    const { count, target, backend } = moveFromIgnoreForm.values;
    const countNum = parseInt(count, 10);

    if (isNaN(countNum) || !target.trim()) {
      showError(t('database.toasts.enterCountAndTarget'));
      return;
    }

    const backendDesc = backend
      ? t('database.misc.backendOnly', { backend })
      : '';
    if (
      !(await confirm({
        message: t('database.dialogs.moveFromIgnoreConfirm', {
          count: countNum === -1 ? t('database.misc.all') : countNum,
          target: target.trim(),
          backendDesc,
        }),
      }))
    )
      return;

    try {
      const result = await api.post('/api/v1/management/move-from-ignore', {
        count: countNum,
        target_name: target.trim(),
        backend_filter: backend || null,
      });
      showToast(result.message, { type: 'success' });
      setDatabaseState(result.new_state);
      moveFromIgnoreForm.reset();
    } catch (err) {
      showError(
        t('database.toasts.moveFromIgnoreFailed', { error: err.message }),
      );
    }
  };

  const handleUndo = async () => {
    const { pattern } = undoForm.values;
    if (!pattern.trim()) {
      showError(t('database.toasts.enterFilenamePattern'));
      return;
    }

    if (
      !(await confirm({
        message: t('database.dialogs.undoConfirm', { pattern: pattern.trim() }),
      }))
    )
      return;

    try {
      const result = await api.post('/api/v1/management/undo-file', {
        filename_pattern: pattern.trim(),
      });
      let message = result.message;
      if (result.files_undone?.length) {
        message +=
          '\n' +
          t('database.toasts.filesUndone') +
          result.files_undone.join(', ');
      }
      showToast(message, { type: 'success' });
      setDatabaseState(result.new_state);
      loadDistinctPairs(); // undo can empty (remove) a person, dropping registry entries
      undoForm.reset();
    } catch (err) {
      showError(t('database.toasts.undoFailed', { error: err.message }));
    }
  };

  const handleShowRecentFiles = async () => {
    try {
      const files = await api.get('/api/v1/management/recent-files', { n: 10 });
      setRecentFiles(files);
    } catch (err) {
      showError(t('database.toasts.recentFilesFailed', { error: err.message }));
    }
  };

  const handlePurge = async () => {
    const { name, count, backend } = purgeForm.values;
    const countNum = parseInt(count, 10);

    if (!name.trim() || isNaN(countNum) || countNum < 1) {
      showError(t('database.toasts.enterPersonAndCount'));
      return;
    }

    const backendDesc = backend
      ? t('database.misc.backendOnly', { backend })
      : '';
    if (
      !(await confirm({
        message: t('database.dialogs.purgeConfirm', {
          count: countNum,
          name: name.trim(),
          backendDesc,
        }),
        variant: 'danger',
      }))
    )
      return;

    try {
      const result = await api.post('/api/v1/management/purge-encodings', {
        name: name.trim(),
        count: countNum,
        backend_filter: backend || null,
      });
      showToast(result.message, { type: 'success' });
      setDatabaseState(result.new_state);
      purgeForm.reset();
    } catch (err) {
      showError(t('database.toasts.purgeFailed', { error: err.message }));
    }
  };

  // People names for autocomplete
  const peopleNames = databaseState?.people?.map((p) => p.name) || [];

  return (
    <div
      className="module-container db-management"
      data-keyboard-scope="isolated"
    >
      <div className="module-header">
        <h3 className="module-title">{t('database.title')}</h3>
        <Button variant="secondary" size="sm" onClick={loadDatabaseState}>
          {t('database.buttons.reload')}
        </Button>
      </div>

      <div className="module-body">
        {/* Database State */}
        <div className="section-card">
          <h4 className="section-title">
            {t('database.sections.currentDatabase')}
          </h4>
          {isLoading ? (
            <div className="db-stats">{t('database.stats.loading')}</div>
          ) : databaseState ? (
            <>
              <div className="db-stats">
                <strong>{databaseState.people?.length || 0}</strong>{' '}
                {t('database.stats.people')}{' '}
                <strong>{databaseState.ignored_count || 0}</strong>{' '}
                {t('database.stats.ignored')}
                {databaseState.ignored_by_backend &&
                  Object.keys(databaseState.ignored_by_backend).length > 1 && (
                    <span className="backend-detail">
                      {' '}
                      (
                      {formatBackendBreakdown(databaseState.ignored_by_backend)}
                      )
                    </span>
                  )}
                , <strong>{databaseState.processed_files_count || 0}</strong>{' '}
                {t('database.stats.filesProcessed')}
                {databaseState.backends_in_use?.length > 0 && (
                  <div className="backends-in-use">
                    {t('database.stats.backends')}
                    {databaseState.backends_in_use.join(', ')}
                  </div>
                )}
              </div>
              <input
                type="text"
                className="people-search"
                placeholder={t('database.placeholders.filterNames')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className="people-list">
                {filteredPeople.map((person) => {
                  const breakdown = formatBackendBreakdown(
                    person.encodings_by_backend,
                  );
                  return (
                    <div key={person.name} className="person-item">
                      <span className="person-name">{person.name}</span>
                      <span className="person-count">
                        {breakdown || person.encoding_count}
                      </span>
                    </div>
                  );
                })}
                {searchTerm && filteredPeople.length === 0 && (
                  <div className="person-item no-match">
                    {t('database.emptyStates.noMatches')}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="db-stats">
              {t('database.stats.loadFailedInline')}
            </div>
          )}
        </div>

        {/* Operations */}
        <div className="operations-panel">
          <h4 className="section-title">{t('database.sections.operations')}</h4>

          {/* 1. Rename */}
          <OperationForm
            title={t('database.ops.rename.title')}
            onSubmit={submit(handleRename)}
          >
            <div className="form-row">
              <NameAutocomplete
                value={renameForm.values.oldName}
                onChange={(v) => renameForm.setValue('oldName', v)}
                placeholder={t('database.placeholders.currentName')}
                names={peopleNames}
              />
              <span>→</span>
              <input
                placeholder={t('database.placeholders.newName')}
                value={renameForm.values.newName}
                onChange={(e) => renameForm.setValue('newName', e.target.value)}
              />
              <Button type="submit" variant="primary">
                {t('database.buttons.rename')}
              </Button>
            </div>
          </OperationForm>

          {/* 2. Merge */}
          <OperationForm
            title={t('database.ops.merge.title')}
            onSubmit={submit(handleMerge)}
          >
            <div className="form-column">
              <NameAutocomplete
                value={mergeForm.values.source1}
                onChange={(v) => mergeForm.setValue('source1', v)}
                placeholder={t('database.placeholders.firstPerson')}
                names={peopleNames}
              />
              <NameAutocomplete
                value={mergeForm.values.source2}
                onChange={(v) => mergeForm.setValue('source2', v)}
                placeholder={t('database.placeholders.secondPerson')}
                names={peopleNames}
              />
              <input
                placeholder={t('database.placeholders.resultName')}
                value={mergeForm.values.target}
                onChange={(e) => mergeForm.setValue('target', e.target.value)}
              />
              <div className="form-row">
                <BackendSelect
                  value={mergeForm.values.backend}
                  onChange={(v) => mergeForm.setValue('backend', v)}
                  backends={databaseState?.backends_in_use}
                />
                <Button type="submit" variant="primary">
                  {t('database.buttons.merge')}
                </Button>
              </div>
            </div>
          </OperationForm>

          {/* Find duplicates: distinctly-named people who are likely the same person */}
          <OperationForm
            title={t('database.ops.findDuplicates.title')}
            onSubmit={submit(handleFindDuplicates)}
          >
            <div className="form-row">
              <label htmlFor="dup-threshold">
                {t('database.labels.threshold')}
              </label>
              <input
                id="dup-threshold"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={duplicateThreshold}
                onChange={(e) =>
                  setDuplicateThreshold(parseFloat(e.target.value))
                }
                className="db-duplicate-threshold"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={findingDuplicates}
              >
                {findingDuplicates
                  ? t('database.buttons.scanning')
                  : t('database.buttons.find')}
              </Button>
            </div>
            {duplicatePairs !== null &&
              (duplicatePairs.length === 0 ? (
                <div className="db-duplicate-empty">
                  {t('database.emptyStates.noDuplicates')}
                </div>
              ) : (
                <ul className="db-duplicate-list">
                  {duplicatePairs.map((p) => (
                    <li
                      key={`${p.name_a}|${p.name_b}`}
                      className={`db-duplicate-row${p.likely_distinct ? ' likely-distinct' : ''}`}
                    >
                      <span
                        className="db-duplicate-names"
                        title={t('database.tooltips.centroidDistance', {
                          distance: p.distance,
                        })}
                      >
                        {p.name_a} ({p.count_a}) ⟷ {p.name_b} ({p.count_b}) ·{' '}
                        {p.distance.toFixed(2)}
                        {p.separability != null && (
                          <span className="db-duplicate-sep">
                            {' · '}
                            {t('database.ops.findDuplicates.separable', {
                              percent: Math.round(p.separability * 100),
                            })}
                            {p.likely_distinct
                              ? ' ' +
                                t('database.ops.findDuplicates.likelyDistinct')
                              : ''}
                          </span>
                        )}
                      </span>
                      <span className="db-duplicate-actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleMergePair(p, p.name_a)}
                          disabled={mergingPair || findingDuplicates}
                        >
                          {t('database.buttons.keep', { name: p.name_a })}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleMergePair(p, p.name_b)}
                          disabled={mergingPair || findingDuplicates}
                        >
                          {t('database.buttons.keep', { name: p.name_b })}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleNotADuplicate(p)}
                          disabled={mergingPair || findingDuplicates}
                          title={t('database.tooltips.notADuplicate')}
                        >
                          {t('database.buttons.notADuplicate')}
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
            {distinctPairs.length > 0 && (
              <div className="db-excluded">
                <button
                  type="button"
                  className="db-excluded-toggle"
                  aria-expanded={showExcluded}
                  onClick={() => setShowExcluded((v) => !v)}
                >
                  {showExcluded ? '▾' : '▸'}{' '}
                  {t('database.ops.findDuplicates.excludedPairs', {
                    count: distinctPairs.length,
                  })}
                </button>
                {showExcluded && (
                  <ul className="db-excluded-list">
                    {distinctPairs.map((p) => (
                      <li
                        key={`${p.name_a}|${p.name_b}`}
                        className="db-excluded-row"
                      >
                        <span className="db-duplicate-names">
                          {p.name_a} ⟷ {p.name_b}
                        </span>
                        <IconButton
                          icon="close"
                          label={t('database.tooltips.allowSuggestAgain')}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveDistinct(p)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </OperationForm>

          {/* Remove redundant encodings within a person */}
          <OperationForm
            title={t('database.ops.redundant.title')}
            onSubmit={submit(handleScanRedundant)}
          >
            <div className="form-row">
              <label htmlFor="redundant-threshold">
                {t('database.labels.threshold')}
              </label>
              <input
                id="redundant-threshold"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={redundantThreshold}
                onChange={(e) =>
                  setRedundantThreshold(parseFloat(e.target.value))
                }
                className="db-duplicate-threshold"
                title={t('database.tooltips.redundantThreshold')}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={scanningRedundant}
              >
                {scanningRedundant
                  ? t('database.buttons.scanning')
                  : t('database.buttons.scan')}
              </Button>
              {redundantPeople && redundantPeople.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    handleDedup(redundantPeople.map((p) => p.name))
                  }
                  disabled={deduping || scanningRedundant}
                >
                  {t('database.buttons.cleanAll')}
                </Button>
              )}
            </div>
            {redundantPeople !== null &&
              (redundantPeople.length === 0 ? (
                <div className="db-duplicate-empty">
                  {t('database.emptyStates.noRedundant')}
                </div>
              ) : (
                <ul className="db-duplicate-list">
                  {redundantPeople.map((p) => (
                    <li key={p.name} className="db-duplicate-row">
                      <span className="db-duplicate-names">
                        {p.name}: {p.total} → {p.kept}
                        <span className="db-duplicate-sep">
                          {' '}
                          (
                          {t('database.ops.redundant.redundantCount', {
                            count: p.redundant,
                          })}
                          )
                        </span>
                      </span>
                      <span className="db-duplicate-actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDedup([p.name])}
                          disabled={deduping || scanningRedundant}
                        >
                          {t('database.buttons.clean')}
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </OperationForm>

          {/* 3. Delete */}
          <OperationForm
            title={t('database.ops.delete.title')}
            onSubmit={submit(handleDelete)}
          >
            <div className="form-row">
              <NameAutocomplete
                value={deleteForm.values.name}
                onChange={(v) => deleteForm.setValue('name', v)}
                placeholder={t('database.placeholders.personToDelete')}
                names={peopleNames}
              />
              <Button type="submit" variant="danger">
                {t('database.buttons.delete')}
              </Button>
            </div>
          </OperationForm>

          {/* 4. Move to Ignore */}
          <OperationForm
            title={t('database.ops.moveToIgnore.title')}
            onSubmit={submit(handleMoveToIgnore)}
          >
            <div className="form-row">
              <NameAutocomplete
                value={moveToIgnoreForm.values.name}
                onChange={(v) => moveToIgnoreForm.setValue('name', v)}
                placeholder={t('database.placeholders.personName')}
                names={peopleNames}
              />
              <BackendSelect
                value={moveToIgnoreForm.values.backend}
                onChange={(v) => moveToIgnoreForm.setValue('backend', v)}
                backends={databaseState?.backends_in_use}
              />
              <Button type="submit" variant="primary">
                {t('database.buttons.moveToIgnore')}
              </Button>
            </div>
          </OperationForm>

          {/* 5. Move from Ignore */}
          <OperationForm
            title={t('database.ops.moveFromIgnore.title')}
            onSubmit={submit(handleMoveFromIgnore)}
          >
            <div className="form-column">
              <div className="form-row">
                <input
                  type="number"
                  placeholder={t('database.placeholders.countAll')}
                  min="-1"
                  value={moveFromIgnoreForm.values.count}
                  onChange={(e) =>
                    moveFromIgnoreForm.setValue('count', e.target.value)
                  }
                />
                <span>→</span>
                <input
                  placeholder={t('database.placeholders.newPersonName')}
                  value={moveFromIgnoreForm.values.target}
                  onChange={(e) =>
                    moveFromIgnoreForm.setValue('target', e.target.value)
                  }
                />
              </div>
              <div className="form-row">
                <BackendSelect
                  value={moveFromIgnoreForm.values.backend}
                  onChange={(v) => moveFromIgnoreForm.setValue('backend', v)}
                  backends={databaseState?.backends_in_use}
                />
                <Button type="submit" variant="primary">
                  {t('database.buttons.move')}
                </Button>
              </div>
            </div>
          </OperationForm>

          {/* 8/10. Undo File */}
          <OperationForm
            title={t('database.ops.undo.title')}
            onSubmit={submit(handleUndo)}
          >
            <div className="form-column">
              <input
                placeholder={t('database.placeholders.filenameGlob')}
                value={undoForm.values.pattern}
                onChange={(e) => undoForm.setValue('pattern', e.target.value)}
              />
              <div className="button-row">
                <Button type="submit" variant="primary">
                  {t('database.buttons.undo')}
                </Button>
                <Button variant="secondary" onClick={handleShowRecentFiles}>
                  {t('database.buttons.showRecentFiles')}
                </Button>
              </div>
            </div>
          </OperationForm>

          {/* 9. Purge */}
          <OperationForm
            title={t('database.ops.purge.title')}
            onSubmit={submit(handlePurge)}
          >
            <div className="form-column">
              <div className="form-row">
                <NameAutocomplete
                  value={purgeForm.values.name}
                  onChange={(v) => purgeForm.setValue('name', v)}
                  placeholder={t('database.placeholders.personOrIgnore')}
                  names={peopleNames}
                  extraOptions={['ignore']}
                />
                <input
                  type="number"
                  placeholder={t('database.placeholders.count')}
                  min="1"
                  value={purgeForm.values.count}
                  onChange={(e) => purgeForm.setValue('count', e.target.value)}
                />
              </div>
              <div className="form-row">
                <BackendSelect
                  value={purgeForm.values.backend}
                  onChange={(v) => purgeForm.setValue('backend', v)}
                  backends={databaseState?.backends_in_use}
                />
                <Button type="submit" variant="danger">
                  {t('database.buttons.purge')}
                </Button>
              </div>
            </div>
          </OperationForm>
        </div>

        {/* Persistent error status */}
        {status.message && (
          <Alert
            variant={status.type === 'error' ? 'error' : status.type || 'info'}
            onDismiss={clearStatus}
            className="db-status"
          >
            {status.message}
          </Alert>
        )}
      </div>

      {/* Recent-files list (replaces native alert) */}
      <Modal
        open={recentFiles !== null}
        onClose={() => setRecentFiles(null)}
        title={t('database.dialogs.recentFilesTitle')}
        size="sm"
        footer={
          <Button variant="secondary" onClick={() => setRecentFiles(null)}>
            {t('common.dismiss')}
          </Button>
        }
      >
        {recentFiles && recentFiles.length > 0 ? (
          <ol className="db-recent-files">
            {recentFiles.map((f, i) => (
              <li key={i}>{f.name}</li>
            ))}
          </ol>
        ) : (
          <p className="db-recent-empty">
            {t('database.emptyStates.noRecentFiles')}
          </p>
        )}
      </Modal>
    </div>
  );
}

/**
 * OperationForm — a titled operation card. When `onSubmit` is provided the card
 * is a native `<form>` so Enter in any field submits (Enter-to-submit).
 */
function OperationForm({ title, onSubmit, children }) {
  const inner = (
    <>
      <h5 className="subsection-title">{title}</h5>
      {children}
    </>
  );
  if (onSubmit) {
    return (
      <form className="section-card operation-form" onSubmit={onSubmit}>
        {inner}
      </form>
    );
  }
  return <div className="section-card operation-form">{inner}</div>;
}

/**
 * NameAutocomplete — a person-name combobox over the known-names list.
 * Presentation-only Autocomplete wrapper: ranks `names` (+ optional extras) by
 * the current input value and commits the picked name back to the caller.
 */
function NameAutocomplete({
  value,
  onChange,
  placeholder,
  names,
  extraOptions,
}) {
  const extrasKey = (extraOptions || []).join('\u0000');
  const options = useMemo(() => {
    const all = [...names, ...(extraOptions || [])];
    if (!value.trim()) return all;
    return all
      .map((n) => ({ name: n, ...fuzzyMatch(n, value) }))
      .filter((o) => o.match)
      .sort((a, b) => b.score - a.score)
      .map((o) => o.name);
    // extrasKey stands in for extraOptions identity (array literal per render).
  }, [names, value, extrasKey, extraOptions]);

  return (
    <Autocomplete
      value={value}
      options={options}
      onInputChange={onChange}
      onSelect={(name) => onChange(name)}
      placeholder={placeholder}
      ariaLabel={placeholder}
      selectOnEnter
      maxSuggestions={8}
    />
  );
}

function BackendSelect({ value, onChange, backends }) {
  if (!backends || backends.length < 2) return null;
  return (
    <select
      className="backend-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('database.misc.allBackends')}</option>
      {backends.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </select>
  );
}

export default DatabaseManagement;
