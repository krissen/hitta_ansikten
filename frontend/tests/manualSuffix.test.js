import { describe, it, expect } from 'vitest';
import { normalizeSuffix } from '../src/renderer/shared/manualSuffix.js';

describe('normalizeSuffix', () => {
  it('replaces spaces with underscore', () => {
    expect(normalizeSuffix('blå bär')).toBe('bla_bar');
  });

  it('folds diacritics (å/ä -> a, ö -> o)', () => {
    expect(normalizeSuffix('vinbär')).toBe('vinbar');
    expect(normalizeSuffix('Åke Öberg')).toBe('Ake_Oberg');
    expect(normalizeSuffix('à')).toBe('a');
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeSuffix('  a   b  ')).toBe('a_b');
  });

  it('sanitizes path characters', () => {
    expect(normalizeSuffix('a/b\\c')).toBe('a_b_c');
    expect(normalizeSuffix('/etc/passwd')).toBe('etc_passwd');
  });

  it('collapses dot-runs so no ".." traversal token survives', () => {
    expect(normalizeSuffix('sommar..24')).toBe('sommar_24');
    expect(normalizeSuffix('a...b')).toBe('a_b');
    expect(normalizeSuffix('...')).toBe('');
  });

  it('returns empty for empty/whitespace/path-only input', () => {
    expect(normalizeSuffix('')).toBe('');
    expect(normalizeSuffix('   ')).toBe('');
    expect(normalizeSuffix(null)).toBe('');
    expect(normalizeSuffix('///')).toBe('');
  });
});
