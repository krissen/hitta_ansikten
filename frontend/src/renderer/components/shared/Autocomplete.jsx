/**
 * Autocomplete — shared combobox primitive.
 *
 * A presentation-only combobox: the consumer computes and ranks `options`
 * (from whatever query state it keeps) and owns the displayed `value`. The
 * primitive owns the interaction shell — open/close, the highlighted-option
 * cursor, keyboard routing, the portalled dropdown and its positioning, and the
 * full combobox ARIA wiring (input `role="combobox"` +
 * `aria-expanded`/`aria-controls`/`aria-activedescendant`/`aria-autocomplete`;
 * list `role="listbox"`; items `role="option"` + `aria-selected`).
 *
 * DOM focus never leaves the `<input>`: the "cursor" moves via
 * `aria-activedescendant` (the house listbox pattern — see
 * docs/dev/accessibility.md §1). Highlighting an option calls `onHighlight`;
 * the consumer decides whether to preview it into the input.
 *
 * Keyboard:
 *  - ArrowDown / ArrowUp move the highlight (wrapping) and call `onHighlight`.
 *  - Tab / Shift+Tab move the highlight too when `navigateWithTab` is set
 *    (otherwise they fall through so focus can leave normally).
 *  - Enter selects the highlighted option when `selectOnEnter` is set; when it
 *    is not, Enter is left entirely alone so a document-level handler can act
 *    on the input value (this is the review flow's contract).
 *  - Escape closes the list, calls `onEscape`, blurs the input and stops
 *    propagation so it does not leak to app-level Escape handlers.
 *  - Any other key is forwarded to `onKeyDown` untouched.
 *
 * Styling lives in shared.css (`.autocomplete-wrapper` / `.autocomplete-dropdown`
 * / `.autocomplete-item`), so every consumer renders the same dropdown.
 */

import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDropdownPosition } from '../../hooks/useDropdownPosition.js';
import './shared.css';

let uid = 0;

/**
 * @param {object} props
 * @param {string} props.value - Controlled display value of the input.
 * @param {Array} [props.options=[]] - Ranked option list (consumer computes it).
 * @param {(option: any) => string} [props.getOptionLabel] - Option → visible label (default String()).
 * @param {(option: any, index: number) => (string|number)} [props.getOptionKey] - Option → React key (default label).
 * @param {(text: string) => void} [props.onInputChange] - User typed into the field.
 * @param {(option: any) => void} [props.onSelect] - Option committed (click, or Enter when selectOnEnter).
 * @param {(option: any) => void} [props.onHighlight] - Highlight moved to `option` (arrow/tab navigation).
 * @param {() => void} [props.onEscape] - Escape pressed (consumer may reset the display value).
 * @param {(e: React.KeyboardEvent) => void} [props.onKeyDown] - Passthrough for keys the primitive ignores.
 * @param {string} [props.placeholder]
 * @param {React.Ref|Function} [props.inputRef] - Forwarded to the underlying `<input>`.
 * @param {string} [props.inputClassName] - Extra class on the `<input>`.
 * @param {string} [props.ariaLabel] - Accessible name for the input (Swedish, user-facing).
 * @param {number} [props.maxSuggestions] - Cap on rendered options (default: render all).
 * @param {boolean} [props.openOnFocus=true] - Open the list when the input gains focus.
 * @param {boolean} [props.selectOnEnter=true] - Let Enter select the highlighted option.
 * @param {boolean} [props.navigateWithTab=false] - Use Tab / Shift+Tab to move the highlight.
 * @param {string} [props.id] - Base id for the ARIA wiring (auto-generated otherwise).
 * @returns {JSX.Element}
 */
