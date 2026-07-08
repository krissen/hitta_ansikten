import { describe, it, expect } from 'vitest';
import { t, getLocale } from '../src/i18n/index.js';

describe('i18n t()', () => {
  it('defaults to the Swedish locale', () => {
    expect(getLocale()).toBe('sv');
  });

  it('looks up module titles by id', () => {
    expect(t('modules.review-module')).toBe('Granska ansikten');
    expect(t('modules.image-viewer')).toBe('Bildvisare');
    expect(t('modules.database-management')).toBe('Databashantering');
  });

  it('returns the key itself for a missing entry (so gaps are visible)', () => {
    expect(t('modules.does-not-exist')).toBe('modules.does-not-exist');
    expect(t('totally.missing')).toBe('totally.missing');
  });

  it('interpolates {vars} and leaves unknown placeholders intact', () => {
    expect(t('common.selectedCount', { count: 3 })).toBe('3 valda');
    // Missing variable → the placeholder stays visible rather than blanking.
    expect(t('common.selectedCount')).toBe('{count} valda');
  });

  it('returns the key for a namespace object (not a leaf string)', () => {
    expect(t('modules')).toBe('modules');
    expect(t('common')).toBe('common');
  });

  it('has the Swedish application-menu labels', () => {
    expect(t('menu.file.title')).toBe('Arkiv');
    expect(t('menu.view.title')).toBe('Visa');
    expect(t('menu.window.title')).toBe('Fönster');
    expect(t('menu.help.title')).toBe('Hjälp');
    expect(t('menu.file.openInLightroom')).toBe('Öppna i Lightroom');
    expect(t('menu.app.aboutDetail', { version: 'dev' })).toContain('Version: dev');
  });

  it('selects the plural form by count', () => {
    expect(t('common.selectedCount', { count: 1 })).toBe('1 vald');
    expect(t('common.selectedCount', { count: 0 })).toBe('0 valda');
    expect(t('common.selectedCount', { count: 5 })).toBe('5 valda');
  });
});
