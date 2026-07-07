import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { PreprocessingStatus } from '../src/renderer/services/preprocessing/index.js';

// Characterization + fence tests for FileQueueModule.
//
// FileQueueModule (~2700 lines, ~129 hooks) is the repo's biggest god-component:
// it owns the file queue state, preprocessing orchestration (via a
// getPreprocessingManager singleton), the face-based NEF-rename flow, a stack of
// localStorage preference readers, and the FileQueueItem row subcomponent. These
// tests pin the CURRENT observable behavior so the planned decomposition
// (H8/H9 — pure extractions → preprocessing hook → queue reducer + rename logic)
// can move code without silently changing it. They EXTEND the existing pure-helper
// coverage (fileQueueEligibility.test.js), which is not duplicated here.
//
// Everything the component reaches outside its own render — the backend API, the
// module event bus, toasts, the file-watch IPC, the api-client singleton and the
// preprocessing manager — is mocked with controllable stubs. The i18n catalog and
// Icon are left REAL so assertions key off the actual Swedish text.
//
// Coverage gaps (documented honestly, closed when H8/H9 extract pure logic —
// mirrors how H2/H4 closed ReviewModule's gaps):
//  - loadFile's full "openModule → waitForListeners → emit load-image" handshake
//    is only exercised indirectly (fix-mode undo, auto-load and the workspace
//    poll are not driven); the 'completed' item state is pinned via a restored
//    queue, not via a live review-complete round-trip.
//  - The preprocessing "all done" completion toast (prevPreprocessingCountRef)
//    compares an object against a string status and is left as-is; its exact
//    firing is not asserted here (a known quirk for H8 to untangle).
//  - FileQueueItem's width-measured confirmed-names row depends on canvas
//    measureText (absent under jsdom) and is intentionally not exercised; the
//    status icon / status text / preprocess indicator surfaces are pinned instead.

// ---------------------------------------------------------------------------
// Group 1: preference readers (pure functions, exported seam).
//
// These read localStorage directly and are the cleanest extraction targets in
// H8. They are pinned as pure units (no React) here. The `export` on each is a
// behavior-neutral seam added for this fence (noted in the PR body).
// ---------------------------------------------------------------------------
import {
  getAutoLoadPreference,
  getRenameConfig,
  getNotificationPreference,
  getPreprocessingConfig,
  getRequireRenameConfirmation,
  getAutoRemoveMissingPreference,
  getToastDurationMultiplier,
  getInsertModePreference,
  naturalSortCompare,
} from '../src/renderer/components/FileQueueModule.jsx';

// jsdom (as configured here) does not expose a bare `localStorage` global; the
// preference readers and the queue persistence effect both reach for it.
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
    const store = new Map();
    const ls = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
    globalThis.localStorage = ls;
    if (typeof window !== 'undefined') window.localStorage = ls;
  }
});

function setPrefs(obj) {
  localStorage.setItem('ansikten-preferences', JSON.stringify(obj));
}

describe('FileQueueModule — preference readers (pure)', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('getAutoLoadPreference defaults to true and reads the stored flag', () => {
    expect(getAutoLoadPreference()).toBe(true); // no prefs
    setPrefs({ fileQueue: { autoLoadOnStartup: false } });
    expect(getAutoLoadPreference()).toBe(false);
  });

  it('getInsertModePreference defaults to alphabetical', () => {
    expect(getInsertModePreference()).toBe('alphabetical');
    setPrefs({ fileQueue: { insertMode: 'bottom' } });
    expect(getInsertModePreference()).toBe('bottom');
  });

  it('getRequireRenameConfirmation defaults to true (safety gate on)', () => {
    expect(getRequireRenameConfirmation()).toBe(true);
    setPrefs({ rename: { requireConfirmation: false } });
    expect(getRequireRenameConfirmation()).toBe(false);
  });

  it('getAutoRemoveMissingPreference defaults to true', () => {
    expect(getAutoRemoveMissingPreference()).toBe(true);
    setPrefs({ fileQueue: { autoRemoveMissing: false } });
    expect(getAutoRemoveMissingPreference()).toBe(false);
  });

  it('getToastDurationMultiplier defaults to 1.0', () => {
    expect(getToastDurationMultiplier()).toBe(1.0);
    setPrefs({ notifications: { toastDuration: 2.5 } });
    expect(getToastDurationMultiplier()).toBe(2.5);
  });

  it('getNotificationPreference has per-key defaults (pause on, resume off)', () => {
    expect(getNotificationPreference('showStatusIndicator')).toBe(true);
    expect(getNotificationPreference('showToastOnPause')).toBe(true);
    expect(getNotificationPreference('showToastOnResume')).toBe(false);
    setPrefs({ preprocessing: { notifications: { showToastOnResume: true, showToastOnPause: false } } });
    expect(getNotificationPreference('showToastOnResume')).toBe(true);
    expect(getNotificationPreference('showToastOnPause')).toBe(false);
  });

  it('getRenameConfig returns null when no non-default rename keys are set', () => {
    expect(getRenameConfig()).toBeNull();
    setPrefs({ rename: {} });
    expect(getRenameConfig()).toBeNull();
  });

  it('getRenameConfig includes only the explicitly-set keys (defaults omitted)', () => {
    setPrefs({ rename: { useFirstNameOnly: true, nameSeparator: '_' } });
    expect(getRenameConfig()).toEqual({ useFirstNameOnly: true, nameSeparator: '_' });
  });

  it('getPreprocessingConfig fills enabled/maxWorkers defaults', () => {
    expect(getPreprocessingConfig()).toEqual({});
    setPrefs({ preprocessing: { parallelWorkers: 4 } });
    expect(getPreprocessingConfig()).toMatchObject({ enabled: true, maxWorkers: 4 });
  });

  it('naturalSortCompare orders filenames numeric-aware', () => {
    const items = [
      { fileName: 'IMG_10.NEF' },
      { fileName: 'IMG_2.NEF' },
      { fileName: 'IMG_1.NEF' },
    ];
    const sorted = [...items].sort(naturalSortCompare).map((i) => i.fileName);
    expect(sorted).toEqual(['IMG_1.NEF', 'IMG_2.NEF', 'IMG_10.NEF']);
  });

  it('readers swallow malformed JSON and fall back to defaults', () => {
    localStorage.setItem('ansikten-preferences', '{not json');
    expect(getAutoLoadPreference()).toBe(true);
    expect(getInsertModePreference()).toBe('alphabetical');
    expect(getRenameConfig()).toBeNull();
  });
});
