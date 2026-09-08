import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { Autocomplete } from '../../src/renderer/components/shared/Autocomplete.jsx';

// Direct component tests for the shared combobox primitive. The primitive is
// presentation-only: the harness below owns the display value + query and
// computes the (already ranked) option list, exactly as a real consumer does.
//
// jsdom has 0-sized rects so useDropdownPosition's flip geometry is untestable;
// these pin the interaction contract (keyboard, ARIA, selection) instead.

afterEach(cleanup);

const NAMES = ['Anna', 'Anders', 'Johanna', 'Hanna', 'Bertil'];

// Minimal consumer: query drives the (prefix) option list, value is the shown
// text. Mirrors FaceCard's split between the typed query and the display value.
function Harness({ onSelect, onInputChange, ...props }) {
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const options = query
    ? NAMES.filter((n) => n.toLowerCase().startsWith(query.toLowerCase()))
    : [];
  return (
    <Autocomplete
      value={value}
      options={options}
      onInputChange={(text) => {
        setValue(text);
        setQuery(text);
        onInputChange?.(text);
      }}
      onHighlight={(name) => setValue(name)}
      onSelect={(name) => {
        setValue(name);
        setQuery(name);
        onSelect?.(name);
      }}
      onEscape={() => setValue(query)}
      {...props}
    />
  );
}

function type(input, text) {
  act(() => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
  });
}

describe('Autocomplete — ARIA wiring', () => {
  it('exposes the combobox roles and closed state before typing', () => {
    const { container } = render(<Harness />);
    const input = container.querySelector('input');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('opens a listbox of options and links aria-controls to it', () => {
    const { container } = render(<Harness />);
    const input = container.querySelector('input');
    type(input, 'an');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(input.getAttribute('aria-controls')).toBe(
      listbox.getAttribute('id'),
    );
    const opts = [...document.querySelectorAll('[role="option"]')].map(
      (o) => o.textContent,
    );
    expect(opts).toEqual(['Anna', 'Anders']);
  });

  it('renders no listbox for an empty query', () => {
    const { container } = render(<Harness />);
    const input = container.querySelector('input');
    type(input, '');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Autocomplete — keyboard navigation', () => {
  it('ArrowDown moves the highlight and updates aria-activedescendant + aria-selected', () => {
    const { container } = render(<Harness />);
    const input = container.querySelector('input');
    type(input, 'an'); // Anna, Anders
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    act(() => fireEvent.keyDown(input, { key: 'ArrowDown' }));
    let active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    const first = document.getElementById(active);
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(first.classList.contains('selected')).toBe(true);
    expect(first.textContent).toBe('Anna');
    // Highlighting previews the option into the input.
    expect(input.value).toBe('Anna');

    act(() => fireEvent.keyDown(input, { key: 'ArrowDown' }));
    expect(
      document.getElementById(input.getAttribute('aria-activedescendant'))
        .textContent,
    ).toBe('Anders');
  });

  it('ArrowUp from no highlight wraps to the last option', () => {
    const { container } = render(<Harness />);
    const input = container.querySelector('input');
    type(input, 'an');
    act(() => fireEvent.keyDown(input, { key: 'ArrowUp' }));
    expect(
      document.getElementById(input.getAttribute('aria-activedescendant'))
        .textContent,
    ).toBe('Anders');
  });

  it('Enter selects the highlighted option when selectOnEnter is set', () => {
    const onSelect = vi.fn();
    const { container } = render(<Harness onSelect={onSelect} />);
    const input = container.querySelector('input');
    type(input, 'an');
    act(() => fireEvent.keyDown(input, { key: 'ArrowDown' }));
    act(() => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(onSelect).toHaveBeenCalledWith('Anna');
    // List closes after selection.
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('a free-text value survives when no option is highlighted (Enter does not force a pick)', () => {
    const onSelect = vi.fn();
    const { container } = render(<Harness onSelect={onSelect} />);
    const input = container.querySelector('input');
    type(input, 'Zelda'); // no option matches
    act(() => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(input.value).toBe('Zelda');
  });

  it('clicking an option selects it (free-text vs option choice)', () => {
    const onSelect = vi.fn();
    const { container } = render(<Harness onSelect={onSelect} />);
    const input = container.querySelector('input');
    type(input, 'ha'); // Hanna
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (o) => o.textContent === 'Hanna',
    );
    act(() => fireEvent.mouseDown(option));
    expect(onSelect).toHaveBeenCalledWith('Hanna');
    expect(input.value).toBe('Hanna');
  });
});

describe('Autocomplete — Escape', () => {
  it('closes the list and does not leak to document-level handlers', () => {
    const docHandler = vi.fn();
    document.addEventListener('keydown', docHandler);
    try {
      const { container } = render(<Harness />);
      const input = container.querySelector('input');
      type(input, 'an');
      expect(document.querySelector('[role="listbox"]')).toBeTruthy();
      act(() => fireEvent.keyDown(input, { key: 'Escape' }));
      expect(document.querySelector('[role="listbox"]')).toBeNull();
      // stopPropagation() must keep Escape from reaching the document listener
      // (the review flow relies on this so Esc-in-input never discards changes).
      expect(docHandler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', docHandler);
    }
  });
});

describe('Autocomplete — passthrough contract (review flow)', () => {
  it('with selectOnEnter=false, Enter reaches a document handler unconsumed', () => {
    const docHandler = vi.fn();
    document.addEventListener('keydown', docHandler);
    try {
      const onSelect = vi.fn();
      const { container } = render(
        <Harness onSelect={onSelect} selectOnEnter={false} navigateWithTab />,
      );
      const input = container.querySelector('input');
      type(input, 'an');
      act(() => fireEvent.keyDown(input, { key: 'ArrowDown' }));
      act(() => fireEvent.keyDown(input, { key: 'Enter' }));
      // The primitive did NOT swallow Enter; a parent/document handler owns it.
      expect(onSelect).not.toHaveBeenCalled();
      expect(docHandler).toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', docHandler);
    }
  });

  it('navigateWithTab moves the highlight instead of leaving the field', () => {
    const { container } = render(<Harness navigateWithTab />);
    const input = container.querySelector('input');
    type(input, 'an');
    act(() => fireEvent.keyDown(input, { key: 'Tab' }));
    expect(
      document.getElementById(input.getAttribute('aria-activedescendant'))
        .textContent,
    ).toBe('Anna');
  });
});

describe('Autocomplete — maxSuggestions', () => {
  it('caps the number of rendered options', () => {
    function ManyHarness() {
      const options = ['Anna', 'Anders', 'Andreas', 'Andrea', 'Andy'];
      return (
        <Autocomplete
          value="an"
          options={options}
          maxSuggestions={3}
          onInputChange={() => {}}
        />
      );
    }
    const { container } = render(<ManyHarness />);
    const input = container.querySelector('input');
    act(() => fireEvent.focus(input));
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
  });
});
