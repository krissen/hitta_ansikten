import { describe, it, expect } from 'vitest';
import { deriveRawToken, basenameMatchesToken } from '../src/main/raw-match.js';

describe('deriveRawToken', () => {
  it('extracts YYMMDD_HHMMSS from a developed JPEG', () => {
    expect(deriveRawToken('260626_194742_ArvidJ.jpg')).toBe('260626_194742');
  });

  it('keeps the -N burst counter as part of the token', () => {
    expect(deriveRawToken('260627_173803-1.jpg')).toBe('260627_173803-1');
  });

  it('works on a NEF with a long name tail', () => {
    expect(deriveRawToken('260626_194742_MammaB,_Lillebror,_ArvidJ.NEF')).toBe('260626_194742');
  });

  it('returns null when there is no leading timestamp', () => {
    expect(deriveRawToken('IMG_1234.jpg')).toBeNull();
    expect(deriveRawToken('')).toBeNull();
    expect(deriveRawToken(null)).toBeNull();
  });
});

describe('basenameMatchesToken', () => {
  const token = '260626_194742';

  it('matches a NEF sharing the timestamp even when names differ', () => {
    expect(
      basenameMatchesToken('260626_194742_MammaB,_Lillebror,_ArvidJ.NEF', token),
    ).toBe(true);
  });

  it('is case-insensitive on the extension', () => {
    expect(basenameMatchesToken('260626_194742_x.nef', token)).toBe(true);
    expect(basenameMatchesToken('260626_194742_x.NEF', token)).toBe(true);
  });

  it('does not match a non-RAW sidecar or the JPEG itself', () => {
    expect(basenameMatchesToken('260626_194742_ArvidJ.jpg', token)).toBe(false);
    expect(basenameMatchesToken('260626_194742_ArvidJ.xmp', token)).toBe(false);
  });

  it('requires exact token equality: a plain JPEG must not match a burst NEF', () => {
    // JPEG 260627_173803 (no counter) must resolve to the no-counter NEF only.
    expect(basenameMatchesToken('260627_173803.NEF', '260627_173803')).toBe(true);
    expect(basenameMatchesToken('260627_173803-1.NEF', '260627_173803')).toBe(false);
    // ...and the -1 JPEG resolves to the -1 NEF only.
    expect(basenameMatchesToken('260627_173803-1.NEF', '260627_173803-1')).toBe(true);
    expect(basenameMatchesToken('260627_173803.NEF', '260627_173803-1')).toBe(false);
  });

  it('returns false for empty token', () => {
    expect(basenameMatchesToken('260626_194742_x.NEF', null)).toBe(false);
    expect(basenameMatchesToken('260626_194742_x.NEF', '')).toBe(false);
  });
});
