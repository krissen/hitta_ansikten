/**
 * CullingFilterBar - the top filter/action bar of the culling workspace.
 *
 * Extracted verbatim from CullingModule. Presentational: it renders the folder
 * picker, file-type/player selects, glob input, Visa/Rutnät/Papperskorg buttons
 * and forwards every interaction to callbacks/state the shell owns. `lastQueryRef`
 * is read at event time (not render) so auto-apply matches the previous inline
 * behavior exactly.
 *
 * Button triage (see theming.md "Button Categories"): Visa is the bar's single
 * primary action; the Rutnät and Papperskorg toggles are secondary buttons that
 * signal their on-state via `aria-pressed` (styled in CullingModule.css).
 */

import React from 'react';
import { t } from '../../../i18n/index.js';
import { Button } from '../shared/index.js';

export function CullingFilterBar({
  addFolders,
  clearWorkspace,
  canClear,
  preset,
  setPreset,
  runFilter,
  lastQueryRef,
  player,
  players,
  selectPlayer,
  focusList,
  glob,
  setGlob,
  setPlayer,
  canFilter,
  isLoading,
  viewMode,
  setViewMode,
  showTrash,
  setShowTrash,
}) {
  return (
    <div className="culling-filterbar">
      <Button variant="secondary" onClick={addFolders}>{t('culling.filterBar.addFolder')}</Button>
      <Button variant="secondary" onClick={clearWorkspace} disabled={!canClear}>
        {t('culling.filterBar.clear')}
      </Button>
      <select
        className="form-select"
        value={preset}
        onChange={(e) => {
          const v = e.target.value;
          setPreset(v);
          // Auto-apply once a scope exists (a query has run).
          if (lastQueryRef.current) runFilter({ extension_preset: v });
        }}
        title={t('culling.filterBar.fileType')}
      >
        <option value="jpg">{t('culling.filterBar.presets.jpg')}</option>
        <option value="nef">{t('culling.filterBar.presets.nef')}</option>
        <option value="raw">{t('culling.filterBar.presets.raw')}</option>
      </select>
      <select
        className="form-select"
        value={player}
        onChange={(e) => {
          const name = e.target.value;
          selectPlayer(name);
          // Picking a player applies immediately — no need to press Visa.
          if (lastQueryRef.current) {
            const g = name ? `*${name}*` : '';
            runFilter({ player: name || null, name_glob: g || null });
          }
          // Hand focus to the list so the next arrow press navigates files
          // instead of changing the dropdown selection.
          e.target.blur();
          focusList();
        }}
        title={t('culling.filterBar.player')}
      >
        <option value="">{t('culling.filterBar.allPlayers')}</option>
        {players.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <input
        className="form-input culling-glob"
        type="text"
        placeholder={t('culling.filterBar.globPlaceholder')}
        value={glob}
        onChange={(e) => { setGlob(e.target.value); setPlayer(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') runFilter(); }}
      />
      <Button variant="primary" onClick={() => runFilter()} disabled={!canFilter || isLoading}>
        {isLoading ? t('culling.filterBar.loading') : t('culling.filterBar.show')}
      </Button>
      <Button
        variant="secondary"
        aria-pressed={viewMode === 'grid'}
        onClick={() => setViewMode((m) => (m === 'grid' ? 'single' : 'grid'))}
        title={viewMode === 'grid' ? t('culling.filterBar.gridToggleTitle.toSingle') : t('culling.filterBar.gridToggleTitle.toGrid')}
      >
        {t('culling.filterBar.grid')}
      </Button>
      <span className="culling-spacer" />
      <Button
        variant="secondary"
        aria-pressed={showTrash}
        onClick={() => setShowTrash((v) => !v)}
      >
        {t('culling.filterBar.trash')}
      </Button>
    </div>
  );
}

export default CullingFilterBar;
