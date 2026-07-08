import { describe, it, expect } from 'vitest';
import { isRenameEligible } from '../src/renderer/components/fileQueueEligibility.js';

describe('fileQueueEligibility', () => {
  describe('isRenameEligible', () => {
    const completed = { status: 'completed', isAlreadyProcessed: false, filePath: '/a.NEF' };
    const processed = { status: 'pending', isAlreadyProcessed: true, filePath: '/b.NEF' };
    const fresh = { status: 'pending', isAlreadyProcessed: false, filePath: '/c.NEF' };

    it('returns false for a missing item', () => {
      expect(isRenameEligible(null, false, new Set())).toBe(false);
      expect(isRenameEligible(undefined, false, new Set())).toBe(false);
    });

    it('treats a completed file as eligible regardless of fix-mode', () => {
      expect(isRenameEligible(completed, false, new Set())).toBe(true);
      expect(isRenameEligible(completed, true, new Set())).toBe(true);
    });

    it('treats an already-processed file as eligible only when fix-mode is off', () => {
      expect(isRenameEligible(processed, false, new Set())).toBe(true);
      expect(isRenameEligible(processed, true, new Set())).toBe(false);
    });

    it('treats an unreviewed, unprocessed file as not eligible', () => {
      expect(isRenameEligible(fresh, false, new Set())).toBe(false);
      expect(isRenameEligible(fresh, true, new Set())).toBe(false);
    });

    it('excludes an otherwise-eligible file while it has unsaved review changes', () => {
      const dirty = new Set(['/a.NEF', '/b.NEF']);
      // The regression: a file with a just-added (unsaved) manual face must not be
      // renamed until its review persists.
      expect(isRenameEligible(completed, false, dirty)).toBe(false);
      expect(isRenameEligible(processed, false, dirty)).toBe(false);
    });

    it('tolerates an omitted dirtyPaths argument', () => {
      expect(isRenameEligible(completed, false)).toBe(true);
      expect(isRenameEligible(processed, false, undefined)).toBe(true);
    });
  });
});
