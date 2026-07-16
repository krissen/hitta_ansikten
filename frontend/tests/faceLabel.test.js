import { describe, it, expect } from 'vitest';
import { buildFaceLabel } from '../src/renderer/components/review/faceLabel.js';
import { resolveSuggestion, acceptAllState } from '../src/renderer/components/review/reviewActions.js';

// Stub i18n: identity lookup keeps the "unknown" fallback deterministic and
// independent of the Swedish string table.
const t = (key) => key;

const face = (overrides = {}) => ({
  face_id: 'f1',
  is_confirmed: false,
  match_alternatives: [],
  ...overrides,
});

describe('buildFaceLabel — formatting branches', () => {
  it('confirmed face shows the user decision (person_name + confidence)', () => {
    const f = face({ is_confirmed: true, person_name: 'Anna', confidence: 0.82 });
    expect(buildFaceLabel(f, 3, t)).toBe('3. Anna (82%)');
  });

  it('ign case shows the ignore confidence only', () => {
    const f = face({ match_case: 'ign', ignore_confidence: 50, match_alternatives: [{ name: 'ign', confidence: 80, is_ignored: true }] });
    expect(buildFaceLabel(f, 1, t)).toBe('1. ign (50%)');
  });

  it('uncertain_ign shows ign then the suggested name', () => {
    const f = face({ match_case: 'uncertain_ign', ignore_confidence: 40, match_alternatives: [{ name: 'Bertil', confidence: 65 }] });
    expect(buildFaceLabel(f, 2, t)).toBe('2. ign (40%) / Bertil');
  });

  it('uncertain_name shows the suggested name then ign', () => {
    const f = face({ match_case: 'uncertain_name', ignore_confidence: 30, match_alternatives: [{ name: 'Cecilia', confidence: 70 }] });
    expect(buildFaceLabel(f, 2, t)).toBe('2. Cecilia / ign (30%)');
  });

  it('name suggestion (unconfirmed) shows tentative name with a question mark', () => {
    const f = face({ match_case: 'name', match_alternatives: [{ name: 'David', confidence: 77 }] });
    expect(buildFaceLabel(f, 4, t)).toBe('4. David? (77%)');
  });

  it('ignore suggestion (unconfirmed) shows a tentative ign', () => {
    const f = face({ match_alternatives: [{ name: 'ign', confidence: 55, is_ignored: true }] });
    expect(buildFaceLabel(f, 4, t)).toBe('4. ign? (55%)');
  });

  it('falls back to unknown when there is nothing to suggest', () => {
    expect(buildFaceLabel(face({ match_case: 'unknown' }), 5, t)).toBe('5. imageViewer.unknown');
    expect(buildFaceLabel(face(), 6, t)).toBe('6. imageViewer.unknown');
  });

  it('never prefers person_name over the top alternative for unconfirmed faces', () => {
    // Older cached response: person_name disagrees with the top alternative.
    const f = face({ match_case: 'name', person_name: 'STALE', match_alternatives: [{ name: 'David', confidence: 77 }] });
    const label = buildFaceLabel(f, 1, t);
    expect(label).toContain('David');
    expect(label).not.toContain('STALE');
  });
});

// Consistency property: for unconfirmed faces, the name the box label shows
// must equal the name the accept paths would apply. acceptAllState is the
// accept oracle here (single-face array); confirmations carry the applied
// name, ignores mean "ign", skips mean nothing to apply.
describe('buildFaceLabel ⇄ accept consistency (unconfirmed faces)', () => {
  const fixtures = {
    name: face({ face_id: 'a', match_case: 'name', match_alternatives: [{ name: 'David', confidence: 77 }] }),
    uncertain_name: face({ face_id: 'b', match_case: 'uncertain_name', ignore_confidence: 30, match_alternatives: [{ name: 'Cecilia', confidence: 70 }] }),
    uncertain_ign: face({ face_id: 'c', match_case: 'uncertain_ign', ignore_confidence: 40, match_alternatives: [{ name: 'ign', confidence: 65, is_ignored: true }] }),
    ign: face({ face_id: 'd', match_case: 'ign', ignore_confidence: 50, match_alternatives: [{ name: 'ign', confidence: 80, is_ignored: true }] }),
    unknown: face({ face_id: 'e', match_case: 'unknown', match_alternatives: [] }),
    empty: face({ face_id: 'f', match_alternatives: [] }),
    diverging_person_name: face({ face_id: 'g', match_case: 'name', person_name: 'STALE', match_alternatives: [{ name: 'David', confidence: 77 }] }),
  };

  for (const [name, f] of Object.entries(fixtures)) {
    it(`${name}: label name matches what accept applies`, () => {
      const label = buildFaceLabel(f, 1, t);
      const { confirmations, ignores, skipped } = acceptAllState([f], '/p.jpg');

      if (confirmations.length > 0) {
        // Accept confirms a name -> that exact name must appear in the label.
        expect(label).toContain(confirmations[0].person_name);
        // And never a stale person_name the accept path ignores.
        if (f.person_name && f.person_name !== confirmations[0].person_name) {
          expect(label).not.toContain(f.person_name);
        }
      } else if (ignores.length > 0) {
        // Accept ignores -> the label must read as an ignore.
        expect(label).toContain('ign');
        expect(resolveSuggestion(f).isIgnore).toBe(true);
      } else {
        // Nothing to apply (skipped) -> label is the unknown fallback.
        expect(skipped).toBe(1);
        expect(label).toBe('1. imageViewer.unknown');
      }
    });
  }
});
