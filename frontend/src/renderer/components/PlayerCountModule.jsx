/**
 * PlayerCountModule - GUI for the rakna_spelare CLI.
 *
 * Counts how many images each named player appears in across a folder/glob/date
 * selection, with over/under-representation statistics. The input bar collects a
 * folder/wildcard + extension preset + date span; the backend resolves the files
 * and counts. Stats auto-refresh live when the watched folder(s) change.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useModuleAPI } from '../hooks/useModuleEvent.js';
import { InputBar, EMPTY_INPUT } from './InputBar.jsx';
import { Button, Alert, ContextMenu } from './shared';
import { useContextMenu } from '../hooks/useContextMenu.js';
import { getScanScope, setScanScope, scanScopeHasSelection, signalExternalLoad } from '../shared/scanScope.js';
import { getWorkingFolder } from '../shared/workingFolder.js';
import {
  DEFAULTS as COUNT_DEFAULTS,
  getCountSettings,
  setCountSettings,
  subscribeCountSettings,
} from '../shared/countSettings.js';
import {
  getPlayerSession,
  playerSessionParams,
  movePlayerSession,
  removePlayerSession,
  clearPlayerSession,
  subscribePlayerSession,
  buildPlayerMenuItems,
  persistPublikPermanent,
} from '../shared/playerSession.js';
import { t } from '../../i18n/index.js';
import './PlayerCountModule.css';

const REFRESH_DEBOUNCE_MS = 400;

// Default counting options, mirroring the CLI's argparse defaults. The canonical
// definition now lives in the shared countSettings store; re-exported here for
// backward compatibility (buildCountParams fallback + unit tests).
export const DEFAULT_OPTIONS = COUNT_DEFAULTS;

// Build the /players/count request body. Pure + exported for unit tests.
// `exclOverride` is { tranare, publik } to override the config/env exclusion
// lists, or null/undefined to keep the backend defaults (config/env).
// `session` is a playerSessionParams() object (session-only right-click pins),
// or null/undefined for none.
export function buildCountParams(inp, options, includePerMatch, exclOverride, session) {
  const opts = options || DEFAULT_OPTIONS;
  return {
    roots: inp.roots,
    globs: inp.glob.trim() ? [inp.glob.trim()] : [],
    extension_preset: inp.preset,
    recursive: inp.recursive,
    date_from: inp.dateFrom || null,
    date_to: inp.dateTo || null,
    gap_minutes: opts.gapMinutes,
    baseline: opts.baseline,
    min_images: opts.minImages,
    per_match: includePerMatch,
    tranare: exclOverride ? exclOverride.tranare : null,
    publik: exclOverride ? exclOverride.publik : null,
    spelare: session?.spelare ?? null,
    session_tranare: session?.session_tranare ?? null,
    session_publik: session?.session_publik ?? null,
    session_grupp: session?.session_grupp ?? null,
  };
}

export function PlayerCountModule() {
  const { api } = useBackend();
  const { emit, waitForListeners } = useModuleAPI();

  const [input, setInput] = useState(EMPTY_INPUT);
  const [perMatch, setPerMatch] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  // Counting options (CLI parity: gap_minutes / baseline / min_images). Seeded
  // from the shared countSettings store so the choice persists across remounts
  // and stays in sync with the culling stats panel.
  const [options, setOptions] = useState(getCountSettings);
  // Per-request coach/audience exclusion overrides (apply live to the current
  // count); sent as an override only once the user edits them.
  const [exclusions, setExclusions] = useState({ tranare: [], publik: [] });
  // Config-level "always excluded" lists (take effect after Spara som standard):
  // Gruppbilder (group markers) and the always-publik markers.
  const [grupp, setGrupp] = useState([]);
  const [alwaysPublik, setAlwaysPublik] = useState([]);
  const [envKeys, setEnvKeys] = useState([]); // RAKNA_* env vars shadowing config
  const [exclusionsDirty, setExclusionsDirty] = useState(false); // tranare/publik (per-request)
  // Session-only right-click moves, shared with the culling stats column
  // (sessionStorage-backed store). Kept out of `exclusions` entirely so
  // "Spara som standard" can never persist a session move.
  const [session, setSession] = useState(getPlayerSession());
  useEffect(() => subscribePlayerSession(setSession), []);
  const [configDirty, setConfigDirty] = useState(false); // grupp/always (needs save)
  const [savingDefaults, setSavingDefaults] = useState(false);

  // Params of the last submitted query, so auto-refresh re-runs the same thing.
  const lastParamsRef = useRef(null);
  // Monotonic id so a slower older request can't overwrite a newer result
  // (e.g. toggling Per match / filters quickly on a large folder).
  const reqSeqRef = useRef(0);
  const watchedDirsRef = useRef(new Set());
  const debounceRef = useRef(null);

  const buildParams = useCallback(
    (inp, includePerMatch, opts, exclOverride) =>
      // Session pins are read fresh at call time, so every recount path
      // (submit, option change, auto-refresh resubmit) carries them.
      buildCountParams(inp, opts, includePerMatch, exclOverride, playerSessionParams()),
    []
  );

  const runCount = useCallback(
    async (params, { silent = false } = {}) => {
      const seq = ++reqSeqRef.current;
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const data = await api.post('/api/v1/players/count', params);
        if (seq !== reqSeqRef.current) return; // superseded by a newer request
        setResult(data);
        setError(null);
      } catch (err) {
        if (seq !== reqSeqRef.current) return;
        setError(err.message || String(err));
      } finally {
        if (seq === reqSeqRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
          setHasRun(true);
        }
      }
    },
    [api]
  );

  // Compute the directories to watch for a given input.
  const watchDirsFor = useCallback((inp) => {
    const dirs = new Set(inp.roots);
    const g = inp.glob.trim();
    if (g) {
      const base = globBaseDir(g);
      if (base) dirs.add(base);
    }
    return dirs;
  }, []);

  // Reconcile the active folder watches with the desired set.
  const updateWatches = useCallback((desired) => {
    const current = watchedDirsRef.current;
    for (const dir of current) {
      if (!desired.has(dir)) {
        window.ansiktenAPI.unwatchFolder?.(dir);
      }
    }
    for (const dir of desired) {
      if (!current.has(dir)) {
        window.ansiktenAPI.watchFolder?.(dir, true);
      }
    }
    watchedDirsRef.current = desired;
  }, []);

  const submitWith = useCallback(
    (inp, includePerMatch, opts = options, exclOverride) => {
      // Undefined = fall back to current state; explicit null = force defaults.
      const override =
        exclOverride !== undefined ? exclOverride : exclusionsDirty ? exclusions : null;
      const params = buildParams(inp, includePerMatch, opts, override);
      lastParamsRef.current = params;
      // Publish the scan scope so Gallra spelare mirrors the same selection.
      setScanScope({
        roots: params.roots,
        globs: params.globs,
        recursive: params.recursive,
        date_from: params.date_from,
        date_to: params.date_to,
        extension_preset: params.extension_preset,
      });
      runCount(params);
      updateWatches(watchDirsFor(inp));
    },
    [buildParams, runCount, updateWatches, watchDirsFor, options, exclusions, exclusionsDirty]
  );

  // Re-run the count when the shared session moves change (from this module's
  // context menu, its chips, or the culling stats column). Skips the initial
  // subscription value and counts that haven't run yet.
  const sessionRef = useRef(session);
  useEffect(() => {
    if (sessionRef.current === session) return;
    sessionRef.current = session;
    if (lastParamsRef.current) submitWith(input, perMatch);
  }, [session, submitWith, input, perMatch]);

  const handleSubmit = useCallback(
    () => submitWith(input, perMatch),
    [submitWith, input, perMatch]
  );

  // On open, adopt the shared scan scope (e.g. coming from Gallra spelare) when
  // the panel is still empty, so it shows the same files instead of starting
  // blank. Translates the scan scope into the InputBar shape (path-glob array →
  // single glob string; null dates → empty).
  useEffect(() => {
    if (lastParamsRef.current) return;
    const s = getScanScope();
    if (!scanScopeHasSelection(s)) {
      // No shared scan scope to adopt. Fall back to the pipeline working-folder
      // anchor (set by an earlier import/rename) as a PREFILL of the roots field
      // only — never auto-run a count (explicit user requirement). The user still
      // presses the query control; scanScope, if it later appears, always wins.
      const anchorRoots = getWorkingFolder()?.roots;
      if (Array.isArray(anchorRoots) && anchorRoots.length > 0) {
        setInput((prev) => ({ ...prev, roots: [...anchorRoots] }));
      }
      return;
    }
    const adopted = {
      roots: s.roots || [],
      glob: (s.globs && s.globs[0]) || '',
      preset: s.extension_preset || 'jpg',
      dateFrom: s.date_from || '',
      dateTo: s.date_to || '',
      recursive: s.recursive ?? true,
    };
    setInput(adopted);
    submitWith(adopted, perMatch);
     
  }, []);

  // Select/checkbox changes from the InputBar apply immediately, but only once a
  // query has run (otherwise there's nothing to recompute yet).
  const handleAutoApply = useCallback(
    (nextInput) => {
      setInput(nextInput);
      if (lastParamsRef.current) submitWith(nextInput, perMatch);
    },
    [submitWith, perMatch]
  );

  // Counting-option changes apply immediately (like the InputBar selects), but
  // only once a query has run. Thread the new options explicitly so we don't
  // race the async state update. Also publish to the shared store so the culling
  // stats panel (and a later remount of this tab) picks up the same choice.
  // Tracks the live options so the store subscription can tell a self-originated
  // update (applyOptions, below) from an external one and avoid a double count.
  // Updated synchronously by applyOptions because setCountSettings notifies
  // subscribers before React re-renders (a render-time sync would be stale).
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const applyOptions = useCallback(
    (next) => {
      optionsRef.current = next;
      setOptions(next);
      setCountSettings(next); // publish to the shared store (culling stats panel)
      if (lastParamsRef.current) submitWith(input, perMatch, next);
    },
    [submitWith, input, perMatch]
  );

  // Adopt external counting-settings changes (from the culling stats panel).
  // Update the local options and re-run the active query, mirroring the session
  // subscribe effect: skip self-originated updates and counts that haven't run.
  useEffect(
    () =>
      subscribeCountSettings((next) => {
        if (
          next.gapMinutes === optionsRef.current.gapMinutes &&
          next.baseline === optionsRef.current.baseline &&
          next.minImages === optionsRef.current.minImages
        ) {
          return; // already reflected locally (self-originated)
        }
        optionsRef.current = next;
        setOptions(next);
        if (lastParamsRef.current) submitWith(input, perMatch, next);
      }),
    [submitWith, input, perMatch]
  );

  // Apply a GET/POST exclusions response to the editor state: per-request
  // tranare/publik, plus the editable config-level group + always-publik lists.
  const applyLoaded = useCallback((data) => {
    const always = data.always || { publik: [], grupp: [] };
    const strip = (list, locked) => (list || []).filter((n) => !(locked || []).includes(n));
    // Per-request publik excludes the always-publik markers (those are edited in
    // the "Alltid uteslutna" section instead).
    setExclusions({ tranare: data.tranare || [], publik: strip(data.publik, always.publik) });
    setGrupp(data.grupp || []); // resolved group markers (editable)
    setAlwaysPublik(always.publik || []); // always-publik markers (editable)
    setEnvKeys(data.env_keys || []);
  }, []);

  const loadExclusions = useCallback(async () => {
    try {
      applyLoaded(await api.get('/api/v1/players/exclusions'));
    } catch {
      /* Non-fatal: leave the editor empty. */
    }
  }, [api, applyLoaded]);

  useEffect(() => {
    loadExclusions();
  }, [loadExclusions]);

  // Edit the exclusion lists (per-request override; marks dirty + re-runs).
  const applyExclusions = useCallback(
    (next) => {
      setExclusions(next);
      setExclusionsDirty(true);
      if (lastParamsRef.current) submitWith(input, perMatch, options, next);
    },
    [submitWith, input, perMatch, options]
  );

  // Config-level lists (grupp / always-publik): edit state + mark dirty; they
  // take effect on save (not per-request).
  const editConfigList = useCallback((kind, next) => {
    if (kind === 'grupp') setGrupp(next);
    else if (kind === 'alwaysPublik') setAlwaysPublik(next);
    setConfigDirty(true);
  }, []);

  const addExcluded = useCallback(
    (kind, name) => {
      const clean = name.trim();
      if (!clean) return;
      if (kind === 'spelare') {
        // Session-only force-include (shared store; recount via subscription).
        movePlayerSession(clean, 'spelare');
      } else if (kind === 'tranare' || kind === 'publik') {
        if (exclusions[kind].includes(clean)) return;
        applyExclusions({ ...exclusions, [kind]: [...exclusions[kind], clean] });
      } else {
        const list = kind === 'grupp' ? grupp : alwaysPublik;
        if (list.includes(clean)) return;
        editConfigList(kind, [...list, clean]);
      }
    },
    [exclusions, grupp, alwaysPublik, applyExclusions, editConfigList]
  );

  const removeExcluded = useCallback(
    (kind, name) => {
      if (kind === 'spelare') {
        removePlayerSession(name);
      } else if (kind === 'tranare' || kind === 'publik') {
        applyExclusions({ ...exclusions, [kind]: exclusions[kind].filter((n) => n !== name) });
      } else {
        const list = kind === 'grupp' ? grupp : alwaysPublik;
        editConfigList(kind, list.filter((n) => n !== name));
      }
    },
    [exclusions, grupp, alwaysPublik, applyExclusions, editConfigList]
  );

  // Persist the current lists as the new defaults (config.json → future counts + CLI).
  const saveDefaults = useCallback(async () => {
    setSavingDefaults(true);
    try {
      // Consolidate the edited group markers into always_grupp (and clear the
      // regular grupp list) so a single Gruppbilder editor is the source of truth.
      const data = await api.post('/api/v1/players/exclusions', {
        tranare: exclusions.tranare,
        publik: exclusions.publik,
        grupp: [],
        always_grupp: grupp,
        always_publik: alwaysPublik,
      });
      applyLoaded(data);
      setExclusionsDirty(false); // the saved lists are now the default
      setConfigDirty(false);
      // Re-run with the resolved defaults so lastParamsRef no longer holds the
      // per-request override (which would otherwise linger on auto-refresh).
      if (lastParamsRef.current) submitWith(input, perMatch, options, null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSavingDefaults(false);
    }
  }, [api, exclusions, grupp, alwaysPublik, applyLoaded, submitWith, input, perMatch, options]);

  // Discard edits and re-run with the saved defaults.
  const resetExclusions = useCallback(async () => {
    await loadExclusions();
    setExclusionsDirty(false);
    setConfigDirty(false);
    // Återställ also clears the session-only right-click moves.
    clearPlayerSession();
    if (lastParamsRef.current) submitWith(input, perMatch, options, null);
  }, [loadExclusions, submitWith, input, perMatch, options]);

  // Targeted permanent publik (shared helper: raw-config save + session pin);
  // refresh the editor lists unless that would clobber unsaved edits — in that
  // case merge just the new name into the local publik list instead, so a
  // later "Spara som standard" can't post a list that lacks it (which would
  // silently un-persist the permanent move).
  const makePublikPermanent = useCallback(
    async (name) => {
      const clean = name.trim();
      if (!clean) return;
      try {
        await persistPublikPermanent(api, clean);
        if (!exclusionsDirty && !configDirty) {
          await loadExclusions();
        } else {
          setExclusions((prev) =>
            prev.publik.includes(clean) ? prev : { ...prev, publik: [...prev.publik, clean] }
          );
        }
      } catch (err) {
        setError(err.message || String(err));
      }
    },
    [api, exclusionsDirty, configDirty, loadExclusions]
  );

  // Open the culling workspace filtered to a player (from the stats table).
  const openCullForPlayer = useCallback(
    async (name) => {
      const params = lastParamsRef.current || buildParams(input, perMatch, options, null);
      // Tell culling's adopt-on-mount that we'll immediately load the
      // player-filtered query, so it skips its own unfiltered scan.
      signalExternalLoad();
      window.workspace?.openModule?.('culling');
      // The culling module subscribes on mount; wait so the event isn't missed.
      await waitForListeners('cull-player', 3000);
      emit('cull-player', {
        name,
        roots: params.roots,
        globs: params.globs,
        recursive: params.recursive,
        date_from: params.date_from,
        date_to: params.date_to,
      });
    },
    [emit, waitForListeners, input, perMatch, buildParams, options]
  );

  // Subscribe to folder-change events for live auto-refresh.
  useEffect(() => {
    const unsubscribe = window.ansiktenAPI.onFolderChanged?.(() => {
      if (!lastParamsRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runCount(lastParamsRef.current, { silent: true });
      }, REFRESH_DEBOUNCE_MS);
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (unsubscribe) unsubscribe();
      for (const dir of watchedDirsRef.current) {
        window.ansiktenAPI.unwatchFolder?.(dir);
      }
      watchedDirsRef.current = new Set();
    };
  }, [runCount]);

  // Right-click on a name (player table / excluded sections): session moves
  // between the buckets + permanent publik.
  const { menu, openMenu, closeMenu } = useContextMenu();
  const handleNameContextMenu = useCallback(
    (e, name, bucket) => openMenu(e, { name, bucket }),
    [openMenu]
  );
  const menuItems = menu ? buildPlayerMenuItems(menu.bucket, makePublikPermanent) : [];

  const totalImages = result?.total_images ?? 0;

  return (
    <div className="module-container player-count" data-keyboard-scope="isolated">
      <div className="module-header">
        <h3 className="module-title">{t('playerCount.title')}</h3>
        <div className="button-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={perMatch}
              onChange={(e) => {
                const v = e.target.checked;
                setPerMatch(v);
                if (lastParamsRef.current) submitWith(input, v);
              }}
            />
            {t('playerCount.perMatch')}
          </label>
          {isRefreshing && <span className="player-count-refreshing">{t('playerCount.refreshing')}</span>}
        </div>
      </div>

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onAutoApply={handleAutoApply}
        busy={isLoading}
      />

      <CountOptions
        options={options}
        onOptionsChange={applyOptions}
        onOptionsPreview={setOptions}
        exclusions={exclusions}
        sessionSpelare={session.spelare}
        grupp={grupp}
        alwaysPublik={alwaysPublik}
        envKeys={envKeys}
        dirty={exclusionsDirty || configDirty}
        savingDefaults={savingDefaults}
        onAddExcluded={addExcluded}
        onRemoveExcluded={removeExcluded}
        onSaveDefaults={saveDefaults}
        onReset={resetExclusions}
        busy={isLoading}
      />

      <div className="module-body player-count-body">
        {error && <Alert variant="error">{t('playerCount.errorPrefix')} {error}</Alert>}

        {isLoading && <div className="empty-state">{t('playerCount.counting')}</div>}

        {!isLoading && !error && !hasRun && (
          <div className="empty-state">
            {t('playerCount.emptyPrompt.before')}
            <strong>{t('playerCount.emptyPrompt.action')}</strong>
            {t('playerCount.emptyPrompt.after')}
          </div>
        )}

        {!isLoading && !error && hasRun && result && (
          <>
            <ResultSummary result={result} />
            {totalImages === 0 ? (
              <div className="empty-state">{t('playerCount.noMatches')}</div>
            ) : (
              <>
                <PlayerTable players={result.players} baseline={result.baseline} timeRange={result.time_range} onPlayerClick={openCullForPlayer} onNameContextMenu={handleNameContextMenu} />
                <ExcludedSections excluded={result.excluded} onNameContextMenu={handleNameContextMenu} />
                {perMatch && result.matches?.length > 0 && (
                  <MatchSections matches={result.matches} onPlayerClick={openCullForPlayer} onNameContextMenu={handleNameContextMenu} />
                )}
              </>
            )}
          </>
        )}
      </div>

      <ContextMenu menu={menu} items={menuItems} onClose={closeMenu} />
    </div>
  );
}

