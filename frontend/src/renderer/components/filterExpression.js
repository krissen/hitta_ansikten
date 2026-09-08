/**
 * filterExpression - Parse and evaluate filter expressions with | (OR), & (AND), and parentheses.
 *
 * Syntax:
 *   vilm|max        → matches "vilm" OR "max"
 *   vilm&max        → matches "vilm" AND "max"
 *   (vilm|max)&2506 → ("vilm" OR "max") AND "2506"
 *   vilm             → simple substring match
 *
 * Precedence: & binds tighter than |, so a|b&c = a|(b&c).
 * Parentheses override precedence.
 * Leading/trailing * on atoms are stripped (glob compat).
 * All matching is case-insensitive.
 *
 * Grammar:
 *   expr   = term ('|' term)*
 *   term   = factor ('&' factor)*
 *   factor = '(' expr ')' | atom
 *   atom   = [^|&()]+
 */

/**
 * Parse a filter expression string into an AST.
 * @param {string} input
 * @returns {object} AST node: { type: 'atom', value } | { type: 'or'|'and', children }
 */
export function parseFilterExpression(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let pos = 0;

  function peek() {
    return trimmed[pos];
  }
  function advance() {
    return trimmed[pos++];
  }

  function parseExpr() {
    const children = [parseTerm()];
    while (pos < trimmed.length && peek() === '|') {
      advance(); // consume '|'
      children.push(parseTerm());
    }
    return children.length === 1 ? children[0] : { type: 'or', children };
  }

  function parseTerm() {
    const children = [parseFactor()];
    while (pos < trimmed.length && peek() === '&') {
      advance(); // consume '&'
      children.push(parseFactor());
    }
    return children.length === 1 ? children[0] : { type: 'and', children };
  }

  function parseFactor() {
    if (peek() === '(') {
      advance(); // consume '('
      const node = parseExpr();
      if (peek() === ')') advance(); // consume ')'
      return node;
    }
    return parseAtom();
  }

  function parseAtom() {
    let value = '';
    while (
      pos < trimmed.length &&
      peek() !== '|' &&
      peek() !== '&' &&
      peek() !== '(' &&
      peek() !== ')'
    ) {
      value += advance();
    }
    // Strip glob-style leading/trailing * and whitespace
    value = value
      .replace(/^\*+|\*+$/g, '')
      .trim()
      .toLowerCase();
    return { type: 'atom', value };
  }

  return parseExpr();
}

/**
 * Evaluate an AST node against a text string.
 * @param {object} node - AST node from parseFilterExpression
 * @param {string} text - The text to match against (should be lowercase)
 * @returns {boolean}
 */
export function evaluateFilter(node, text) {
  if (!node) return true;

  switch (node.type) {
    case 'atom':
      return !node.value || text.includes(node.value);
    case 'or':
      return node.children.some((child) => evaluateFilter(child, text));
    case 'and':
      return node.children.every((child) => evaluateFilter(child, text));
    default:
      return true;
  }
}

/**
 * Convenience: compile a filter expression into a matcher function.
 * @param {string} expression - Filter expression string
 * @returns {function(string): boolean} - Matcher that takes text and returns true/false
 */
export function compileFilter(expression) {
  const ast = parseFilterExpression(expression);
  if (!ast) return () => true;
  return (text) => evaluateFilter(ast, text.toLowerCase());
}
