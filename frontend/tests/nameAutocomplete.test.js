import { describe, it, expect } from 'vitest';
import { rank } from '../src/renderer/components/review/nameAutocomplete.js';

// Direct unit tests for the autocomplete ranking extracted in H4. The DOM
// characterization test (reviewModule.test.jsx) pins the same order through
// FaceCard; these pin the pure function per-rule.

describe('nameAutocomplete.rank', () => {
  const people = ['Anna Andersson', 'Anders', 'Johanna', 'Hanna'];

  it('ranks prefix matches before substring matches', () => {
    expect(rank('anna', people)).toEqual(['Anna Andersson', 'Johanna', 'Hanna']);
  });

  it('is case-insensitive in both directions', () => {
    expect(rank('ANNA', people)).toEqual(['Anna Andersson', 'Johanna', 'Hanna']);
    expect(rank('jOhAnNa', people)).toEqual(['Johanna']);
  });

  it('excludes names that neither start with nor contain the query', () => {
    expect(rank('anna', people)).not.toContain('Anders');
  });

  it('preserves input order within each tier', () => {
    const names = ['Bo Berg', 'Bodil', 'Albo', 'Ebbo'];
    // Prefix tier: Bo Berg, Bodil (input order); substring tier: Albo, Ebbo.
    expect(rank('bo', names)).toEqual(['Bo Berg', 'Bodil', 'Albo', 'Ebbo']);
  });

  it('returns [] for empty or whitespace-only queries', () => {
    expect(rank('', people)).toEqual([]);
    expect(rank('   ', people)).toEqual([]);
    expect(rank(null, people)).toEqual([]);
    expect(rank(undefined, people)).toEqual([]);
  });

  it('caps the result at 8 entries by default', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Anna ${i}`);
    expect(rank('anna', many)).toHaveLength(8);
    expect(rank('anna', many, 3)).toHaveLength(3);
  });

  it('prefix matches fill the cap before substrings get a slot', () => {
    const prefixes = Array.from({ length: 8 }, (_, i) => `Anna ${i}`);
    const names = ['Johanna', ...prefixes];
    // 8 prefix matches exist -> the substring match is squeezed out.
    expect(rank('anna', names)).toEqual(prefixes);
  });
});
