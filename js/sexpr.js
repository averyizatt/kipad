'use strict';

/**
 * KipadSexpr — minimal S-expression parser/serializer for KiCad files.
 *
 * Node representation:
 *   - every list is a JS Array; the first element is the tag (a string)
 *   - atoms are strings
 *   - quoted atoms (e.g. "F.Cu", "R_0603") are stored as { q: 'text' }
 *     objects so the serializer can re-add the quotes and round-trip exactly
 *
 * Robustness: skips `#` comments, handles CRLF, nested lists, negative
 * numbers, floats, and escaped quotes/backslashes inside strings.
 *
 * Works as a browser <script> (global `KipadSexpr`) and as a Node module.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadSexpr = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WS = ' \t\n\r';

  function isWs(c) {
    return WS.indexOf(c) !== -1;
  }

  // ------------------------------------------------------------------
  // parser
  // ------------------------------------------------------------------

  function parse(text) {
    if (typeof text !== 'string') {
      throw new Error('KipadSexpr.parse: expected a string');
    }

    var i = 0;
    var n = text.length;

    // Skip whitespace and `# ...` comments (to end of line).
    function skipWs() {
      for (;;) {
        while (i < n && isWs(text[i])) i++;
        if (i < n && text[i] === '#') {
          while (i < n && text[i] !== '\n') i++;
          continue;
        }
        break;
      }
    }

    // text[i] === '"' — read a quoted atom, return { q: <unquoted text> }.
    function readQuoted() {
      i++; // opening quote
      var out = '';
      while (i < n) {
        var c = text[i];
        if (c === '\\') {
          var nxt = text[i + 1];
          if (nxt === '"' || nxt === '\\') {
            out += nxt;
            i += 2;
          } else {
            out += c;
            i++;
          }
        } else if (c === '"') {
          i++;
          return { q: out };
        } else {
          out += c;
          i++;
        }
      }
      throw new Error('KipadSexpr.parse: unterminated string');
    }

    function readAtom() {
      var out = '';
      while (i < n) {
        var c = text[i];
        if (isWs(c) || c === '(' || c === ')' || c === '#') break;
        out += c;
        i++;
      }
      return out;
    }

    function readNode() {
      skipWs();
      if (i >= n) throw new Error('KipadSexpr.parse: unexpected end of input');
      var c = text[i];
      if (c === '(') {
        i++;
        var list = [];
        for (;;) {
          skipWs();
          if (i >= n) throw new Error('KipadSexpr.parse: unterminated list');
          if (text[i] === ')') {
            i++;
            return list;
          }
          list.push(readNode());
        }
      }
      if (c === ')') throw new Error('KipadSexpr.parse: unexpected )');
      if (c === '"') return readQuoted();
      return readAtom();
    }

    var result = readNode();
    skipWs();
    if (i < n) {
      throw new Error('KipadSexpr.parse: trailing content at offset ' + i);
    }
    return result;
  }

  // ------------------------------------------------------------------
  // serializer
  // ------------------------------------------------------------------

  // Plain atoms only need quotes when they would otherwise break the
  // format. Atoms that were quoted in the source are stored as {q:...}
  // and are ALWAYS re-quoted, which keeps round-trips exact.
  function needsQuote(s) {
    return s === '' || /[\s()"#\\]/.test(s);
  }

  function escapeStr(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function atomText(a) {
    if (a !== null && typeof a === 'object' && typeof a.q === 'string') {
      return '"' + escapeStr(a.q) + '"';
    }
    var s = String(a);
    return needsQuote(s) ? '"' + escapeStr(s) + '"' : s;
  }

  /**
   * KiCad-style pretty printer: 2-space indentation, one child per line,
   * `(tag\n  child\n  child\n)` — `(tag)` for empty lists.
   */
  function stringify(node, depth) {
    if (depth === undefined) depth = 0;
    if (node === null || node === undefined) {
      throw new Error('KipadSexpr.stringify: cannot serialize ' + node);
    }
    var pad = '  '.repeat(depth);
    if (Array.isArray(node)) {
      if (node.length === 0) return pad + '()';
      if (node.length === 1) return pad + '(' + atomText(node[0]) + ')';
      var inner = node.slice(1).map(function (c) { return stringify(c, depth + 1); });
      return pad + '(' + atomText(node[0]) + '\n' + inner.join('\n') + '\n' + pad + ')';
    }
    return pad + atomText(node);
  }

  return { parse: parse, stringify: stringify };
});
