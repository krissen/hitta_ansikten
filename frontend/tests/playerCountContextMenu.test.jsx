import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  buildCountParams,
  contextMenuItemsFor,
  DEFAULT_OPTIONS,
} from '../src/renderer/components/PlayerCountModule.jsx';
import { ContextMenu } from '../src/renderer/components/shared/ContextMenu.jsx';

const INPUT = {
  roots: ['/photos'],
  glob: '',
  preset: 'jpg',
  dateFrom: '',
  dateTo: '',
  recursive: true,
};

describe('buildCountParams (session override extensions)', () => {
  it('sends null grupp/spelare without an override', () => {
    const params = buildCountParams(INPUT, DEFAULT_OPTIONS, false, null);
    expect(params.grupp).toBeNull();
    expect(params.spelare).toBeNull();
  });

  it('sends null grupp/spelare for a tranare/publik-only override', () => {
    const params = buildCountParams(INPUT, DEFAULT_OPTIONS, false, {
      tranare: ['Coach'],
      publik: [],
    });
    expect(params.grupp).toBeNull();
    expect(params.spelare).toBeNull();
  });

  it('sends the grupp override and force-include list when provided', () => {
    const params = buildCountParams(INPUT, DEFAULT_OPTIONS, false, {
      tranare: null,
      publik: null,
      grupp: ['Laget'],
      spelare: ['Oscar'],
    });
    expect(params.grupp).toEqual(['Laget']);
    expect(params.spelare).toEqual(['Oscar']);
  });

  it('sends null spelare for an empty force-include list', () => {
    const params = buildCountParams(INPUT, DEFAULT_OPTIONS, false, {
      tranare: ['Coach'],
      publik: [],
      grupp: null,
      spelare: [],
    });
    expect(params.spelare).toBeNull();
  });
});

describe('contextMenuItemsFor', () => {
  it('offers session moves + permanent publik on player rows', () => {
    expect(contextMenuItemsFor('players')).toEqual([
      'toPublikSession', 'toTranareSession', 'toGruppSession', 'sep', 'publikPermanent',
    ]);
    expect(contextMenuItemsFor('below_threshold')).toEqual(contextMenuItemsFor('players'));
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
