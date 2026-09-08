import { describe, it, expect } from 'vitest';
import {
  statsScopeFromQuery,
  scanScopeKey,
  isRaw,
  globBaseDir,
  basename,
  stripExt,
  cullingPresetFrom,
} from '../src/renderer/components/culling/cullingQueryUtils.js';

describe('statsScopeFromQuery', () => {
  it('returns null for a falsy query', () => {
    expect(statsScopeFromQuery(null)).toBeNull();
    expect(statsScopeFromQuery(undefined)).toBeNull();
  });

  it('projects only the scope fields (drops player/name_glob)', () => {
    const q = {
      roots: ['/a'],
      globs: ['*.jpg'],
      extension_preset: 'jpg',
      recursive: true,
      date_from: '2026-01-01',
      date_to: '2026-02-01',
      player: 'Alice',
      name_glob: '*Alice*',
    };
    expect(statsScopeFromQuery(q)).toEqual({
      roots: ['/a'],
      globs: ['*.jpg'],
      extension_preset: 'jpg',
      recursive: true,
      date_from: '2026-01-01',
      date_to: '2026-02-01',
    });
  });

  it('omits baseline/min_images when no countSettings are given', () => {
    const q = {
      roots: ['/a'],
      globs: [],
      extension_preset: 'jpg',
      recursive: true,
      date_from: null,
      date_to: null,
    };
    const scope = statsScopeFromQuery(q);
    expect(scope).not.toHaveProperty('baseline');
    expect(scope).not.toHaveProperty('min_images');
  });

  it('folds baseline and min_images in from countSettings', () => {
    const q = {
      roots: ['/a'],
      globs: [],
      extension_preset: 'jpg',
      recursive: true,
      date_from: null,
      date_to: null,
    };
    expect(statsScopeFromQuery(q, { baseline: 'mean', minImages: 5 })).toEqual({
      roots: ['/a'],
      globs: [],
      extension_preset: 'jpg',
      recursive: true,
      date_from: null,
      date_to: null,
      baseline: 'mean',
      min_images: 5,
    });
  });
});

describe('scanScopeKey', () => {
  it('returns null for a falsy scope', () => {
    expect(scanScopeKey(null)).toBeNull();
    expect(scanScopeKey(undefined)).toBeNull();
  });

  it('keys equal for scopes differing only in baseline/min_images (counting options)', () => {
    const base = statsScopeFromQuery({
      roots: ['/a'],
      globs: [],
      extension_preset: 'jpg',
      recursive: true,
      date_from: null,
      date_to: null,
    });
    const withCounts = statsScopeFromQuery(
      {
        roots: ['/a'],
        globs: [],
        extension_preset: 'jpg',
        recursive: true,
        date_from: null,
        date_to: null,
      },
      { baseline: 'mean', minImages: 9 },
    );
    expect(scanScopeKey(withCounts)).toBe(scanScopeKey(base));
  });

  it('keys differ when a scan field changes (roots / preset / recursive / dates / globs)', () => {
    const s = {
      roots: ['/a'],
      globs: [],
      extension_preset: 'jpg',
      recursive: true,
      date_from: null,
      date_to: null,
    };
    const k = scanScopeKey(s);
    expect(scanScopeKey({ ...s, roots: ['/b'] })).not.toBe(k);
    expect(scanScopeKey({ ...s, globs: ['*.jpg'] })).not.toBe(k);
    expect(scanScopeKey({ ...s, extension_preset: 'nef' })).not.toBe(k);
    expect(scanScopeKey({ ...s, recursive: false })).not.toBe(k);
    expect(scanScopeKey({ ...s, date_from: '2026-01-01' })).not.toBe(k);
    expect(scanScopeKey({ ...s, date_to: '2026-02-01' })).not.toBe(k);
  });

  it('normalizes a missing field to null so absent vs. explicit-null key the same', () => {
    const withNull = {
      roots: ['/a'],
      globs: [],
      extension_preset: 'jpg',
      recursive: true,
      date_from: null,
      date_to: null,
    };
    const missing = {
      roots: ['/a'],
      globs: [],
      extension_preset: 'jpg',
      recursive: true,
    };
    expect(scanScopeKey(missing)).toBe(scanScopeKey(withNull));
  });
});

describe('isRaw', () => {
  it('recognises RAW extensions case-insensitively', () => {
    expect(isRaw('/p/x.NEF')).toBe(true);
    expect(isRaw('/p/x.nef')).toBe(true);
    expect(isRaw('/p/x.CR2')).toBe(true);
  });

  it('returns false for JPEGs and extensionless paths', () => {
    expect(isRaw('/p/x.jpg')).toBe(false);
    expect(isRaw('/p/noext')).toBe(false);
  });
});

describe('globBaseDir', () => {
  it('returns the literal directory before the first wildcard', () => {
    expect(globBaseDir('/a/b/*.jpg')).toBe('/a/b');
    expect(globBaseDir('/a/b/c?.jpg')).toBe('/a/b');
    expect(globBaseDir('/a/[abc].jpg')).toBe('/a');
  });

  it('returns empty when there is no directory component', () => {
    expect(globBaseDir('*.jpg')).toBe('');
    expect(globBaseDir('literal')).toBe('');
  });
});

describe('cullingPresetFrom', () => {
  it('passes through the presets culling can represent', () => {
    expect(cullingPresetFrom('jpg')).toBe('jpg');
    expect(cullingPresetFrom('nef')).toBe('nef');
    expect(cullingPresetFrom('raw')).toBe('raw');
  });

  it('maps Räkna-only presets (images/all) to jpg', () => {
    expect(cullingPresetFrom('images')).toBe('jpg');
    expect(cullingPresetFrom('all')).toBe('jpg');
  });

  it('falls back to jpg for a missing/unknown preset', () => {
    expect(cullingPresetFrom(undefined)).toBe('jpg');
    expect(cullingPresetFrom(null)).toBe('jpg');
    expect(cullingPresetFrom('bogus')).toBe('jpg');
  });
});

describe('basename', () => {
  it('handles both / and \\ separators', () => {
    expect(basename('/a/b/c.jpg')).toBe('c.jpg');
    expect(basename('C:\\a\\b\\c.jpg')).toBe('c.jpg');
  });

  it('strips trailing separators', () => {
    expect(basename('/a/b/')).toBe('b');
  });
});

describe('stripExt', () => {
  it('drops the extension', () => {
    expect(stripExt('260601_120000_Alice.jpg')).toBe('260601_120000_Alice');
  });

  it('keeps a leading-dot name intact', () => {
    expect(stripExt('.hidden')).toBe('.hidden');
  });

  it('returns the name unchanged when there is no extension', () => {
    expect(stripExt('noext')).toBe('noext');
  });
});
