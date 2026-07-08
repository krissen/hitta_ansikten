/**
 * Kbd — keyboard key badge.
 *
 * Thin wrapper around the native `<kbd>` element that applies the existing
 * retro `.kbd` style from theme.css. Use for inline keyboard hints (e.g. Enter, Esc).
 */

import React from 'react';

/**
 * @param {object} props
 * @param {React.ReactNode} props.children - Key label (e.g. "Enter", "⌘Z").
 * @param {string} [props.className] - Extra classes appended to `.kbd`.
 * @returns {JSX.Element}
 */
export function Kbd({ children, className = '', ...rest }) {
  const classes = ['kbd', className].filter(Boolean).join(' ');
  return (
    <kbd className={classes} {...rest}>
      {children}
    </kbd>
  );
}

export default Kbd;
