'use strict';

/**
 * KipadSymbols — in-memory registry of parsed KiCad symbols.
 *
 * No canvas code. Pure data. Works as a browser <script> (global
 * `KipadSymbols`) and as a Node module.
 *
 * Registry holds symbol objects in the KipadKicadSym schema:
 *   { name, ref, value, desc, footprint, pins: [...], graphics: [...] }
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadSymbols = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var registry = Object.create(null);

  function deepCopy(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function validSymbol(s) {
    return s && typeof s === 'object' && typeof s.name === 'string' && s.name.length > 0;
  }

  /**
   * loadLibrary(arrayOfSymbols) — merge symbols into the registry.
   * Symbols with the same name replace earlier ones.
   */
  function loadLibrary(symbols) {
    if (!Array.isArray(symbols)) return 0;
    var added = 0;
    for (var i = 0; i < symbols.length; i++) {
      var s = symbols[i];
      if (!validSymbol(s)) continue;
      registry[s.name] = s;
      added++;
    }
    return added;
  }

  /** listSymbols() -> sorted array of symbol names. */
  function listSymbols() {
    return Object.keys(registry).sort();
  }

  /** getSymbol(name) -> deep copy of the symbol, or null. */
  function getSymbol(name) {
    var s = registry[name];
    return s ? deepCopy(s) : null;
  }

  /**
   * searchSymbols(q) -> array of deep-copied symbols whose name, ref or desc
   * contains q (case-insensitive). Sorted by name.
   */
  function searchSymbols(q) {
    var needle = String(q === undefined || q === null ? '' : q).toLowerCase();
    var out = [];
    var names = Object.keys(registry);
    for (var i = 0; i < names.length; i++) {
      var s = registry[names[i]];
      if (
        s.name.toLowerCase().indexOf(needle) !== -1 ||
        (typeof s.ref === 'string' && s.ref.toLowerCase().indexOf(needle) !== -1) ||
        (typeof s.desc === 'string' && s.desc.toLowerCase().indexOf(needle) !== -1) ||
        (typeof s.library === 'string' && s.library.toLowerCase().indexOf(needle) !== -1)
      ) {
        out.push(deepCopy(s));
      }
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return out;
  }

  /** count() -> number of symbols in the registry. */
  function count() {
    return Object.keys(registry).length;
  }

  /** clear() — empty the registry (useful for tests / hot reload). */
  function clear() {
    registry = Object.create(null);
  }

  return {
    loadLibrary: loadLibrary,
    listSymbols: listSymbols,
    getSymbol: getSymbol,
    searchSymbols: searchSymbols,
    count: count,
    clear: clear
  };
});
