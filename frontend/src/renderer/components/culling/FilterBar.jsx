/**
 * CullingFilterBar - the top filter/action bar of the culling workspace.
 *
 * Extracted verbatim from CullingModule. Presentational: it renders the folder
 * picker, file-type/player selects, glob input, Visa/Rutnät/Papperskorg buttons
 * and forwards every interaction to callbacks/state the shell owns. `lastQueryRef`
 * is read at event time (not render) so auto-apply matches the previous inline
 * behavior exactly.
 */

import React from 'react';

export function CullingFilterBar({
  addFolders,
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
      <button className="btn-secondary" onClick={addFolders}>+ Mapp</button>
      <select
        className="form-select"
        value={preset}
        onChange={(e) => {
          const v = e.target.value;
          setPreset(v);
          // Auto-apply once a scope exists (a query has run).
          if (lastQueryRef.current) runFilter({ extension_preset: v });
        }}
        title="Filtyp"
      >
        <option value="jpg">jpg / jpeg</option>
        <option value="nef">nef</option>
        <option value="raw">raw (alla)</option>
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
        title="Spelare"
      >
        <option value="">Alla spelare</option>
        {players.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <input
        className="form-input culling-glob"
        type="text"
        placeholder="Glob, t.ex. *ArvidW*"
        value={glob}
        onChange={(e) => { setGlob(e.target.value); setPlayer(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') runFilter(); }}
      />
      <button className="btn-action" onClick={() => runFilter()} disabled={!canFilter || isLoading}>
        {isLoading ? '…' : 'Visa'}
      </button>
      <button
        className={viewMode === 'grid' ? 'btn-action' : 'btn-secondary'}
        aria-pressed={viewMode === 'grid'}
        onClick={() => setViewMode((m) => (m === 'grid' ? 'single' : 'grid'))}
        title={viewMode === 'grid' ? 'Visa enkelbild' : 'Visa översikt (rutnät)'}
      >
        Rutnät
      </button>
      <span className="culling-spacer" />
      <button
        className={showTrash ? 'btn-action' : 'btn-secondary'}
        onClick={() => setShowTrash((v) => !v)}
      >
        Papperskorg
      </button>
    </div>
  );
}

export default CullingFilterBar;
