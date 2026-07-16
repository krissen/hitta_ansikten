import { describe, it, expect } from 'vitest';
import {
  getTopMatch,
  resolveSuggestion,
  willAllBeDone,
  nextFaceIndex,
  confirmFaceState,
  ignoreFaceState,
  unconfirmFaceState,
  undoFaceState,
  acceptAllState,
  upsertConfirmation,
  appendIgnore,
  mergeConfirmations,
  mergeIgnores,
  buildReviewedFaces,
} from '../src/renderer/components/review/reviewActions.js';

// Unit tests for the pure face state transitions extracted in H4. These pin
// the per-field shape of the pending-change entries — exactly what the
// batch-confirm payload is built from (saveAllChanges posts
// { confirmations: pendingConfirmations, ignores: pendingIgnores } verbatim),
// closing the H3 gap that the payload was only checked shallowly.

const face = (overrides = {}) => ({
  face_id: 'f1',
  person_name: '',
  is_confirmed: false,
  match_alternatives: [],
  ...overrides,
});

describe('resolveSuggestion', () => {
  it('returns null when there is no top alternative', () => {
    expect(resolveSuggestion(face())).toBeNull();          // empty alternatives
    expect(resolveSuggestion(face({ match_alternatives: undefined }))).toBeNull();
    expect(resolveSuggestion(null)).toBeNull();
    expect(resolveSuggestion(undefined)).toBeNull();
  });

  it('resolves the normal (name) case from the first alternative', () => {
    const f = face({ match_alternatives: [{ name: 'Anna', confidence: 82 }] });
    expect(resolveSuggestion(f)).toEqual({ name: 'Anna', confidence: 82, isIgnore: false });
  });

  it('flags isIgnore when the top alternative is is_ignored', () => {
    const f = face({ match_alternatives: [{ name: 'Skomakare', confidence: 60, is_ignored: true }] });
    expect(resolveSuggestion(f)).toEqual({ name: 'Skomakare', confidence: 60, isIgnore: true });
  });

  it("flags isIgnore when the top alternative name is the 'ign' sentinel", () => {
    const f = face({ match_alternatives: [{ name: 'ign', confidence: 70 }] });
    expect(resolveSuggestion(f)).toEqual({ name: 'ign', confidence: 70, isIgnore: true });
  });

  it('only ever considers the FIRST alternative', () => {
    const f = face({
      match_alternatives: [
        { name: 'Anna', confidence: 60 },
        { name: 'Berit', confidence: 95, is_ignored: true },
      ],
    });
    expect(resolveSuggestion(f)).toEqual({ name: 'Anna', confidence: 60, isIgnore: false });
  });
});

describe('getTopMatch', () => {
  it('returns the top alternative at or above the 75% threshold', () => {
    const f = face({ match_alternatives: [{ name: 'Anna', confidence: 75, is_ignored: false }] });
    expect(getTopMatch(f)).toEqual({ name: 'Anna', confidence: 75 });
  });

  it('returns null below the threshold, for ignore-suggestions, and without alternatives', () => {
    expect(getTopMatch(face({ match_alternatives: [{ name: 'Anna', confidence: 74 }] }))).toBeNull();
    expect(getTopMatch(face({ match_alternatives: [{ name: 'ign', confidence: 90, is_ignored: true }] }))).toBeNull();
    expect(getTopMatch(face())).toBeNull();
    expect(getTopMatch(null)).toBeNull();
  });

  it('only ever considers the FIRST alternative', () => {
    const f = face({
      match_alternatives: [
        { name: 'Anna', confidence: 60 },
        { name: 'Berit', confidence: 95 },
      ],
    });
    expect(getTopMatch(f)).toBeNull();
  });
});