export function Autocomplete({
  value = '',
  options = [],
  getOptionLabel = (o) => String(o),
  getOptionKey,
  onInputChange,
  onSelect,
  onHighlight,
  onEscape,
  onKeyDown,
  placeholder,
  inputRef,
  inputClassName = '',
  ariaLabel,
  maxSuggestions,
  openOnFocus = true,
  selectOnEnter = true,
  navigateWithTab = false,
  id,
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const localInputRef = useRef(null);
  const blurTimer = useRef(null);
  const baseId = useRef(id || `autocomplete-${++uid}`).current;
  const listboxId = `${baseId}-listbox`;

  const shown = typeof maxSuggestions === 'number'
    ? options.slice(0, maxSuggestions)
    : options;
  const listVisible = open && shown.length > 0;

  // Content signature (not array identity): a consumer that recomputes options
  // on every render — or previews a highlight into `value` — must not clobber
  // the highlight. Only a genuine change to the option set (typing) resets it.
  const optionsSig = shown
    .map((o, i) => (getOptionKey ? getOptionKey(o, i) : getOptionLabel(o)))
    .join('\u0000');

  const setInputRef = useCallback((el) => {
    localInputRef.current = el;
    if (inputRef) {
      if (typeof inputRef === 'function') inputRef(el);
      else inputRef.current = el;
    }
  }, [inputRef]);

  // A fresh option set (typing) invalidates the previous highlight. Layout
  // effect so the reset lands before paint — otherwise aria-activedescendant
  // and .selected point at the wrong option for one frame (and a
  // selectOnEnter consumer could commit a stale highlight).
  useLayoutEffect(() => {
    setHighlighted(-1);
  }, [optionsSig]);

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const dropdownStyle = useDropdownPosition(
    listVisible,
    localInputRef.current,
    { maxHeight: 200, gap: 4 },
  );

  const moveHighlight = (delta) => {
    const len = shown.length;
    if (len === 0) return;
    let next;
    if (delta > 0) {
      next = highlighted >= len - 1 ? 0 : highlighted + 1;
    } else {
      next = highlighted <= 0 ? len - 1 : highlighted - 1;
    }
    setHighlighted(next);
    onHighlight?.(shown[next]);
  };

  const commit = (option) => {
    onSelect?.(option);
    setOpen(false);
    setHighlighted(-1);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setHighlighted(-1);
      onEscape?.();
      e.target.blur();
      // Do not let Escape reach app-level handlers (e.g. review discard).
      e.stopPropagation();
      return;
    }

    const down = e.key === 'ArrowDown' || (navigateWithTab && e.key === 'Tab' && !e.shiftKey);
    const up = e.key === 'ArrowUp' || (navigateWithTab && e.key === 'Tab' && e.shiftKey);

    if ((down || up) && listVisible) {
      e.preventDefault();
      moveHighlight(down ? 1 : -1);
      return;
    }

    if (e.key === 'Enter' && selectOnEnter && listVisible && highlighted >= 0) {
      e.preventDefault();
      e.stopPropagation();
      commit(shown[highlighted]);
      return;
    }

    onKeyDown?.(e);
  };

  const handleFocus = () => {
    clearTimeout(blurTimer.current);
    if (openOnFocus) setOpen(true);
  };

  const handleBlur = () => {
    // Delay so an option mousedown can commit before the list unmounts.
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const activeId = highlighted >= 0 ? `${baseId}-option-${highlighted}` : undefined;

  return (
    <div className="autocomplete-wrapper">
      <input
        ref={setInputRef}
        type="text"
        role="combobox"
        aria-expanded={listVisible}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        className={inputClassName}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onInputChange?.(e.target.value);
          setOpen(true);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      />
      {listVisible && createPortal(
        <div
          className="autocomplete-dropdown"
          style={dropdownStyle}
          role="listbox"
          id={listboxId}
        >
          {shown.map((option, idx) => {
            const label = getOptionLabel(option);
            const key = getOptionKey ? getOptionKey(option, idx) : label;
            return (
              <div
                key={key}
                id={`${baseId}-option-${idx}`}
                role="option"
                aria-selected={idx === highlighted}
                className={`autocomplete-item ${idx === highlighted ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(option);
                }}
              >
                {label}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default Autocomplete;
