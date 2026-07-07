import { describe, it, expect } from 'vitest';
import {
  statsScopeFromQuery,
  isRaw,
  globBaseDir,
  basename,
  stripExt,
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