describe('confirmFaceState — batch-confirm confirmation entry (per-field)', () => {
  it('builds the exact confirmation payload fields', () => {
    const faces = [face({ face_id: 'abc', person_name: 'Suggested' })];
    const { confirmation } = confirmFaceState(faces, 0, '  Chosen Name  ', '/photos/a.jpg');
    expect(confirmation).toEqual({
      face_id: 'abc',
      person_name: 'Chosen Name',          // trimmed
      image_path: '/photos/a.jpg',
      suggested_name: 'Suggested',          // differs from chosen -> recorded
    });
  });

  it('suggested_name is null when the user confirms the suggestion as-is', () => {
    const faces = [face({ person_name: 'Anna' })];
    const { confirmation } = confirmFaceState(faces, 0, 'Anna', '/p.jpg');
    expect(confirmation.suggested_name).toBeNull();
  });

  it('marks the face confirmed with the trimmed name and snapshots an undo entry', () => {
    const faces = [face({ face_id: 'abc' }), face({ face_id: 'def' })];
    const result = confirmFaceState(faces, 0, ' Anna ', '/p.jpg');
    expect(result.faces[0]).toMatchObject({ is_confirmed: true, person_name: 'Anna' });
    expect(result.faces[1]).toBe(faces[1]); // untouched entries keep identity
    expect(result.undoEntry).toEqual({ type: 'confirm', index: 0, face: faces[0] });
    expect(result.undoEntry.face).not.toBe(faces[0]); // snapshot copy
  });

  it('is a no-op (null) for missing or already-confirmed faces', () => {
    expect(confirmFaceState([], 0, 'Anna', '/p.jpg')).toBeNull();
    expect(confirmFaceState([face({ is_confirmed: true })], 0, 'Anna', '/p.jpg')).toBeNull();
  });
});

describe('ignoreFaceState — batch-confirm ignore entry (per-field)', () => {
  it('builds the exact ignore payload and rejects the face', () => {
    const faces = [face({ face_id: 'abc' })];
    const result = ignoreFaceState(faces, 0, '/photos/a.jpg');
    expect(result.ignore).toEqual({ face_id: 'abc', image_path: '/photos/a.jpg' });
    expect(result.faces[0]).toMatchObject({
      is_confirmed: true,
      is_rejected: true,
      person_name: '(ignored)',
    });
    expect(result.undoEntry.type).toBe('ignore');
  });

  it('is a no-op (null) for already-confirmed faces', () => {
    expect(ignoreFaceState([face({ is_confirmed: true })], 0, '/p.jpg')).toBeNull();
  });
});

describe('unconfirmFaceState / undoFaceState', () => {
  it('unconfirm reverts flags and restores the original person_name', () => {
    const faces = [face({
      is_confirmed: true,
      is_rejected: true,
      person_name: '(ignored)',
      _original_person_name: 'Anna',
    })];
    const result = unconfirmFaceState(faces, 0);
    expect(result.faces[0]).toMatchObject({
      is_confirmed: false,
      is_rejected: false,
      person_name: 'Anna',
    });
    expect(result.faceId).toBe('f1');
    expect(unconfirmFaceState([face()], 0)).toBeNull(); // not confirmed -> no-op
  });

  it('undo restores the snapshotted face at its index', () => {
    const original = face({ face_id: 'x' });
    const faces = [face({ face_id: 'x', is_confirmed: true, person_name: 'Anna' })];
    const restored = undoFaceState(faces, { type: 'confirm', index: 0, face: original });
    expect(restored[0]).toEqual(original);
    expect(restored[0]).not.toBe(original); // fresh copy
  });
});

describe('nextFaceIndex / willAllBeDone', () => {
  const c = () => face({ is_confirmed: true });

  it('advances with wrap-around and skips confirmed faces and skipIndex', () => {
    const faces = [face(), c(), face()];
    expect(nextFaceIndex(faces, 0, 1)).toBe(2);       // skips confirmed index 1
    expect(nextFaceIndex(faces, 2, 1)).toBe(0);       // wraps
    expect(nextFaceIndex(faces, 2, -1)).toBe(0);      // backwards skips confirmed
    expect(nextFaceIndex([face(), face(), face()], 0, 1, 1)).toBe(2); // explicit skip
  });

  it('willAllBeDone treats the acted-on index as done', () => {
    expect(willAllBeDone([face(), c()], 0)).toBe(true);
    expect(willAllBeDone([face(), face()], 0)).toBe(false);
    expect(willAllBeDone([face({ is_rejected: true }), face()], 1)).toBe(true);
  });
});

