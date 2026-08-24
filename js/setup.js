/* KipadSetup — Board Setup model: DRC constraint overrides + pre-defined routing sizes.
 * Pure UMD, dependency-free.
 *
 * board.setup is APP-level state (persists in the localStorage board JSON and in undo
 * snapshots), not part of the .kicad_pcb sexpr round trip — same treatment as
 * board.netClasses. Shape:
 *   {
 *     minClearance: number|null,   // mm; null = each net pair uses max(class clearances)
 *     holeClearance: number,       // mm copper-to-drilled-hole (DRC)
 *     edgeClearance: number,       // mm copper-to-board-edge (DRC)
 *     trackWidths: [mm...],        // pre-defined widths for toolbar select / W cycling
 *     viaSizes: [[size,drill]...]  // pre-defined via pairs (drill < size), ascending
 *   }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KipadSetup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // KiCad default constraints (builtin_design_settings / DRC defaults)
  var CONSTRAINT_DEFAULTS = { holeClearance: 0.25, edgeClearance: 0.5 };
  var PRESET_TRACK_WIDTHS = [0.15, 0.2, 0.25, 0.3, 0.5, 0.8, 1.0, 1.27, 2.0];
  var PRESET_VIA_SIZES = [[0.6, 0.3], [0.8, 0.4], [1.0, 0.5], [1.2, 0.6]];

  function r3(n) { return Math.round(n * 1000) / 1000; }
  function num(v, fallback) {
    var n = typeof v === 'string' ? parseFloat(v) : v;
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
  }

  // widths(list) -> positive mm values, rounded to 3 decimals, deduped, ascending.
  // Garbage entries dropped; nothing survives -> KiCad presets.
  function widths(list) {
    if (!Array.isArray(list)) return PRESET_TRACK_WIDTHS.slice();
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var w = num(list[i], null);
      if (w == null || w <= 0 || w > 100) continue;
      seen[String(r3(w))] = true;
    }
    var out = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
    return out.length ? out : PRESET_TRACK_WIDTHS.slice();
  }

  // vias(pairs) -> [[size, drill]...] with size > drill >= 0, ascending, deduped by
  // size (first wins). Missing/non-positive drill defaults to half the size (same
  // convention as KipadRoute.viaChoices); drill >= size rejected (no annulus).
  function vias(pairs) {
    if (!Array.isArray(pairs)) return PRESET_VIA_SIZES.map(function (p) { return p.slice(); });
    var bySize = {};
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i], size, drill;
      if (Array.isArray(p)) { size = num(p[0], null); drill = num(p[1], null); }
      else if (p && typeof p === 'object') { size = num(p.size, null); drill = num(p.drill, null); }
      else { size = num(p, null); drill = null; }
      if (size == null || size <= 0 || size > 20) continue;
      if (drill == null || drill <= 0) drill = size / 2;
      if (drill >= size) continue;
      var key = String(r3(size));
      if (!(key in bySize)) bySize[key] = [r3(size), r3(drill)]; // first wins (route.js convention)
    }
    var out = Object.keys(bySize).map(Number).sort(function (a, b) { return a - b; })
      .map(function (k) { return bySize[k]; });
    return out.length ? out : PRESET_VIA_SIZES.map(function (p) { return p.slice(); });
  }

  // normalize(setup) -> sanitized copy; unknown keys dropped, invalid values fall
  // back to defaults (minClearance falls back to null = follow net classes).
  function normalize(setup) {
    var s = (setup && typeof setup === 'object') ? setup : {};
    var minCl = num(s.minClearance, null);
    var hole = num(s.holeClearance, CONSTRAINT_DEFAULTS.holeClearance);
    var edge = num(s.edgeClearance, CONSTRAINT_DEFAULTS.edgeClearance);
    return {
      minClearance: (minCl != null && minCl > 0 && minCl <= 20) ? r3(minCl) : null,
      holeClearance: (hole > 0 && hole <= 20) ? r3(hole) : CONSTRAINT_DEFAULTS.holeClearance,
      edgeClearance: (edge >= 0 && edge <= 20) ? r3(edge) : CONSTRAINT_DEFAULTS.edgeClearance,
      trackWidths: widths(s.trackWidths),
      viaSizes: vias(s.viaSizes)
    };
  }

  // effective(board) -> merged constraints + preset lists (fresh object every call);
  // boards without a .setup get pure defaults.
  function effective(board) {
    return normalize((board && typeof board === 'object') ? board.setup : null);
  }

  return {
    CONSTRAINT_DEFAULTS: CONSTRAINT_DEFAULTS,
    PRESET_TRACK_WIDTHS: PRESET_TRACK_WIDTHS,
    PRESET_VIA_SIZES: PRESET_VIA_SIZES,
    normalize: normalize,
    effective: effective,
    widths: widths,
    vias: vias
  };
});
