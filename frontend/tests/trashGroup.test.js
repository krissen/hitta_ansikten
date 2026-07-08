import { describe, it, expect } from 'vitest';
import { trashGroup } from '../src/renderer/components/trashGroup.js';

describe('trashGroup', () => {
  it('classifies JPEG basenames', () => {
    expect(trashGroup('260626_191003_Milian.jpg')).toBe('jpg');
    expect(trashGroup('photo.JPEG')).toBe('jpg');
  });

  it('classifies raw basenames as nef', () => {
    expect(trashGroup('250601_120000.nef')).toBe('nef');
    expect(trashGroup('shot.CR2')).toBe('nef');
    expect(trashGroup('shot.arw')).toBe('nef');
  });

  it('classifies other image types as other', () => {
    expect(trashGroup('scan.png')).toBe('other');
    expect(trashGroup('scan.tiff')).toBe('other');
  });

  it('treats an extensionless or dotfile name as other', () => {
    expect(trashGroup('README')).toBe('other');
    expect(trashGroup('.hidden')).toBe('other');
  });
});
