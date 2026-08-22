'use strict';

/**
 * KipadDrill — Excellon drill file exporter (.drl).
 *
 * Collects all drill sizes from THT pads and vias, deduplicates them, and
 * emits an Excellon-2 format file (mm units, 3.4 format, tool table).
 *
 * UMD: browser global `KipadDrill` / CommonJS module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadDrill = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Round to 3 decimals for the 3.4 format.
  function fmtCoord(mm) {
    // Excellon 3.4: integer part + 4 decimals, no sign padding needed
    return mm.toFixed(4);
  }

  /**
   * collectDrills(board) -> { sizes: [number,...], holes: [{at:[x,y], size, tool}] }
   * THT pads (and npth holes) contribute their drill; vias contribute too.
   */
  function collectDrills(board) {
    var sizesMap = Object.create(null);
    var holes = [];

    function addHole(at, size) {
      var s = Math.round(size * 1000) / 1000;
      if (!(s > 0)) return;
      if (!sizesMap[s]) sizesMap[s] = true;
      holes.push({ at: [at[0], at[1]], size: s });
    }

    for (var i = 0; i < (board.footprints || []).length; i++) {
      var fp = board.footprints[i];
      for (var j = 0; j < (fp.pads || []).length; j++) {
        var p = fp.pads[j];
        if (p.drill != null && p.drill > 0) addHole(p.at, p.drill);
      }
    }
    for (var k = 0; k < (board.vias || []).length; k++) {
      var v = board.vias[k];
      if (v.drill != null && v.drill > 0) addHole(v.at, v.drill);
    }

    var sizes = Object.keys(sizesMap).map(parseFloat).sort(function (a, b) { return a - b; });
    return { sizes: sizes, holes: holes };
  }

  /**
   * exportDrill(board) -> Excellon .drl text (or empty string when no holes).
   */
  function exportDrill(board) {
    var d = collectDrills(board);
    if (!d.holes.length) return '';

    var out = [];
    out.push('M48');                       // header start
    out.push('METRIC,TZ');                 // metric, trailing zeros
    out.push('FMAT,2');                    // Excellon 2
    out.push('INCH,LZ');                   // (legacy line; harmless)
    for (var t = 0; t < d.sizes.length; t++) {
      out.push('T' + (t + 1) + 'C' + fmtCoord(d.sizes[t]));
    }
    out.push('%');                         // end of header
    out.push('G90');                       // absolute
    out.push('G05');                       // drill mode

    // holes sorted by tool size for tidy output
    var holes = d.holes.slice().sort(function (a, b) {
      if (a.size !== b.size) return a.size - b.size;
      if (a.at[1] !== b.at[1]) return a.at[1] - b.at[1];
      return a.at[0] - b.at[0];
    });

    var currentTool = -1;
    for (var h = 0; h < holes.length; h++) {
      var hole = holes[h];
      var toolIdx = d.sizes.indexOf(hole.size) + 1;
      if (toolIdx !== currentTool) {
        out.push('T' + toolIdx);
        currentTool = toolIdx;
      }
      out.push('X' + fmtCoord(hole.at[0]) + 'Y' + fmtCoord(hole.at[1]));
    }

    out.push('T0');
    out.push('M30');                       // end of program
    return out.join('\n') + '\n';
  }

  return { collectDrills: collectDrills, exportDrill: exportDrill };
});
