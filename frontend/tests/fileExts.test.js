import { describe, it, expect } from 'vitest';
import { RAW_EXTS, JPG_EXTS, extOf } from '../src/renderer/shared/fileExts.js';

describe('extOf', () => {
  it('extracts the extension including the leading dot', () => {
    expect(extOf('photo.jpg')).toBe('.jpg');
    expect(extOf('250601_120000.nef')).toBe('.nef');
  });

  it('returns empty string for a name with no extension', () => {
    expect(extOf('README')).toBe('');
  });

  it('treats a leading-dot dotfile as having no extension', () => {
    expect(extOf('.hidden')).toBe('');
    expect(extOf('.gitignore')).toBe('');
  });

  it('preserves the extension case verbatim (no lowercasing)', () => {
    expect(extOf('photo.JPG')).toBe('.JPG');
    expect(extOf('shot.CR2')).toBe('.CR2');
  });

  it('uses only the last dot when there are multiple', () => {
    expect(extOf('archive.tar.gz')).toBe('.gz');
    expect(extOf('260626_191003_Milian.v2.jpeg')).toBe('.jpeg');
  });

  it('returns the bare dot for a trailing-dot name', () => {
    expect(extOf('file.')).toBe('.');
  });
});

describe('extension sets', () => {
  it('RAW_EXTS covers the expected raw formats', () => {
    expect(RAW_EXTS).toContain('.nef');
    expect(RAW_EXTS).toContain('.cr2');
    expect(RAW_EXTS).toContain('.arw');
    expect(RAW_EXTS).toContain('.dng');
    expect(RAW_EXTS).not.toContain('.jpg');
  });

  it('JPG_EXTS covers jpg and jpeg only', () => {
    expect(JPG_EXTS).toEqual(['.jpg', '.jpeg']);
  });

  it('all listed extensions are lowercase with a leading dot', () => {
    for (const ext of [...RAW_EXTS, ...JPG_EXTS]) {
      expect(ext).toBe(ext.toLowerCase());
      expect(ext.startsWith('.')).toBe(true);
    }
  });
});
