import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  buildCountParams,
  DEFAULT_OPTIONS,
} from '../src/renderer/components/PlayerCountModule.jsx';
import { ContextMenu } from '../src/renderer/components/shared/ContextMenu.jsx';
import {
  contextMenuItemsFor,
  movePlayerSession,
  removePlayerSession,
  clearPlayerSession,
  getPlayerSession,
  playerSessionParams,
} from '../src/renderer/shared/playerSession.js';

const INPUT = {
  roots: ['/photos'],
  glob: '',
  preset: 'jpg',
  dateFrom: '',
  dateTo: '',
  recursive: true,
};

describe('buildCountParams (session pin extensions)', () => {
  it('sends null pins without a session', () => {
    const params = buildCountParams(INPUT, DEFAULT_OPTIONS, false, null);
    expect(params.spelare).toBeNull();
    expect(params.session_tranare).toBeNull();
    expect(params.session_publik).toBeNull();
    expect(params.session_grupp).toBeNull();
  });

  it('sends the session pins when provided', () => {
    const params = buildCountParams(INPUT, DEFAULT_OPTIONS, false, null, {
      spelare: ['Oscar'],
      session_tranare: null,
      session_publik: ['Farbror'],
      session_grupp: null,
    });
    expect(params.spelare).toEqual(['Oscar']);
    expect(params.session_publik).toEqual(['Farbror']);
    expect(params.session_tranare).toBeNull();
    expect(params.session_grupp).toBeNull();
  });
});

describe('playerSession store', () => {
  it('pins a name to one bucket at a time and undoes moves', () => {
    clearPlayerSession();
    movePlayerSession('Oscar', 'spelare');
    movePlayerSession('Anna', 'publik');
    expect(getPlayerSession().spelare).toEqual(['Oscar']);
    expect(getPlayerSession().publik).toEqual(['Anna']);

    movePlayerSession('Oscar', 'grupp'); // re-pin moves, never duplicates
    expect(getPlayerSession().spelare).toEqual([]);
    expect(getPlayerSession().grupp).toEqual(['Oscar']);

    removePlayerSession('Oscar');
    expect(getPlayerSession().grupp).toEqual([]);
    clearPlayerSession();
  });

  it('maps to /players/count request fields (null when empty)', () => {
    clearPlayerSession();
    expect(playerSessionParams()).toEqual({
      spelare: null,
      session_tranare: null,
      session_publik: null,
      session_grupp: null,
    });
    movePlayerSession('Oscar', 'spelare');
    movePlayerSession('Coach', 'tranare');
    expect(playerSessionParams()).toEqual({
      spelare: ['Oscar'],
      session_tranare: ['Coach'],
      session_publik: null,
      session_grupp: null,
    });
    clearPlayerSession();
  });
});

describe('contextMenuItemsFor', () => {
  it('offers session moves + permanent publik on player rows', () => {
    expect(contextMenuItemsFor('players')).toEqual([
      'toPublikSession', 'toTranareSession', 'toGruppSession', 'sep', 'publikPermanent',
    ]);
  });

  it('offers the player pin on below-threshold rows (bypasses min_images)', () => {
    expect(contextMenuItemsFor('below_threshold')).toEqual([
      'toPlayerSession', 'toPublikSession', 'toTranareSession', 'toGruppSession', 'sep', 'publikPermanent',
    ]);
  });

  it('offers back-to-player + other buckets on excluded names', () => {
    expect(contextMenuItemsFor('publik')).toEqual([
      'toPlayerSession', 'toTranareSession', 'toGruppSession', 'sep', 'publikPermanent',
    ]);
    expect(contextMenuItemsFor('tranare')).toEqual([
      'toPlayerSession', 'toPublikSession', 'toGruppSession',
    ]);
    expect(contextMenuItemsFor('grupp')).toEqual([
      'toPlayerSession', 'toPublikSession', 'toTranareSession',
    ]);
  });

  it('returns no items for unknown buckets', () => {
    expect(contextMenuItemsFor('nope')).toEqual([]);
  });
});

describe('ContextMenu (shared)', () => {
  const items = [
    { key: 'a', label: 'Action A', onClick: vi.fn() },
    { key: 'sep-1', separator: true },
    { key: 'b', label: 'Action B', onClick: vi.fn() },
  ];

  it('renders nothing when menu is null', () => {
    const { container } = render(<ContextMenu menu={null} items={items} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders items at the cursor position', () => {
    const { container } = render(
      <ContextMenu menu={{ x: 12, y: 34 }} items={items} onClose={() => {}} />
    );
    const ul = container.querySelector('.ctx-menu');
    expect(ul.style.left).toBe('12px');
    expect(ul.style.top).toBe('34px');
    expect(screen.getByText('Action A')).toBeTruthy();
    expect(container.querySelector('.ctx-menu-sep')).toBeTruthy();
  });

  it('closes and forwards the menu payload on item click', () => {
    const onClose = vi.fn();
    const menu = { x: 0, y: 0, name: 'Oscar', bucket: 'publik' };
    render(<ContextMenu menu={menu} items={items} onClose={onClose} />);
    fireEvent.click(screen.getByText('Action B'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(items[2].onClick).toHaveBeenCalledWith(menu);
  });
});
