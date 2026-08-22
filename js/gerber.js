'use strict';

/* Kipad Gerber RS-274X exporter.
 *
 * Unit: mm, format 4.4 (header %FSLAX44Y44*%). Coordinates are emitted as
 * plain integers in 1e-4 mm units (mm * 10000, rounded to integer), which
 * matches the declared 4.4 format (4 integer + 4 decimal digits).
 *
 * Works as a browser <script> (global `KipadGerber`) and as a Node module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadGerber = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  'use strict';

  var COORD_SCALE = 10000;        // 1e-4 mm units
  var FIRST_APERTURE = 10;        // D10, increment
  var EDGE_LINE_WIDTH = 0.15;     // mm, line aperture for Edge.Cuts

  /* ---- small helpers --------------------------------------------------- */

  // mm -> integer in 1e-4 mm units, plain integer string, no leading zeros
  function fmtCoord(mm) {
    return String(Math.round(mm * COORD_SCALE));
  }

  // aperture sizes are written as plain decimal numbers (not format-constrained)
  function fmtApertureSize(mm) {
    return mm.toFixed(6);
  }

  function apertureKey(shape, size, drill) {
    var d = (drill === null || drill === undefined) ? '' : drill;
    return shape + '|' + size[0] + 'x' + size[1] + '|' + d;
  }

  /* ---- aperture collection --------------------------------------------- */

  // Map a pad shape to its Gerber aperture letter.
  // roundrect and obround both use the obround (O) aperture; the drill hole
  // of THT pads is not subtracted in Gerber, it is just flashed as a circle.
  function apertureLetter(shape) {
    if (shape === 'rect') return 'R';
    if (shape === 'roundrect' || shape === 'obround') return 'O';
    return 'C'; // 'circle' and any unknown shape
  }

  // Determine the flash aperture parameters for one pad.
  // THT pads: hole is not subtracted in Gerber; flash a circle of max(size).
  function padApertureParams(pad) {
    var w = pad.size[0];
    var h = pad.size[1];
    if (pad.type === 'tht') {
      var d = Math.max(w, h);
      var drill = (pad.drill === null || pad.drill === undefined) ? null : pad.drill;
      return { shape: 'C', size: [d, d], drill: drill };
    }
    return { shape: apertureLetter(pad.shape), size: [w, h], drill: null };
  }

  // Collect the deduplicated aperture list for a layer plus the element ->
  // aperture-id assignments needed to emit the image.
  function collectLayerApertures(board, layer) {
    var list = [];
    var byKey = Object.create(null);
    var nextId = FIRST_APERTURE;

    function add(shape, size, drill) {
      var key = apertureKey(shape, size, drill);
      if (byKey[key] !== undefined) {
        return byKey[key];
      }
      var id = 'D' + nextId;
      nextId += 1;
      byKey[key] = id;
      list.push({ id: id, shape: shape, size: [size[0], size[1]], drill: drill });
      return id;
    }

    var padEntries = [];
    var trackEntries = [];
    var viaEntries = [];

    var footprints = board.footprints || [];
    for (var i = 0; i < footprints.length; i++) {
      var fp = footprints[i];
      var pads = fp.pads || [];
      for (var j = 0; j < pads.length; j++) {
        var pad = pads[j];
        var onLayer = (pad.layers && pad.layers.length > 0 && pad.layers[0] === layer) ||
                      (!pad.layers && fp.layer === layer);
        if (!onLayer) continue;
        var params = padApertureParams(pad);
        var apertureId = add(params.shape, params.size, params.drill);
        padEntries.push({ pad: pad, apertureId: apertureId });
      }
    }

    var tracks = board.tracks || [];
    for (var k = 0; k < tracks.length; k++) {
      var tr = tracks[k];
      if (tr.layer !== layer) continue;
      var trackApertureId = add('C', [tr.width, tr.width], null);
      trackEntries.push({ track: tr, apertureId: trackApertureId });
    }

    var vias = board.vias || [];
    for (var m = 0; m < vias.length; m++) {
      var via = vias[m];
      var viaDrill = (via.drill === null || via.drill === undefined) ? null : via.drill;
      var viaApertureId = add('C', [via.size, via.size], viaDrill);
      viaEntries.push({ via: via, apertureId: viaApertureId });
    }

    var edgeApertureId = null;
    if (layer === 'Edge.Cuts') {
      edgeApertureId = add('C', [EDGE_LINE_WIDTH, EDGE_LINE_WIDTH], null);
    }

    return {
      list: list,
      pads: padEntries,
      tracks: trackEntries,
      vias: viaEntries,
      edgeApertureId: edgeApertureId
    };
  }

  function apertureDefinition(ap) {
    if (ap.shape === 'C') {
      return '%ADD' + ap.id.slice(1) + 'C,' + fmtApertureSize(ap.size[0]) + '*%';
    }
    return '%ADD' + ap.id.slice(1) + ap.shape + ',' +
      fmtApertureSize(ap.size[0]) + 'X' + fmtApertureSize(ap.size[1]) + '*%';
  }

  /* ---- layer export ----------------------------------------------------- */

  function exportLayer(board, layer) {
    var a = collectLayerApertures(board, layer);
    var out = [];

    // header
    out.push('%FSLAX44Y44*%');
    out.push('%MOMM*%');
    out.push('%LPD*%');

    // all aperture definitions first, then the image
    for (var i = 0; i < a.list.length; i++) {
      out.push(apertureDefinition(a.list[i]));
    }

    // flash pads
    for (var j = 0; j < a.pads.length; j++) {
      var pe = a.pads[j];
      out.push(pe.apertureId + '*');
      out.push('X' + fmtCoord(pe.pad.at[0]) + 'Y' + fmtCoord(pe.pad.at[1]) + 'D03*');
    }

    // draw tracks (move, expose, draw)
    for (var k = 0; k < a.tracks.length; k++) {
      var te = a.tracks[k];
      out.push(te.apertureId + '*');
      out.push('X' + fmtCoord(te.track.start[0]) + 'Y' + fmtCoord(te.track.start[1]) + 'D02*');
      out.push('X' + fmtCoord(te.track.end[0]) + 'Y' + fmtCoord(te.track.end[1]) + 'D01*');
      out.push('D02*');
    }

    // flash vias (they connect both copper layers)
    for (var m = 0; m < a.vias.length; m++) {
      var ve = a.vias[m];
      out.push(ve.apertureId + '*');
      out.push('X' + fmtCoord(ve.via.at[0]) + 'Y' + fmtCoord(ve.via.at[1]) + 'D03*');
    }

    // Edge.Cuts: outline polylines as D02/D01 line segments
    if (layer === 'Edge.Cuts' && a.edgeApertureId) {
      out.push(a.edgeApertureId + '*');
      var polys = board.outline || [];
      for (var p = 0; p < polys.length; p++) {
        var poly = polys[p];
        if (!poly || poly.length === 0) continue;
        out.push('X' + fmtCoord(poly[0][0]) + 'Y' + fmtCoord(poly[0][1]) + 'D02*');
        for (var q = 1; q < poly.length; q++) {
          out.push('X' + fmtCoord(poly[q][0]) + 'Y' + fmtCoord(poly[q][1]) + 'D01*');
        }
      }
      out.push('D02*');
    }

    out.push('M02*');
    return out.join('\n') + '\n';
  }

  function exportAll(board) {
    return {
      'F.Cu': exportLayer(board, 'F.Cu'),
      'B.Cu': exportLayer(board, 'B.Cu'),
      'Edge.Cuts': exportLayer(board, 'Edge.Cuts')
    };
  }

  /* ---- debugging / tests ------------------------------------------------ */

  function getApertures(board, layer) {
    var a = collectLayerApertures(board, layer);
    var result = {};
    for (var i = 0; i < a.list.length; i++) {
      var ap = a.list[i];
      result[ap.id] = {
        shape: ap.shape,
        size: [ap.size[0], ap.size[1]],
        drill: ap.drill
      };
    }
    return result;
  }

  return {
    exportLayer: exportLayer,
    exportAll: exportAll,
    getApertures: getApertures
  };
});