describe('acceptAllState', () => {
  it('confirms named suggestions, ignores ign-suggestions, skips faces without alternatives', () => {
    const faces = [
      face({ face_id: 'a', match_alternatives: [{ name: ' Anna ', confidence: 80 }] }),
      face({ face_id: 'b', match_alternatives: [{ name: 'ign', confidence: 70, is_ignored: true }] }),
      face({ face_id: 'c' }), // no alternatives
      face({ face_id: 'd', is_confirmed: true, person_name: 'Done' }),
    ];
    const result = acceptAllState(faces, '/p.jpg');
    expect(result.accepted).toBe(1);
    expect(result.ignored).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.confirmations).toEqual([{
      face_id: 'a',
      person_name: 'Anna',
      image_path: '/p.jpg',
      suggested_name: null,
    }]);
    expect(result.ignores).toEqual([{ face_id: 'b', image_path: '/p.jpg' }]);
    expect(result.faces[0]).toMatchObject({ is_confirmed: true, is_rejected: false, person_name: 'Anna' });
    expect(result.faces[1]).toMatchObject({ is_rejected: true, person_name: '(ignored)' });
    expect(result.faces[2]).toBe(faces[2]); // skipped keeps identity
    expect(result.faces[3]).toBe(faces[3]); // already confirmed untouched
  });

  it('records suggested_name only when it differs case-insensitively from the accepted name', () => {
    const faces = [
      face({ face_id: 'a', person_name: 'anna', match_alternatives: [{ name: 'Anna', confidence: 80 }] }),
      face({ face_id: 'b', person_name: 'Berit', match_alternatives: [{ name: 'Anna', confidence: 80 }] }),
    ];
    const { confirmations } = acceptAllState(faces, '/p.jpg');
    expect(confirmations[0].suggested_name).toBeNull();       // same name, case diff only
    expect(confirmations[1].suggested_name).toBe('Berit');    // real correction
  });
});

describe('pending-list helpers', () => {
  it('upsertConfirmation updates person_name in place, keyed by face_id', () => {
    const prev = [{ face_id: 'a', person_name: 'Old', suggested_name: 'S' }];
    const next = upsertConfirmation(prev, { face_id: 'a', person_name: 'New', suggested_name: null });
    expect(next).toEqual([{ face_id: 'a', person_name: 'New', suggested_name: 'S' }]);
    expect(upsertConfirmation([], { face_id: 'b', person_name: 'X' })).toHaveLength(1);
  });

  it('mergeConfirmations also replaces suggested_name (accept-all semantics)', () => {
    const prev = [{ face_id: 'a', person_name: 'Old', suggested_name: 'S' }];
    const next = mergeConfirmations(prev, [{ face_id: 'a', person_name: 'New', suggested_name: null }]);
    expect(next).toEqual([{ face_id: 'a', person_name: 'New', suggested_name: null }]);
    expect(mergeConfirmations(prev, [])).toBe(prev); // no batch -> same reference
  });

  it('appendIgnore and mergeIgnores skip duplicates by face_id', () => {
    const prev = [{ face_id: 'a', image_path: '/p.jpg' }];
    expect(appendIgnore(prev, { face_id: 'a', image_path: '/p.jpg' })).toBe(prev);
    expect(appendIgnore(prev, { face_id: 'b', image_path: '/p.jpg' })).toHaveLength(2);
    expect(mergeIgnores(prev, [{ face_id: 'a' }, { face_id: 'b' }])).toHaveLength(2);
  });
});

describe('buildReviewedFaces', () => {
  it('maps names for confirmed faces, null for ignored/unreviewed, and keeps encoding hashes', () => {
    const faces = [
      face({ face_id: 'a', encoding_hash: 'h1', is_confirmed: true, person_name: 'Anna' }),
      face({ face_id: 'b', encoding_hash: 'h2', is_confirmed: true, is_rejected: true, person_name: '(ignored)' }),
      face({ face_id: 'c', encoding_hash: 'h3' }),
    ];
    expect(buildReviewedFaces(faces)).toEqual([
      { faceIndex: 0, faceId: 'a', encodingHash: 'h1', personName: 'Anna', isIgnored: false },
      { faceIndex: 1, faceId: 'b', encodingHash: 'h2', personName: null, isIgnored: true },
      { faceIndex: 2, faceId: 'c', encodingHash: 'h3', personName: null, isIgnored: false },
    ]);
  });
});
