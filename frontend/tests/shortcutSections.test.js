import { describe, it, expect } from 'vitest';

import { SHORTCUT_SECTIONS } from '../src/renderer/workspace/flexlayout/shortcutSections.js';

/**
 * Characterization test for the shortcuts-help catalog.
 *
 * Locks the exact rendered value of SHORTCUT_SECTIONS — section order and ids,
 * titles, module highlighting, row order, keys, separators and the resolved
 * Swedish descriptions. The help overlay is display-only, so a silent change to
 * this data degrades unnoticed; this test is the guard, and it stays unchanged
 * across refactors of how the value is produced.
 */
const EXPECTED = [
  {
    id: 'navigation',
    title: 'Navigering',
    modules: [],
    shortcuts: [
      { keys: ['Cmd', '←→↑↓'], desc: 'Flytta fokus mellan paneler' },
      { keys: ['↑', '↓'], desc: 'Föregående/nästa objekt', sep: '/' },
      { keys: ['Tab'], desc: 'Komplettera namn (i inmatningsfält)' },
    ],
  },
  {
    id: 'layout',
    title: 'Layout',
    modules: [],
    shortcuts: [
      { keys: ['Cmd', '1-5'], desc: 'Byt arbetsflödessteg (Importera→Gallra)' },
      { keys: ['Cmd', 'Shift', ']'], desc: 'Lägg till kolumn' },
      { keys: ['Cmd', 'Shift', '['], desc: 'Ta bort kolumn' },
      { keys: ['Cmd', 'Shift', '}'], desc: 'Lägg till rad' },
      { keys: ['Cmd', 'Shift', '{'], desc: 'Ta bort rad' },
    ],
  },
  {
    id: 'image-viewer',
    title: 'Bildvisare',
    modules: ['image-viewer', 'original-view'],
    shortcuts: [
      { keys: ['+', '-'], desc: 'Zooma in/ut (håll för kontinuerlig)', sep: ' / ' },
      { keys: ['='], desc: 'Återställ till 1:1' },
      { keys: ['0'], desc: 'Anpassa till fönster' },
      { keys: ['B'], desc: 'Visa/dölj markeringsramar' },
      { keys: ['b'], desc: 'Växla enstaka/alla ramar' },
      { keys: ['c', 'C'], desc: 'Växla autocentrering på ansikte', sep: ' / ' },
    ],
  },
  {
    id: 'face-review',
    title: 'Granska ansikten',
    modules: ['review-module'],
    shortcuts: [
      { keys: ['Enter', 'A'], desc: 'Acceptera föreslagen matchning', sep: ' / ' },
      { keys: ['I'], desc: 'Ignorera ansikte' },
      { keys: ['R'], desc: 'Byt namn / ange namn' },
      { keys: ['1-N'], desc: 'Välj matchningsalternativ' },
      { keys: ['↑', '↓'], desc: 'Föregående/nästa ansikte', sep: ' / ' },
      { keys: ['X'], desc: 'Hoppa till nästa fil' },
      { keys: ['Alt', 'Enter'], desc: 'Lägg till filnamnstillägg (ej namn)' },
      { keys: ['Shift', 'Cmd', 'A'], desc: 'Acceptera alla förslag' },
      { keys: ['Cmd', 'Z'], desc: 'Ångra senaste ansiktsåtgärd' },
      { keys: ['Cmd', '⌫'], desc: 'Flytta aktuell fil till papperskorgen' },
      { keys: ['Cmd', 'Shift', '⌫'], desc: 'Ångra radering' },
      { keys: ['Esc'], desc: 'Avbryt ansiktssökning / kasta ändringar' },
    ],
  },
  {
    id: 'file-queue',
    title: 'Filkö',
    modules: ['file-queue'],
    shortcuts: [
      { keys: ['Cmd', 'O'], desc: 'Öppna filer' },
      { keys: ['↑', '↓'], desc: 'Navigera i kön', sep: ' / ' },
      { keys: ['Enter'], desc: 'Läs in markerad fil' },
      { keys: ['Delete'], desc: 'Ta bort från kön' },
      { keys: ['Cmd', 'A'], desc: 'Markera alla filer' },
    ],
  },
  {
    id: 'culling',
    title: 'Gallra spelare',
    modules: ['culling'],
    shortcuts: [
      { keys: ['→', '↓'], desc: 'Nästa bild', sep: ' / ' },
      { keys: ['←', '↑'], desc: 'Föregående bild', sep: ' / ' },
      { keys: ['Alt', '←→↑↓'], desc: 'Sidhoppa (10 steg)' },
      { keys: ['+', '-'], desc: 'Zooma in/ut (enkelbild)', sep: ' / ' },
      { keys: ['='], desc: 'Återställ till 1:1 (enkelbild)' },
      { keys: ['0'], desc: 'Anpassa till fönster (enkelbild)' },
      { keys: ['X', 'Delete', 'Cmd+⌫'], desc: 'Gallra till papperskorgen', sep: ' / ' },
      { keys: ['Enter'], desc: 'Byt namn på fil (dubbelklick)' },
      { keys: ['Cmd', 'Enter'], desc: 'Tillämpa namnborttagningar från förhandsgranskningen' },
      { keys: ['Cmd', 'Z'], desc: 'Ångra senaste gallring' },
      { keys: ['L'], desc: 'Öppna original-NEF i Lightroom' },
    ],
  },
  {
    id: 'general',
    title: 'Allmänt',
    modules: [],
    shortcuts: [
      { keys: ['?'], desc: 'Visa den här hjälpen' },
      { keys: ['Cmd', 'R'], desc: 'Ladda om fönstret' },
      { keys: ['Cmd', ','], desc: 'Inställningar' },
    ],
  },
];

describe('SHORTCUT_SECTIONS (characterization)', () => {
  it('renders the exact section/row structure the help overlay shows', () => {
    expect(SHORTCUT_SECTIONS).toEqual(EXPECTED);
  });

  it('keeps section ids and order stable', () => {
    expect(SHORTCUT_SECTIONS.map((s) => s.id)).toEqual([
      'navigation',
      'layout',
      'image-viewer',
      'face-review',
      'file-queue',
      'culling',
      'general',
    ]);
  });

  it('omits `sep` on rows the overlay renders with the default "+" joiner', () => {
    // ShortcutRow defaults sep to '+'. A row that gained an explicit sep would
    // silently change how its keys read, so the absence is part of the contract.
    for (const [i, section] of SHORTCUT_SECTIONS.entries()) {
      for (const [j, row] of section.shortcuts.entries()) {
        expect('sep' in row).toBe('sep' in EXPECTED[i].shortcuts[j]);
      }
    }
  });

  it('gives every row a non-empty description and at least one key', () => {
    // Descriptions come from the i18n catalog, which returns the key itself on a
    // miss — a dotted "shortcuts.desc.*" desc means a broken key, not a label.
    for (const section of SHORTCUT_SECTIONS) {
      for (const row of section.shortcuts) {
        expect(row.desc).toBeTruthy();
        expect(row.desc).not.toMatch(/^shortcuts\./);
        expect(row.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps descriptions unique within a section (the overlay keys rows by desc)', () => {
    for (const section of SHORTCUT_SECTIONS) {
      const descs = section.shortcuts.map((r) => r.desc);
      expect(new Set(descs).size).toBe(descs.length);
    }
  });

  it('references only real module ids in the highlight lists', () => {
    const highlighted = SHORTCUT_SECTIONS.flatMap((s) => s.modules);
    expect(highlighted).toEqual([
      'image-viewer',
      'original-view',
      'review-module',
      'file-queue',
      'culling',
    ]);
  });
});
