import { describe, it, expect, vi } from 'vitest';
import {
  WORKSPACE_PERMISSIONS,
  createPermissionDecider,
  applyPermissionPolicy,
} from '../src/main/permissions.js';

/** Minimal stand-in for an Electron session. */
function fakeSession() {
  const s = {
    requestHandler: null,
    checkHandler: null,
    setPermissionRequestHandler(fn) {
      s.requestHandler = fn;
    },
    setPermissionCheckHandler(fn) {
      s.checkHandler = fn;
    },
  };
  return s;
}

describe('permission policy — deny by default', () => {
  it('allows only allowlisted permissions', () => {
    const decide = createPermissionDecider({
      label: 'test',
      allowed: ['midi'],
      log: () => {},
    });

    expect(decide('midi')).toBe(true);
    expect(decide('media')).toBe(false);
    expect(decide('geolocation')).toBe(false);
    expect(decide('notifications')).toBe(false);
    expect(decide('openExternal')).toBe(false);
    expect(decide('unknown')).toBe(false);
  });

  it('allowlists midi and clipboard write for the workspace, nothing else', () => {
    expect([...WORKSPACE_PERMISSIONS]).toEqual(['midi', 'clipboard-sanitized-write']);
  });

  it('logs each denied request and names the permission and origin', () => {
    const log = vi.fn();
    const decide = createPermissionDecider({ label: 'workspace', allowed: [], log });

    decide('media', { origin: 'file://', path: 'request' });
    decide('media', { origin: 'file://', path: 'request' });

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toContain('media');
    expect(log.mock.calls[0][0]).toContain('file://');
    expect(log.mock.calls[0][0]).toContain('workspace');
  });

  it('logs a denied check only once per permission (checks can be polled)', () => {
    const log = vi.fn();
    const decide = createPermissionDecider({ label: 'workspace', allowed: [], log });

    expect(decide('geolocation', { path: 'check' })).toBe(false);
    expect(decide('geolocation', { path: 'check' })).toBe(false);
    expect(decide('notifications', { path: 'check' })).toBe(false);

    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('applyPermissionPolicy — both session handlers', () => {
  it('installs a request handler and a check handler that agree', () => {
    const s = fakeSession();
    applyPermissionPolicy(s, { label: 'workspace', allowed: ['midi'], log: () => {} });

    expect(typeof s.requestHandler).toBe('function');
    expect(typeof s.checkHandler).toBe('function');

    const callback = vi.fn();
    s.requestHandler({}, 'midi', callback, {});
    expect(callback).toHaveBeenCalledWith(true);
    expect(s.checkHandler({}, 'midi', 'file://')).toBe(true);

    callback.mockClear();
    s.requestHandler({}, 'geolocation', callback, {});
    expect(callback).toHaveBeenCalledWith(false);
    expect(s.checkHandler({}, 'geolocation', 'file://')).toBe(false);
  });

  it('survives a request without details and a webContents without getURL', () => {
    const s = fakeSession();
    applyPermissionPolicy(s, { label: 'workspace', allowed: [], log: () => {} });

    const callback = vi.fn();
    expect(() => s.requestHandler({}, 'media', callback)).not.toThrow();
    expect(callback).toHaveBeenCalledWith(false);
    expect(s.checkHandler(null, 'media', null)).toBe(false);
  });
});