function ResultSummary({ result }) {
  const tr = result.time_range;
  return (
    <div className="player-count-summary">
      <span><strong>{result.total_images}</strong> {t('playerCount.summary.images')}</span>
      <span><strong>{result.players.length}</strong> {t('playerCount.summary.players')}</span>
      <span>{t('playerCount.summary.baseline', { method: result.baseline_method })}: <strong>{result.baseline}</strong></span>
      {result.files_resolved != null && (
        <span className="player-count-dim">{t('playerCount.summary.files', { count: result.files_resolved })}</span>
      )}
      {tr && (
        <span className="player-count-dim">
          {fmtTime(tr.start)} → {fmtTime(tr.end)} {t('playerCount.summary.duration', { minutes: Math.round(tr.duration_minutes) })}
        </span>
      )}
    </div>
  );
}

// Counting-options row: the three CLI-parity controls (matchgap / baseline /
// min images) plus a collapsible coach/audience exclusion editor. Purely driven
// by props — the parent owns state and re-runs the count on change.
export function CountOptions({
  options,
  onOptionsChange,
  onOptionsPreview,
  exclusions,
  sessionSpelare,
  grupp,
  alwaysPublik,
  envKeys,
  dirty,
  savingDefaults,
  onAddExcluded,
  onRemoveExcluded,
  onSaveDefaults,
  onReset,
  busy,
}) {
  const [open, setOpen] = useState(false);

  // Number inputs update the value on each keystroke (preview, no recount) and
  // only re-run the count on blur / Enter — so typing "300" doesn't fire three
  // counts on a large folder. The baseline <select> is discrete → applies at once.
  const previewNum = (key, raw, min) => {
    const n = parseInt(raw, 10);
    onOptionsPreview({ ...options, [key]: Number.isNaN(n) ? min : Math.max(min, n) });
  };
  const commitOptions = () => onOptionsChange(options);

  const total =
    exclusions.tranare.length +
    exclusions.publik.length +
    (sessionSpelare?.length || 0) +
    (grupp?.length || 0) +
    (alwaysPublik?.length || 0);

  return (
    <div className="player-count-options">
      <div className="player-count-options-row">
        <label className="pc-option">
          {t('playerCount.options.matchGap')}
          <input
            className="form-input pc-num"
            type="number"
            min="1"
            value={options.gapMinutes}
            onChange={(e) => previewNum('gapMinutes', e.target.value, 1)}
            onBlur={commitOptions}
            onKeyDown={(e) => e.key === 'Enter' && commitOptions()}
            disabled={busy}
            title={t('playerCount.options.matchGapTitle')}
          />
        </label>
        <label className="pc-option">
          {t('playerCount.options.baseline')}
          <select
            className="form-select"
            value={options.baseline}
            onChange={(e) => onOptionsChange({ ...options, baseline: e.target.value })}
            disabled={busy}
            title={t('playerCount.options.baselineTitle')}
          >
            <option value="median">{t('playerCount.options.baselineMedian')}</option>
            <option value="mean">{t('playerCount.options.baselineMean')}</option>
          </select>
        </label>
        <label className="pc-option">
          {t('playerCount.options.minImages')}
          <input
            className="form-input pc-num"
            type="number"
            min="1"
            value={options.minImages}
            onChange={(e) => previewNum('minImages', e.target.value, 1)}
            onBlur={commitOptions}
            onKeyDown={(e) => e.key === 'Enter' && commitOptions()}
            disabled={busy}
            title={t('playerCount.options.minImagesTitle')}
          />
        </label>
        <Button
          variant="secondary"
          className="pc-excl-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {t('playerCount.options.excludedToggle')}{total > 0 ? ` (${total})` : ''} {open ? '▾' : '▸'}
        </Button>
      </div>

      {open && (
        <div className="player-count-exclusions">
          {/* Session-only force-includes (context menu "gör till spelare"):
              removable chips = undo; never persisted by Spara som standard. */}
          {sessionSpelare?.length > 0 && (
            <ExclusionList
              title={t('playerCount.exclusions.spelare')}
              kind="spelare"
              names={sessionSpelare}
              onAdd={onAddExcluded}
              onRemove={onRemoveExcluded}
              busy={busy}
            />
          )}
          <ExclusionList
            title={t('playerCount.exclusions.tranare')}
            kind="tranare"
            names={exclusions.tranare}
            onAdd={onAddExcluded}
            onRemove={onRemoveExcluded}
            busy={busy}
          />
          <ExclusionList
            title={t('playerCount.exclusions.publik')}
            kind="publik"
            names={exclusions.publik}
            onAdd={onAddExcluded}
            onRemove={onRemoveExcluded}
            busy={busy}
          />

          {/* Config-level always-excluded markers (take effect after saving). */}
          <div className="pc-always-heading" title={t('playerCount.exclusions.alwaysHeadingTitle')}>
            {t('playerCount.exclusions.alwaysHeading')}
          </div>
          <ExclusionList
            title={t('playerCount.exclusions.grupp')}
            kind="grupp"
            names={grupp}
            onAdd={onAddExcluded}
            onRemove={onRemoveExcluded}
            busy={busy}
          />
          <ExclusionList
            title={t('playerCount.exclusions.alwaysPublik')}
            kind="alwaysPublik"
            names={alwaysPublik}
            onAdd={onAddExcluded}
            onRemove={onRemoveExcluded}
            busy={busy}
          />

          {envKeys && envKeys.length > 0 && (
            <div className="player-count-dim pc-env-note">
              {t('playerCount.exclusions.envNote', { keys: envKeys.join(', ') })}
            </div>
          )}

          <div className="pc-actions">
            <Button
              variant="secondary"
              onClick={onSaveDefaults}
              disabled={busy || savingDefaults || !dirty}
              title={t('playerCount.exclusions.saveDefaultsTitle')}
            >
              {savingDefaults ? t('playerCount.exclusions.saving') : t('playerCount.exclusions.saveDefaults')}
            </Button>
            <Button
              variant="secondary"
              onClick={onReset}
              disabled={busy || savingDefaults}
              title={t('playerCount.exclusions.resetTitle')}
            >
              {t('playerCount.exclusions.reset')}
            </Button>
            {dirty && <span className="player-count-dim">{t('playerCount.exclusions.unsaved')}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// One editable exclusion list: removable chips + an add-name field.
// `onAdd`/`onRemove` take (kind, name).
function ExclusionList({ title, kind, names, onAdd, onRemove, busy }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    onAdd(kind, draft);
    setDraft('');
  };
  return (
    <div className="pc-list">
      <div className="pc-list-title">{title}</div>
      <div className="pc-chips">
        {names.map((name) => (
          <span className="pc-chip" key={name}>
            <span className="pc-chip-label">{name}</span>
            <button
              type="button"
              className="pc-chip-remove"
              onClick={() => onRemove(kind, name)}
              disabled={busy}
              aria-label={t('playerCount.exclusions.remove', { name })}
            >
              ×
            </button>
          </span>
        ))}
        {names.length === 0 && <span className="player-count-dim pc-empty">{t('playerCount.exclusions.empty')}</span>}
      </div>
      <input
        className="form-input pc-add"
        type="text"
        aria-label={t('playerCount.exclusions.add', { title: title.toLowerCase() })}
        placeholder={t('playerCount.exclusions.addPlaceholder', { title: title.toLowerCase() })}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        disabled={busy}
      />
    </div>
  );
}

// Bin timestamps into `bins` density buckets across the [start, end] window.
// Returns null when there's nothing to show. Pure (unit-tested).
export function binTimestamps(timestamps, start, end, bins = 24) {
  if (!timestamps || timestamps.length === 0 || !start || !end) return null;
  const t0 = new Date(start).getTime();
  const t1 = new Date(end).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  const span = Math.max(1, t1 - t0);
  const counts = new Array(bins).fill(0);
  for (const ts of timestamps) {
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) continue;
    let idx = Math.floor(((t - t0) / span) * bins);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  }
  return counts;
}

// Temporal sparkline: a tiny density histogram of the player's timestamps across
// the [start, end] window, mirroring the CLI's spark column (when were this
// player's images taken across the session/match).
function Spark({ timestamps, start, end, bins = 24 }) {
  const counts = binTimestamps(timestamps, start, end, bins);
  if (!counts) {
    return <span className="player-spark player-spark-empty" />;
  }
  const max = Math.max(1, ...counts);
  return (
    <span className="player-spark" title={t('playerCount.table.sparkTitle', { count: timestamps.length })}>
      {counts.map((c, i) => (
        <span
          key={i}
          className="player-spark-bin"
          style={{ height: c ? `${Math.max(8, (c / max) * 100)}%` : '0' }}
        />
      ))}
    </span>
  );
}

// `timeRange` is { start, end } (the session window, or a match's window) used
// for the spark; `baseline` anchors the distribution bar at 50% of the track,
// mirroring the CLI's baseline-relative bar (at-baseline = half-full, 2× = full).
function PlayerTable({ players, baseline, timeRange, onPlayerClick, onNameContextMenu }) {
  const maxCount = players.reduce((m, p) => Math.max(m, p.count), 1);
  const ref = baseline > 0 ? baseline : maxCount; // bar reference (baseline → 50%)
  return (
    <table className="player-count-table">
      <thead>
        <tr>
          <th>{t('playerCount.table.name')}</th>
          <th className="num">{t('playerCount.table.count')}</th>
          <th className="num">{t('playerCount.table.pct')}</th>
          <th className="num" title={t('playerCount.table.deltaTitle')}>{t('playerCount.table.deltaPct')}</th>
          <th className="num">{t('playerCount.table.deltaN')}</th>
          <th className="bar-col">{t('playerCount.table.distribution')}</th>
          <th className="spark-col">{t('playerCount.table.timeline')}</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p) => {
          const rowTitle = onPlayerClick ? t('playerCount.table.rowTitle', { name: p.name }) : undefined;
          return (
          <tr
            key={p.name}
            className={onPlayerClick ? 'clickable' : ''}
            onClick={onPlayerClick ? () => onPlayerClick(p.name) : undefined}
            role={onPlayerClick ? 'button' : undefined}
            tabIndex={onPlayerClick ? 0 : undefined}
            aria-label={rowTitle}
            onKeyDown={onPlayerClick ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onPlayerClick(p.name);
              }
            } : undefined}
            onContextMenu={onNameContextMenu ? (e) => onNameContextMenu(e, p.name, 'players') : undefined}
            title={rowTitle}
          >
            <td>{p.name}</td>
            <td className="num">{p.count}</td>
            <td className="num">{p.pct}%</td>
            <td className={`num delta delta-${p.level}`} title={t('playerCount.table.deltaTitle')}>
              {p.delta_pct > 0 ? '+' : ''}{p.delta_pct}%
            </td>
            <td className={`num delta delta-${p.level}`}>
              {p.delta_n > 0 ? '+' : ''}{Math.round(p.delta_n)}
            </td>
            <td className="bar-col">
              <div className="player-bar-track">
                <div className="player-bar-baseline" title={t('playerCount.table.baselineBarTitle', { baseline })} />
                <div
                  className={`player-bar-fill level-${p.level}`}
                  style={{ width: `${Math.min(100, (p.count / (ref * 2)) * 100)}%` }}
                />
              </div>
            </td>
            <td className="spark-col">
              <Spark timestamps={p.timestamps} start={timeRange?.start} end={timeRange?.end} />
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Bucket keys rendered by ExcludedSections; labels come from the catalog
// (playerCount.excludedLabels.<key>). excludedCount sums over the same keys so
// the two never drift.
const EXCLUDED_KEYS = ['tranare', 'grupp', 'publik', 'below_threshold'];

function ExcludedSections({ excluded, onNameContextMenu }) {
  if (!excluded) return null;
  const groups = EXCLUDED_KEYS.filter(
    (key) => excluded[key] && excluded[key].length > 0
  );
  if (groups.length === 0) return null;

  return (
    <div className="player-count-excluded">
      {groups.map((key) => (
        <details key={key} className="player-count-group">
          <summary>{t(`playerCount.excludedLabels.${key}`)} ({excluded[key].length})</summary>
          <ul>
            {excluded[key].map((e) => (
              <li
                key={e.name}
                onContextMenu={onNameContextMenu ? (ev) => onNameContextMenu(ev, e.name, key) : undefined}
              >
                {e.name}: {e.count} ({e.pct}%)
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

// Total distinct names + excluded count for a match, mirroring the CLI's
// `total_in_list` / `excluded_count` in print_section (players + all excluded
// buckets). Sums over the same bucket keys `ExcludedSections` renders, so the
// two never drift.
function excludedCount(excluded) {
  if (!excluded) return 0;
  return EXCLUDED_KEYS.reduce(
    (sum, key) => sum + (excluded[key]?.length || 0),
    0
  );
}

// Per-match info row: mirrors the CLI's `Spelare: N (av T, exkl. K)  Baseline:
// method=B` line. Duration/total_images already live in the <summary>.
function MatchInfoRow({ match }) {
  const excl = excludedCount(match.excluded);
  const total = match.players.length + excl;
  return (
    <div className="player-count-summary player-count-match-info">
      <span><strong>{match.players.length}</strong> {t('playerCount.summary.players')}</span>
      {excl > 0 && (
        <span className="player-count-dim">{t('playerCount.match.info', { total, excluded: excl })}</span>
      )}
      <span>{t('playerCount.summary.baseline', { method: match.baseline_method })}: <strong>{match.baseline}</strong></span>
    </div>
  );
}

export function MatchSections({ matches, onPlayerClick, onNameContextMenu }) {
  return (
    <div className="player-count-matches">
      {matches.map((m) => (
        <details key={m.index} className="player-count-group">
          <summary>
            {t('playerCount.match.summary', {
              index: m.index,
              start: fmtDateTime(m.start),
              end: fmtTime(m.end),
              minutes: Math.round(m.duration_minutes),
              images: m.total_images,
            })}
          </summary>
          <MatchInfoRow match={m} />
          {m.players.length > 0 ? (
            <PlayerTable players={m.players} baseline={m.baseline} timeRange={{ start: m.start, end: m.end }} onPlayerClick={onPlayerClick} onNameContextMenu={onNameContextMenu} />
          ) : (
            <div className="empty-state compact">{t('playerCount.match.noPlayers')}</div>
          )}
          <ExcludedSections excluded={m.excluded} onNameContextMenu={onNameContextMenu} />
        </details>
      ))}
    </div>
  );
}

// Directory before the first wildcard char in a glob pattern.
function globBaseDir(pattern) {
  const wildcardIdx = pattern.search(/[*?[]/);
  const literal = wildcardIdx === -1 ? pattern : pattern.slice(0, wildcardIdx);
  const slashIdx = literal.lastIndexOf('/');
  if (slashIdx === -1) return '';
  return literal.slice(0, slashIdx);
}

function fmtTime(iso) {
  if (!iso) return '';
  return iso.slice(11, 16);
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export default PlayerCountModule;
