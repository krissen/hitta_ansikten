import { describe, it, expect } from 'vitest';
import { toFileUrl, bustedFileUrl } from '../src/renderer/shared/fileUrl.js';

describe('toFileUrl', () => {
  it('URL-encodes spaces in a unix path', () => {
    expect(toFileUrl('/Users/x/My Pictures/a b.jpg'))
      .toBe('file:///Users/x/My%20Pictures/a%20b.jpg');
  });

  it('keeps commas and underscores as-is', () => {
    expect(toFileUrl('/Users/x/Pictures/260626_194742_Srirang,_Valter.jpg'))
      .toBe('file:///Users/x/Pictures/260626_194742_Srirang,_Valter.jpg');
  });

  it('passes through an existing file:// URL', () => {
    expect(toFileUrl('file:///already/encoded.jpg')).toBe('file:///already/encoded.jpg');
  });

  it('adds the extra slash for Windows drive paths', () => {
    expect(toFileUrl('C:/Photos/a.jpg')).toBe('file:///C:/Photos/a.jpg');
  });
});

describe('bustedFileUrl', () => {
  it('appends a ?v= fingerprint', () => {
    expect(bustedFileUrl('/p/a.jpg', '1700-2048'))
      .toBe('file:///p/a.jpg?v=1700-2048');
  });

  it('changes when the fingerprint changes (forces a reload)', () => {
    const a = bustedFileUrl('/p/a.jpg', '1700-2048');
    const b = bustedFileUrl('/p/a.jpg', '1800-4096');
    expect(a).not.toBe(b);
  });

  it('returns the plain URL when no fingerprint is given', () => {
    expect(bustedFileUrl('/p/a.jpg')).toBe('file:///p/a.jpg');
    expect(bustedFileUrl('/p/a.jpg', '')).toBe('file:///p/a.jpg');
  });

  it('uses & when the base already has a query', () => {
    expect(bustedFileUrl('file:///p/a.jpg?x=1', '9'))
      .toBe('file:///p/a.jpg?x=1&v=9');
  });
});
