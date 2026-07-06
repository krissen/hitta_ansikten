/**
 * TrashPanel - shared, self-contained browser for the app-managed trash
 * (papperskorg).
 *
 * Lists trashed files, filters them by file type, and restores or empties them.
 * Trashing is reversible: restore puts a file back at its original path; empty
 * deletes for good. Used both as a standalone workspace module and inside
 * CullingModule (which passes `onAfterChange` to keep its cull-loop undo stack
 * and file list in sync).
 *
 * Self-contained: fetches its own list on mount and owns its filter state, so a
 * host only needs to render it. `onAfterChange(kind, ids)` fires after a
 * successful restore ('restore') or empty ('empty') so a host can react.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { t } from '../../i18n/index.js';
import { trashGroup } from './trashGroup.js';
import './TrashPanel.css';

/**
 * @param {object} props
 * @param {(kind: 'restore'|'empty', ids: string[]|null) => void} [props.onAfterChange]
 *   Called after a successful restore/empty. `ids` is the affected id list, or
 *   null for an empty-all.
 */
export function TrashPanel({ onAfterChange }) {
  const { api } = useBackend();

  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'jpg' | 'nef'
  const [error, setError] = useState(null);

  // Fetch the trash contents once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/api/v1/culling/trash');
        if (!cancelled) setItems(data.items || []);
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const restore = useCallback(
    async (id) => {
      setError(null);
      try {
        const res = await api.post('/api/v1/culling/restore', { ids: [id] });
        if (res.restored && res.restored.length > 0) {
          setItems((prev) => prev.filter((it) => it.id !== id));
          onAfterChange?.('restore', [id]);
        } else {
          // 200 with errors[] (unwritable folder, missing stored file): the item
          // stays in the manifest, so keep it visible and surface the reason.
          setError(res.errors?.[0]?.error || t('trash.restoreFailed'));
        }
      } catch (err) {
        setError(err.message || String(err));
      }
    },
    [api, onAfterChange]
  );

  // Empty the trash. With no ids, clears everything; with ids, deletes just
  // those (used to empty only the currently filtered subset).
  const empty = useCallback(
    async (ids = null) => {
      setError(null);
      try {
        await api.post('/api/v1/culling/empty', ids ? { ids } : {});
        if (ids) {
          const gone = new Set(ids);
          setItems((prev) => prev.filter((it) => !gone.has(it.id)));
        } else {
          setItems([]);
        }
        onAfterChange?.('empty', ids);
      } catch (err) {
        setError(err.message || String(err));
      }
    },
    [api, onAfterChange]
  );

  const filtered =
    filter === 'all' ? items : items.filter((it) => trashGroup(it.basename) === filter);

  return (
    <div className="trash-panel">
      <div className="trash-header">
        <span>
          {filter === 'all'
            ? t('trash.countAll', { count: items.length })
            : t('trash.countFiltered', { filtered: filtered.length, total: items.length })}
        </span>
        {items.length > 0 && (
          <>
            <select
              className="form-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              title={t('trash.filterLabel')}
            >
              <option value="all">{t('trash.filterAll')}</option>
              <option value="jpg">{t('trash.filterJpg')}</option>
              <option value="nef">{t('trash.filterNef')}</option>
            </select>
            <button
              className="btn-secondary"
              onClick={() => empty(filter === 'all' ? null : filtered.map((it) => it.id))}
              disabled={filtered.length === 0}
            >
              {filter === 'all' ? t('trash.empty') : t('trash.emptyN', { count: filtered.length })}
            </button>
          </>
        )}
      </div>

      {error && <div className="status-message error">Fel: {error}</div>}

      {items.length === 0 ? (
        <div className="empty-state">{t('trash.isEmpty')}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">{t('trash.noneOfType')}</div>
      ) : (
        <ul className="trash-list">
          {filtered.map((it) => (
            <li key={it.id}>
              <span className="trash-name" title={it.original_path}>
                {it.basename}
              </span>
              <button className="btn-secondary" onClick={() => restore(it.id)}>
                {t('trash.restore')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TrashPanel;
