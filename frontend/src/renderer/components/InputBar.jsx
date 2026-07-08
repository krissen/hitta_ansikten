/**
 * InputBar - Reusable folder/glob + extension preset + date span selector.
 *
 * Tier-0 shared component for CLI-onboarding modules: the user picks one or more
 * folders and/or a wildcard pattern, an extension preset (jpg|jpeg / nef / ...),
 * and an optional date span. Controlled component: parent owns `value` and
 * receives changes via `onChange`; `onSubmit` fires on the "Räkna" button / Enter.
 *
 * The backend does the actual globbing — this only collects parameters.
 */

import React, { useCallback } from 'react';
import { Button } from './shared';
import './InputBar.css';

export const DEFAULT_PRESETS = [
  { value: 'jpg', label: 'jpg / jpeg' },
  { value: 'nef', label: 'nef' },
  { value: 'raw', label: 'raw (alla)' },
  { value: 'images', label: 'bilder (jpg/png/tiff)' },
  { value: 'all', label: 'alla format' },
];

export const EMPTY_INPUT = {
  roots: [],
  glob: '',
  preset: 'jpg',
  dateFrom: '',
  dateTo: '',
  recursive: true,
};

export function InputBar({
  value,
  onChange,
  onSubmit,
  onAutoApply,
  presets = DEFAULT_PRESETS,
  busy = false,
  submitLabel = 'Räkna',
}) {
  // Select/checkbox changes apply immediately (no need to press the submit
  // button); the parent decides whether anything has run yet. Free-text fields
  // (glob, dates) still require Enter / the button.
  const patchAndApply = useCallback(
    (partial) => {
      const next = { ...value, ...partial };
      onChange(next);
      onAutoApply?.(next);
    },
    [value, onChange, onAutoApply]
  );
  const patch = useCallback(
    (partial) => onChange({ ...value, ...partial }),
    [value, onChange]
  );

  const addFolders = useCallback(async () => {
    try {
      const paths = await window.ansiktenAPI.invoke('open-folder-paths');
      if (!paths || paths.length === 0) return;
      const merged = Array.from(new Set([...value.roots, ...paths]));
      onChange({ ...value, roots: merged });
    } catch (err) {
      console.error('[InputBar] Failed to pick folder:', err);
    }
  }, [value, onChange]);

  const removeRoot = useCallback(
    (root) => patch({ roots: value.roots.filter((r) => r !== root) }),
    [value.roots, patch]
  );

  const canSubmit = !busy && (value.roots.length > 0 || value.glob.trim() !== '');

  const submit = useCallback(() => {
    if (canSubmit) onSubmit();
  }, [canSubmit, onSubmit]);

  const onGlobKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') submit();
    },
    [submit]
  );

  return (
    <div className="input-bar">
      <div className="input-bar-row">
        <Button variant="secondary" onClick={addFolders} disabled={busy}>
          + Mapp
        </Button>

        <input
          className="form-input input-bar-glob"
          type="text"
          placeholder="Wildcard, t.ex. ~/Pictures/250601*.jpg"
          value={value.glob}
          onChange={(e) => patch({ glob: e.target.value })}
          onKeyDown={onGlobKeyDown}
          disabled={busy}
        />

        <select
          className="form-select"
          value={value.preset}
          onChange={(e) => patchAndApply({ preset: e.target.value })}
          disabled={busy}
          title="Filtyper (skiftlägesokänsligt)"
        >
          {presets.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <Button variant="primary" onClick={submit} disabled={!canSubmit}>
          {busy ? '…' : submitLabel}
        </Button>
      </div>

      <div className="input-bar-row input-bar-row-secondary">
        <label className="input-bar-date">
          Från
          <input
            className="form-input"
            type="date"
            value={value.dateFrom}
            onChange={(e) => patch({ dateFrom: e.target.value })}
            disabled={busy}
          />
        </label>
        <label className="input-bar-date">
          Till
          <input
            className="form-input"
            type="date"
            value={value.dateTo}
            onChange={(e) => patch({ dateTo: e.target.value })}
            disabled={busy}
          />
        </label>
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={value.recursive}
            onChange={(e) => patchAndApply({ recursive: e.target.checked })}
            disabled={busy}
          />
          Inkl. undermappar
        </label>
      </div>

      {value.roots.length > 0 && (
        <div className="input-bar-roots">
          {value.roots.map((root) => (
            <span className="input-bar-chip" key={root} title={root}>
              <span className="input-bar-chip-label">{basename(root)}</span>
              <button
                className="input-bar-chip-remove"
                onClick={() => removeRoot(root)}
                disabled={busy}
                aria-label={`Ta bort ${root}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function basename(p) {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

export default InputBar;
