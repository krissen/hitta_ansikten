import { describe, it, expect } from 'vitest';
import {
  namesInBasename,
  removeNamesFromBasename,
  cleanName,
} from '../src/renderer/components/culling-names.js';

describe('namesInBasename', () => {
  it('returns the single name when there is no comma', () => {
    expect(namesInBasename('260626_191003_Anna.jpg')).toEqual(['Anna']);
  });

  it('splits multiple names joined by ,_', () => {
    expect(namesInBasename('260626_191003_Anna,_Bert,_Cecilia.jpg')).toEqual([
      'Anna', 'Bert', 'Cecilia',
    ]);
  });

  it('keeps the timestamp -N collision suffix out of the names', () => {
    expect(namesInBasename('260626_191003-2_Anna,_Bert.jpg')).toEqual(['Anna', 'Bert']);
  });

  it('strips a per-name -N disambiguation suffix', () => {
    expect(namesInBasename('260626_191003_Anna-2,_Bert.jpg')).toEqual(['Anna', 'Bert']);
  });

  it('de-duplicates names that clean to the same value', () => {
    expect(namesInBasename('260626_191003_Anna,_Anna-2.jpg')).toEqual(['Anna']);
  });

  it('returns [] for a name with no description part', () => {
    expect(namesInBasename('260626_191003.jpg')).toEqual([]);
  });

  it('returns [] for an unrecognised filename shape', () => {
    expect(namesInBasename('random.jpg')).toEqual([]);
  });
});

describe('removeNamesFromBasename', () => {
  it('drops one of several names and keeps the comma join', () => {
    expect(
      removeNamesFromBasename('260626_191003_Anna,_Bert,_Cecilia.jpg', new Set(['Bert']))
    ).toBe('260626_191003_Anna,_Cecilia.jpg');
  });

  it('drops the comma when one name remains', () => {
    expect(
      removeNamesFromBasename('260626_191003_Anna,_Bert.jpg', new Set(['Bert']))
    ).toBe('260626_191003_Anna.jpg');
  });

  it('leaves a bare timestamp when every name is removed', () => {
    expect(
      removeNamesFromBasename('260626_191003_Anna,_Bert.jpg', new Set(['Anna', 'Bert']))
    ).toBe('260626_191003.jpg');
  });

  it('preserves the timestamp -N collision suffix', () => {
    expect(
      removeNamesFromBasename('260626_191003-2_Anna,_Bert.jpg', new Set(['Bert']))
    ).toBe('260626_191003-2_Anna.jpg');
  });

  it('removes a per-name -N piece when its cleaned name is toggled off', () => {
    expect(
      removeNamesFromBasename('260626_191003_Anna,_Anna-2.jpg', new Set(['Anna']))
    ).toBe('260626_191003.jpg');
  });

  it('is a no-op when removing nothing', () => {
    expect(
      removeNamesFromBasename('260626_191003_Anna,_Bert.jpg', new Set())
    ).toBe('260626_191003_Anna,_Bert.jpg');
  });

  it('returns null for an unrecognised filename shape', () => {
    expect(removeNamesFromBasename('random.jpg', new Set(['Anna']))).toBeNull();
  });
});

describe('cleanName', () => {
  it('strips a trailing -N suffix', () => {
    expect(cleanName('Anna-2')).toBe('Anna');
    expect(cleanName('Anna')).toBe('Anna');
  });
});
