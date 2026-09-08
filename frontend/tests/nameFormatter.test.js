import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  splitName,
  resolveFirstNameCollisions,
  formatNamesToFit,
  measureTextWidth,
} from '../src/renderer/shared/nameFormatter.js';

describe('nameFormatter', () => {
  describe('splitName', () => {
    it('should split full name into first and last', () => {
      const result = splitName('Anna Svensson');
      expect(result).toEqual({ firstName: 'Anna', lastName: 'Svensson' });
    });

    it('should handle single name', () => {
      const result = splitName('Anna');
      expect(result).toEqual({ firstName: 'Anna', lastName: '' });
    });

    it('should handle empty string', () => {
      const result = splitName('');
      expect(result).toEqual({ firstName: '', lastName: '' });
    });

    it('should handle multiple last names', () => {
      const result = splitName('Anna Maria Svensson');
      expect(result).toEqual({ firstName: 'Anna', lastName: 'Maria Svensson' });
    });
  });

  describe('resolveFirstNameCollisions', () => {
    it('should mark no collision for unique first names', () => {
      const result = resolveFirstNameCollisions(['Anna Svensson', 'Erik Berg']);
      expect(result.get('Anna Svensson').needsDisambig).toBe(false);
      expect(result.get('Erik Berg').needsDisambig).toBe(false);
    });

    it('should mark collision for duplicate first names', () => {
      const result = resolveFirstNameCollisions(['Anna Svensson', 'Anna Berg']);
      expect(result.get('Anna Svensson').needsDisambig).toBe(true);
      expect(result.get('Anna Berg').needsDisambig).toBe(true);
    });

    it('should calculate minimum prefix length for disambiguation', () => {
      const result = resolveFirstNameCollisions(['Anna Svensson', 'Anna Berg']);
      expect(result.get('Anna Svensson').prefixLen).toBe(1);
      expect(result.get('Anna Berg').prefixLen).toBe(1);
    });

    it('should handle same prefix in last names', () => {
      const result = resolveFirstNameCollisions([
        'Anna Svensson',
        'Anna Ström',
      ]);
      expect(result.get('Anna Svensson').prefixLen).toBe(2);
      expect(result.get('Anna Ström').prefixLen).toBe(2);
    });
  });

  describe('formatNamesToFit', () => {
    const wideWidth = 1000;
    const font = '11px Monaco';

    beforeEach(() => {
      vi.spyOn({ measureTextWidth }, 'measureTextWidth').mockImplementation(
        () => 50,
      );
      const mockCanvas = {
        getContext: () => ({
          font: '',
          measureText: () => ({ width: 50 }),
        }),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return empty for empty array', () => {
      const result = formatNamesToFit([], wideWidth, font);
      expect(result.text).toBe('');
      expect(result.fits).toBe(true);
    });

    it('should return full names at level 1 when space allows', () => {
      const result = formatNamesToFit(['Anna Svensson'], wideWidth, font);
      expect(result.text).toBe('Anna Svensson');
      expect(result.level).toBe(1);
      expect(result.fits).toBe(true);
    });

    it('should join multiple names with comma', () => {
      const result = formatNamesToFit(
        ['Anna Svensson', 'Erik Berg'],
        wideWidth,
        font,
      );
      expect(result.text).toBe('Anna Svensson, Erik Berg');
      expect(result.level).toBe(1);
    });

    it('should deduplicate names', () => {
      const result = formatNamesToFit(
        ['Anna Svensson', 'Anna Svensson'],
        wideWidth,
        font,
      );
      expect(result.text).toBe('Anna Svensson');
    });

    it('should filter out empty/null names', () => {
      const result = formatNamesToFit(
        ['Anna Svensson', '', null],
        wideWidth,
        font,
      );
      expect(result.text).toBe('Anna Svensson');
    });
  });
});
