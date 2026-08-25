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
  var SILK_LINE_WIDTH = 0.12;     // mm stroke for silkscreen graphics
  var MASK_EXPANSION = 0.05;      // mm solder-mask opening growth per edge
  var CIRCLE_SEGMENTS = 32;       // chord count for circle outlines

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

  /* ---- generic image builder ------------------------------------------- */

  // Assemble a standard RS-274X image: header, aperture definitions,
  // flash operations ({apertureId, x, y}) and polyline draws
  // ({apertureId, pts: [[x,y],...]}).
  function buildImage(flashes, draws, apertureList) {
    var out = [];
    out.push('%FSLAX44Y44*%');
    out.push('%MOMM*%');
    out.push('%LPD*%');
    for (var i = 0; i < apertureList.length; i++) {
      out.push(apertureDefinition(apertureList[i]));
    }
    for (var f = 0; f < flashes.length; f++) {
      var fl = flashes[f];
      out.push(fl.apertureId + '*');
      out.push('X' + fmtCoord(fl.x) + 'Y' + fmtCoord(fl.y) + 'D03*');
    }
    for (var d = 0; d < draws.length; d++) {
      var dr = draws[d];
      if (!dr.pts || dr.pts.length < 2) continue;
      out.push(dr.apertureId + '*');
      out.push('X' + fmtCoord(dr.pts[0][0]) + 'Y' + fmtCoord(dr.pts[0][1]) + 'D02*');
      for (var p = 1; p < dr.pts.length; p++) {
        out.push('X' + fmtCoord(dr.pts[p][0]) + 'Y' + fmtCoord(dr.pts[p][1]) + 'D01*');
      }
      out.push('D02*');
    }
    out.push('M02*');
    return out.join('\n') + '\n';
  }

  // Copper-layer membership for a pad, tolerating '*.Cu' wildcards and an
  // absent layer list (falls back to the footprint side). Mirrors the
  // padOnLayer rule used by clearance/edge DRC.
  function padOnCopper(pad, fp, cu) {
    var L = (Array.isArray(pad.layers) && pad.layers.length) ? pad.layers : null;
    if (!L) return (fp.layer === cu);
    for (var i = 0; i < L.length; i++) {
      if (L[i] === cu || L[i] === '*.Cu') return true;
    }
    return false;
  }

  function expand(size, by) {
    return [size[0] + 2 * by, size[1] + 2 * by];
  }

  /* ---- solder mask ------------------------------------------------------ */

  // Openings at every pad on this side (SMD + THT), derived from copper
  // membership ('*.Cu' wildcards / empty lists fall back to footprint side)
  // so files that omit explicit F.Mask/B.Mask entries still open correctly.
  // Expanded by MASK_EXPANSION. Vias stay tented.
  function exportMaskLayer(board, layer) {
    var cu = layer.replace('Mask', 'Cu');
    var list = [];
    var byKey = Object.create(null);
    var nextId = FIRST_APERTURE;
    var flashes = [];

    var footprints = board.footprints || [];
    for (var i = 0; i < footprints.length; i++) {
      var fp = footprints[i];
      var pads = fp.pads || [];
      for (var j = 0; j < pads.length; j++) {
        var pad = pads[j];
        if (!padOnCopper(pad, fp, cu)) continue;
        var params = padApertureParams(pad);
        var size = expand(params.size, MASK_EXPANSION);
        var key = apertureKey(params.shape, size, null);
        var id = byKey[key];
        if (id === undefined) {
          id = 'D' + nextId;
          nextId += 1;
          byKey[key] = id;
          list.push({ id: id, shape: params.shape, size: size, drill: null });
        }
        flashes.push({ apertureId: id, x: pad.at[0], y: pad.at[1] });
      }
    }
    return buildImage(flashes, [], list);
  }

  /* ---- solder paste ----------------------------------------------------- */

  // Stencil openings: SMD pads only (THT holes get no paste), same shape and
  // size as the copper aperture. Side comes from copper membership, not from
  // an explicit F.Paste entry — many real files omit it.
  function exportPasteLayer(board, layer) {
    var cu = layer.replace('Paste', 'Cu');
    var list = [];
    var byKey = Object.create(null);
    var nextId = FIRST_APERTURE;
    var flashes = [];

    var footprints = board.footprints || [];
    for (var i = 0; i < footprints.length; i++) {
      var fp = footprints[i];
      var pads = fp.pads || [];
      for (var j = 0; j < pads.length; j++) {
        var pad = pads[j];
        if (pad.type === 'tht' || pad.type === 'npth') continue;
        if (!padOnCopper(pad, fp, cu)) continue;
        var params = padApertureParams(pad);
        var key = apertureKey(params.shape, params.size, null);
        var id = byKey[key];
        if (id === undefined) {
          id = 'D' + nextId;
          nextId += 1;
          byKey[key] = id;
          list.push({ id: id, shape: params.shape, size: params.size, drill: null });
        }
        flashes.push({ apertureId: id, x: pad.at[0], y: pad.at[1] });
      }
    }
    return buildImage(flashes, [], list);
  }

  /* ---- silkscreen -------------------------------------------------------- */

  // Stroke font used for silkscreen text. Resolved lazily so load order can
  // never break non-text exports (browser global first, Node require second).
  function strokeFont() {
    if (typeof KipadStrokeFont !== 'undefined') return KipadStrokeFont;
    if (typeof require === 'function') {
      try { return require('./strokefont.js'); } catch (e) { /* fall through */ }
    }
    return null;
  }

  // Rotate a footprint-local point into world coordinates (same transform
  // as the canvas renderer: rotation about the footprint origin, no
  // mirroring — the model never mirrors local geometry on side flips).
  function fpToWorld(fp, p) {
    var dx = p[0], dy = p[1];
    if (!fp.angle) return [fp.at[0] + dx, fp.at[1] + dy];
    var r = fp.angle * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    return [fp.at[0] + dx * c - dy * s, fp.at[1] + dx * s + dy * c];
  }

  // Art items carry F./B.-prefixed layers; a part placed on the back shows
  // its art on the back silk (the flip tool swaps pad layers explicitly but
  // leaves stored art labels alone, so derive the effective layer here).
  function effectiveArtLayer(fp, raw) {
    var layer = raw || 'F.SilkS';
    if (fp.layer === 'B.Cu') {
      if (layer === 'F.SilkS') return 'B.SilkS';
      if (layer === 'B.SilkS') return 'F.SilkS';
    }
    return layer;
  }

  function circlePoly(cx, cy, r) {
    var pts = [];
    for (var i = 0; i <= CIRCLE_SEGMENTS; i++) {
      var a = 2 * Math.PI * i / CIRCLE_SEGMENTS;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  function rectPoly(start, end) {
    var x0 = Math.min(start[0], end[0]), y0 = Math.min(start[1], end[1]);
    var x1 = Math.max(start[0], end[0]), y1 = Math.max(start[1], end[1]);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  }

  // Silkscreen graphics: footprints' silk art (library defs resolved through
  // the optional getFootprint(name) callback, falling back to art stored on
  // the placed instance) drawn as fixed-width strokes, silkscreen TEXT
  // stroked through the single-stroke vector font (KipadStrokeFont),
  // board-level gr_text and reference designators included.
  function exportSilkLayer(board, layer, getFootprint) {
    var list = [{ id: 'D' + FIRST_APERTURE, shape: 'C', size: [SILK_LINE_WIDTH, SILK_LINE_WIDTH], drill: null }];
    var strokeId = 'D' + FIRST_APERTURE;
    var byKey = Object.create(null);
    var nextId = FIRST_APERTURE + 1;
    var draws = [];

    // Extra round apertures for board text thicknesses (deduped); the base
    // stroke aperture covers silk art and reference designators.
    function widthId(w) {
      w = (Number(w) > 0) ? Number(w) : SILK_LINE_WIDTH;
      if (Math.abs(w - SILK_LINE_WIDTH) < 1e-9) return strokeId;
      var key = apertureKey('C', [w, w], '');
      if (byKey[key] !== undefined) return byKey[key];
      var id = 'D' + nextId;
      nextId += 1;
      byKey[key] = id;
      list.push({ id: id, shape: 'C', size: [w, w], drill: null });
      return id;
    }

    var SF = strokeFont();
    function emitText(job) {
      if (!SF) return;
      var polys = SF.strokesFor(job.text, {
        x: job.x, y: job.y,
        size: (Number(job.size) > 0) ? Number(job.size) : 1,
        angle: Number(job.angle) || 0,
        justify: job.justify || 'center'
      });
      if (!polys.length) return;
      var id = widthId(job.thickness);
      for (var i = 0; i < polys.length; i++) {
        draws.push({ apertureId: id, pts: polys[i] });
      }
    }

    var footprints = board.footprints || [];
    for (var i = 0; i < footprints.length; i++) {
      var fp = footprints[i];
      var lib = (typeof getFootprint === 'function') ? getFootprint(fp.lib) : null;
      var items = (lib && lib.silk && lib.silk.length) ? lib.silk : (fp.silk || []);
      for (var j = 0; j < items.length; j++) {
        var s = items[j];
        if (effectiveArtLayer(fp, s.layer) !== layer) continue;
        if (s.type === 'line' && Array.isArray(s.pts) && s.pts.length >= 2) {
          var pts = [];
          for (var k = 0; k < s.pts.length; k++) pts.push(fpToWorld(fp, s.pts[k]));
          draws.push({ apertureId: strokeId, pts: pts });
        } else if (s.type === 'rect' && s.start && s.end) {
          draws.push({ apertureId: strokeId, pts: rectPoly(s.start, s.end).map(function (p) { return fpToWorld(fp, p); }) });
        } else if (s.type === 'circle' && s.at && s.r > 0) {
          var centre = fpToWorld(fp, s.at);
          draws.push({ apertureId: strokeId, pts: circlePoly(centre[0], centre[1], s.r) });
        } else if (s.type === 'text' && s.text && Array.isArray(s.at)) {
          var tp = fpToWorld(fp, s.at);
          emitText({ text: String(s.text), x: tp[0], y: tp[1], size: s.size, angle: 0, justify: 'center', thickness: SILK_LINE_WIDTH });
        }
      }

      // Reference designator above the part, same geometry rule as the
      // canvas renderer (courtyard half-height + 0.8 mm, 1.3 mm cap).
      var side = (fp.layer === 'B.Cu') ? 'B.SilkS' : 'F.SilkS';
      if (side === layer && !(fp.ref == null) && String(fp.ref).length) {
        var off = (lib && lib.courtyard && lib.courtyard.max)
          ? (Math.abs(lib.courtyard.max[1] - lib.courtyard.min[1]) / 2 + 0.8)
          : 1.8;
        emitText({ text: String(fp.ref), x: fp.at[0], y: fp.at[1] - off, size: 1.3, angle: 0, justify: 'center', thickness: SILK_LINE_WIDTH });
      }
    }

    // Board-level silkscreen text (Place > Text / gr_text round-trip).
    var texts = board.texts || [];
    for (var b = 0; b < texts.length; b++) {
      var tx = texts[b];
      if ((tx.layer || 'F.SilkS') !== layer) continue;
      emitText({
        text: tx.text,
        x: tx.at[0], y: tx.at[1],
        size: tx.size,
        angle: tx.angle,
        justify: tx.justify,
        thickness: tx.thickness
      });
    }

    return buildImage([], draws, list);
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

  function exportAll(board, getFootprint) {
    return {
      'F.Cu': exportLayer(board, 'F.Cu'),
      'B.Cu': exportLayer(board, 'B.Cu'),
      'Edge.Cuts': exportLayer(board, 'Edge.Cuts'),
      'F.SilkS': exportSilkLayer(board, 'F.SilkS', getFootprint),
      'B.SilkS': exportSilkLayer(board, 'B.SilkS', getFootprint),
      'F.Mask': exportMaskLayer(board, 'F.Mask'),
      'B.Mask': exportMaskLayer(board, 'B.Mask'),
      'F.Paste': exportPasteLayer(board, 'F.Paste'),
      'B.Paste': exportPasteLayer(board, 'B.Paste')
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
    getApertures: getApertures,
    exportMaskLayer: exportMaskLayer,
    exportPasteLayer: exportPasteLayer,
    exportSilkLayer: exportSilkLayer
  };
});
