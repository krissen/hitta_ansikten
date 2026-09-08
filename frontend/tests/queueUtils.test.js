import { describe, it, expect } from 'vitest';
import { queueFolder } from '../src/renderer/components/fileQueue/queueUtils.js';

describe('queueFolder', () => {
  it('returns null for an empty or invalid queue', () => {
    expect(queueFolder([])).toBeNull();
    expect(queueFolder(null)).toBeNull();
    expect(queueFolder(undefined)).toBeNull();
  });

  it('returns the parent directory of the first file (POSIX)', () => {
    expect(queueFolder([{ filePath: '/events/cupen/img_1.jpg' }])).toBe(
      '/events/cupen',
    );
  });

  it('handles Windows backslash separators', () => {
    expect(queueFolder([{ filePath: 'C:\\events\\cupen\\img_1.jpg' }])).toBe(
      'C:/events/cupen',
    );
  });

  it('returns "/" for a file at the filesystem root', () => {
    expect(queueFolder([{ filePath: '/img.jpg' }])).toBe('/');
  });

  it('uses the first file even when later files sit elsewhere', () => {
    expect(
      queueFolder([{ filePath: '/a/one.jpg' }, { filePath: '/b/two.jpg' }]),
    ).toBe('/a');
  });
});
