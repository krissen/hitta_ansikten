import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../src/main/cli-args.js';

// argv as the app actually receives it: a leading executable path is present and
// must be skipped. We prefix a realistic packaged-app path in most cases.
const APP = '/Applications/Ansikten.app/Contents/MacOS/Ansikten';

describe('parseCliArgs', () => {
  describe('legacy / no verb (Finder "open with", bare flags)', () => {
    it('single file, no flags → direct open (queuePosition null, no verb)', () => {
      const r = parseCliArgs([APP, '/photos/a.NEF']);
      expect(r.verb).toBe(null);
      expect(r.files).toEqual(['/photos/a.NEF']);
      expect(r.queuePosition).toBe(null);
      expect(r.startQueue).toBe(false);
      expect(r.clear).toBe(false);
    });

    it('honours --queue/--start flags without a verb', () => {
      const r = parseCliArgs([
        APP,
        '--queue',
        '--start',
        '/photos/a.NEF',
        '/photos/b.NEF',
      ]);
      expect(r.verb).toBe(null);
      expect(r.queuePosition).toBe('end');
      expect(r.startQueue).toBe(true);
      expect(r.files).toEqual(['/photos/a.NEF', '/photos/b.NEF']);
    });

    it('-qs maps to queue-start', () => {
      expect(parseCliArgs([APP, '-qs', '/x.NEF']).queuePosition).toBe('start');
    });
  });

  describe('faces verb', () => {
    it('defaults to queue end + start', () => {
      const r = parseCliArgs([APP, 'faces', '/photos/a.NEF']);
      expect(r.verb).toBe('faces');
      expect(r.queuePosition).toBe('end');
      expect(r.startQueue).toBe(true);
      expect(r.files).toEqual(['/photos/a.NEF']);
    });

    it('--clear is captured and files preserved', () => {
      const r = parseCliArgs([APP, 'faces', '--clear', '/photos/a.NEF']);
      expect(r.verb).toBe('faces');
      expect(r.clear).toBe(true);
      expect(r.files).toEqual(['/photos/a.NEF']);
    });

    it('explicit -qs overrides the faces default position', () => {
      const r = parseCliArgs([APP, 'faces', '-qs', '/x.NEF']);
      expect(r.queuePosition).toBe('start');
      expect(r.startQueue).toBe(true);
    });

    it('bare --clear with no files (empty the queue)', () => {
      const r = parseCliArgs([APP, 'faces', '--clear']);
      expect(r.verb).toBe('faces');
      expect(r.clear).toBe(true);
      expect(r.files).toEqual([]);
    });
  });

  describe('culling verb', () => {
    it('routes to culling with folder args', () => {
      const r = parseCliArgs([
        APP,
        'culling',
        '/photos/match1',
        '/photos/match2',
      ]);
      expect(r.verb).toBe('culling');
      expect(r.files).toEqual(['/photos/match1', '/photos/match2']);
      expect(r.clear).toBe(false);
    });

    it('cull alias maps to culling', () => {
      expect(parseCliArgs([APP, 'cull', '/photos/match1']).verb).toBe(
        'culling',
      );
    });

    it('--clear with a folder (replace)', () => {
      const r = parseCliArgs([APP, 'culling', '--clear', '/photos/match1']);
      expect(r.verb).toBe('culling');
      expect(r.clear).toBe(true);
      expect(r.files).toEqual(['/photos/match1']);
    });

    it('-c alias and bare clear (empty)', () => {
      const r = parseCliArgs([APP, 'culling', '-c']);
      expect(r.verb).toBe('culling');
      expect(r.clear).toBe(true);
      expect(r.files).toEqual([]);
    });

    it('does NOT inherit faces queue/start defaults', () => {
      const r = parseCliArgs([APP, 'culling', '/photos/match1']);
      expect(r.queuePosition).toBe(null);
      expect(r.startQueue).toBe(false);
    });

    it('defaults to non-recursive', () => {
      expect(parseCliArgs([APP, 'culling', '/photos/match1']).recursive).toBe(
        false,
      );
    });

    it('--recursive / -r opts in', () => {
      expect(
        parseCliArgs([APP, 'culling', '--recursive', '/d']).recursive,
      ).toBe(true);
      expect(parseCliArgs([APP, 'culling', '-r', '/d']).recursive).toBe(true);
    });

    it('--recursive composes with --clear', () => {
      const r = parseCliArgs([APP, 'culling', '--clear', '-r', '/d']);
      expect(r.clear).toBe(true);
      expect(r.recursive).toBe(true);
      expect(r.files).toEqual(['/d']);
    });
  });

  describe('import verb', () => {
    it('routes to import with no destination (card autodetected)', () => {
      const r = parseCliArgs([APP, 'import']);
      expect(r.verb).toBe('import');
      expect(r.files).toEqual([]);
    });

    it('carries an optional destination folder as the single path arg', () => {
      const r = parseCliArgs([APP, 'import', '~/foto/2026']);
      expect(r.verb).toBe('import');
      expect(r.files).toEqual(['~/foto/2026']);
    });

    it('does NOT inherit faces queue/start defaults', () => {
      const r = parseCliArgs([APP, 'import', '~/foto/2026']);
      expect(r.queuePosition).toBe(null);
      expect(r.startQueue).toBe(false);
    });

    it('verb matching is case-insensitive', () => {
      expect(parseCliArgs([APP, 'Import', '~/foto']).verb).toBe('import');
    });

    it('a later import token is treated as a path, not the verb', () => {
      const r = parseCliArgs([APP, '/photos/a.NEF', 'import']);
      expect(r.verb).toBe(null);
      expect(r.files).toEqual(['/photos/a.NEF', 'import']);
    });
  });

  describe('verb detection edge cases', () => {
    it('a verb only counts as the first real token, not later', () => {
      // Here a path comes first, so a later "culling" is treated as a path.
      const r = parseCliArgs([APP, '/photos/a.NEF', 'culling']);
      expect(r.verb).toBe(null);
      expect(r.files).toEqual(['/photos/a.NEF', 'culling']);
    });

    it('skips executable / node / npx noise', () => {
      const r = parseCliArgs([
        'node',
        '/usr/local/bin/electron',
        '.',
        'culling',
        '/d',
      ]);
      expect(r.verb).toBe('culling');
      expect(r.files).toEqual(['/d']);
    });

    it('verb matching is case-insensitive', () => {
      expect(parseCliArgs([APP, 'Culling', '/d']).verb).toBe('culling');
    });
  });
});
