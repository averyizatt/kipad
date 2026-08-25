'use strict';

/* KipadStrokeFont — single-stroke vector font for fabrication output.
 *
 * Silkscreen text cannot be exported as font glyphs in Gerber RS-274X; it
 * must be converted to stroked outlines. This module provides a compact
 * single-line font (one polyline per stroke, KiCad stroke-font style) and a
 * small layout engine that turns a string into world-space polylines.
 *
 * Glyph coordinate system: y-down like every other kipad model space.
 * Baseline y=0, cap height reaches y=-1, x-height y=-0.72, descenders to
 * y=+0.28. Widths are per-glyph in em units (em = cap height = 1).
 *
 * Works as a browser <script> (global `KipadStrokeFont`) and Node module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadStrokeFont = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  'use strict';

  var CAP = 1.0;        // cap height in em (top at y=-CAP)
  var XH = 0.72;        // x-height
  var DESC = 0.28;      // descender depth below baseline
  var CHAR_GAP = 0.22;  // extra advance between glyphs (em)
  var SPACE_W = 0.34;   // width of the space character
  var DEFAULT_W = 0.62; // default glyph width

  /* ---- geometry helpers ------------------------------------------------- */

  // Sample an axis-aligned elliptical arc. Angles in degrees, y-down screen
  // convention (angle measured from +x toward +y). A sweep with a1 < a0 runs
  // in decreasing-angle direction, which is visually counter-clockwise here.
  function ell(cx, cy, rx, ry, a0, a1, n) {
    n = Math.max(2, n || 12);
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return pts;
  }

  function circ(cx, cy, r, a0, a1, n) { return ell(cx, cy, r, r, a0, a1, n); }

  /* ---- glyph definitions --------------------------------------------------
   * Each entry: { w: <advance em>, s: [polyline, ...] } where a polyline is
   * an array of [x, y] points in glyph units.
   * ---------------------------------------------------------------------- */

  var G = {};

  function def(ch, w, polys) { G[ch] = { w: w, s: polys }; }

  // ---- uppercase ----
  def('A', 0.62, [
    [[0.02, 0], [0.31, -1], [0.60, 0]],
    [[0.125, -0.34], [0.495, -0.34]]
  ]);
  def('B', 0.62, [
    [[0.04, 0], [0.04, -1]],
    [[0.04, -1], [0.30, -1]].concat(circ(0.30, -0.80, 0.20, -90, 90, 8)).concat([[0.04, -0.60]]),
    [[0.04, -0.60], [0.34, -0.60]].concat(circ(0.34, -0.405, 0.195, -90, 90, 8)).concat([[0.04, -0.21]])
  ]);
  def('C', 0.66, [ell(0.37, -0.5, 0.41, 0.47, 50, 310, 16)]);
  def('D', 0.66, [
    [[0.04, 0], [0.04, -1], [0.32, -1]].concat(ell(0.32, -0.5, 0.38, 0.5, -90, 90, 12)).concat([[0.32, 0], [0.04, 0]])
  ]);
  def('E', 0.58, [
    [[0.05, 0], [0.05, -1], [0.55, -1]],
    [[0.05, -0.52], [0.47, -0.52]],
    [[0.05, 0], [0.55, 0]]
  ]);
  def('F', 0.58, [
    [[0.05, 0], [0.05, -1], [0.55, -1]],
    [[0.05, -0.52], [0.47, -0.52]]
  ]);
  def('G', 0.68, [
    ell(0.38, -0.5, 0.43, 0.47, 55, 310, 16),
    [[0.72, -0.86], [0.72, -0.5], [0.51, -0.5]]
  ]);
  def('H', 0.62, [
    [[0.04, 0], [0.04, -1]],
    [[0.58, 0], [0.58, -1]],
    [[0.04, -0.5], [0.58, -0.5]]
  ]);
  def('I', 0.30, [
    [[0.15, 0], [0.15, -1]],
    [[0.01, -1], [0.29, -1]],
    [[0.01, 0], [0.29, 0]]
  ]);
  def('J', 0.56, [
    [[0.50, -1], [0.50, -0.18]].concat(circ(0.28, -0.18, 0.22, 0, 180, 8))
  ]);
  def('K', 0.62, [
    [[0.04, 0], [0.04, -1]],
    [[0.56, -1], [0.04, -0.42]],
    [[0.20, -0.60], [0.58, 0]]
  ]);
  def('L', 0.56, [[[0.05, -1], [0.05, 0], [0.54, 0]]]);
  def('M', 0.84, [
    [[0.04, 0], [0.04, -1], [0.42, -0.30], [0.80, -1], [0.80, 0]]
  ]);
  def('N', 0.62, [
    [[0.04, 0], [0.04, -1], [0.58, 0], [0.58, -1]]
  ]);
  def('O', 0.66, [ell(0.33, -0.5, 0.33, 0.5, 0, 360, 20)]);
  def('P', 0.60, [
    [[0.05, 0], [0.05, -1], [0.34, -1]].concat(ell(0.34, -0.77, 0.28, 0.23, -90, 90, 10)).concat([[0.34, -0.54], [0.05, -0.54]])
  ]);
  def('Q', 0.68, [
    ell(0.33, -0.5, 0.33, 0.5, 0, 360, 20),
    [[0.44, -0.28], [0.64, 0.08]]
  ]);
  def('R', 0.64, [
    [[0.05, 0], [0.05, -1], [0.34, -1]].concat(ell(0.34, -0.77, 0.28, 0.23, -90, 90, 10)).concat([[0.34, -0.54]]),
    [[0.22, -0.54], [0.60, 0]]
  ]);
  def('S', 0.60, [
    [[0.56, -0.94], [0.42, -1], [0.22, -1], [0.09, -0.92], [0.07, -0.78], [0.16, -0.67], [0.33, -0.60], [0.50, -0.53], [0.57, -0.40], [0.56, -0.22], [0.44, -0.09], [0.26, -0.03], [0.10, -0.07], [0.04, -0.16]]
  ]);
  def('T', 0.64, [
    [[0.02, -1], [0.62, -1]],
    [[0.32, -1], [0.32, 0]]
  ]);
  def('U', 0.62, [
    [[0.04, -1], [0.04, -0.28]].concat(circ(0.31, -0.28, 0.27, 180, 0, 10)).concat([[0.58, -0.28], [0.58, -1]])
  ]);
  def('V', 0.64, [[[0.02, -1], [0.32, 0], [0.62, -1]]]);
  def('W', 0.90, [
    [[0.02, -1], [0.235, 0], [0.45, -0.62], [0.665, 0], [0.88, -1]]
  ]);
  def('X', 0.62, [
    [[0.04, -1], [0.58, 0]],
    [[0.58, -1], [0.04, 0]]
  ]);
  def('Y', 0.64, [
    [[0.04, -1], [0.32, -0.42]],
    [[0.60, -1], [0.32, -0.42], [0.32, 0]]
  ]);
  def('Z', 0.60, [[[0.04, -1], [0.56, -1], [0.04, 0], [0.56, 0]]]);

  // ---- lowercase (x-height 0.72) ----
  def('a', 0.58, [
    ell(0.26, -0.37, 0.26, 0.35, 0, 360, 14),
    [[0.52, -0.72], [0.52, 0]]
  ]);
  def('b', 0.58, [
    [[0.06, -1], [0.06, 0]],
    ell(0.33, -0.365, 0.27, 0.365, 270, 90, 12)
  ]);
  def('c', 0.54, [ell(0.30, -0.37, 0.25, 0.35, 55, 305, 12)]);
  def('d', 0.58, [
    [[0.60, -1], [0.60, 0]],
    ell(0.33, -0.365, 0.27, 0.365, -90, 90, 12)
  ]);
  def('e', 0.58, [
    [[0.06, -0.38], [0.56, -0.38]],
    ell(0.31, -0.37, 0.26, 0.36, -35, -305, 16)
  ]);
  def('f', 0.50, [
    ell(0.44, -0.70, 0.12, 0.12, 180, 20, 8),
    [[0.32, -0.62], [0.32, 0]],
    [[0.16, -0.55], [0.48, -0.55]]
  ]);
  def('g', 0.58, [
    ell(0.30, -0.37, 0.26, 0.35, 0, 360, 14),
    [[0.56, -0.72], [0.56, 0.10]].concat(circ(0.42, 0.10, 0.14, 0, 180, 6))
  ]);
  def('h', 0.58, [
    [[0.06, -1], [0.06, 0]],
    ell(0.30, -0.45, 0.24, 0.27, 180, 360, 8).concat([[0.54, 0]])
  ]);
  def('i', 0.16, [
    [[0.06, 0], [0.06, -0.72]],
    [[0.03, -0.92], [0.09, -0.92]]
  ]);
  def('j', 0.34, [
    [[0.30, -0.72], [0.30, 0.10]].concat(circ(0.16, 0.10, 0.14, 0, 180, 6)),
    [[0.27, -0.92], [0.33, -0.92]]
  ]);
  def('k', 0.56, [
    [[0.06, -1], [0.06, 0]],
    [[0.50, -0.70], [0.08, -0.32]],
    [[0.20, -0.42], [0.52, 0]]
  ]);
  def('l', 0.16, [[[0.06, 0], [0.06, -1]]]);
  def('m', 0.86, [
    [[0.06, -0.70], [0.06, 0]],
    ell(0.24, -0.44, 0.18, 0.26, 180, 360, 8).concat([[0.42, 0]]),
    ell(0.60, -0.44, 0.18, 0.26, 180, 360, 8).concat([[0.78, 0]])
  ]);
  def('n', 0.58, [
    [[0.06, -0.70], [0.06, 0]],
    ell(0.30, -0.44, 0.24, 0.27, 180, 360, 8).concat([[0.54, 0]])
  ]);
  def('o', 0.58, [ell(0.29, -0.37, 0.27, 0.36, 0, 360, 16)]);
  def('p', 0.58, [
    [[0.06, -0.70], [0.06, 0.28]],
    ell(0.32, -0.365, 0.26, 0.36, 270, 90, 12)
  ]);
  def('q', 0.58, [
    [[0.58, -0.70], [0.58, 0.28]],
    ell(0.32, -0.365, 0.26, 0.36, -90, 90, 12)
  ]);
  def('r', 0.42, [
    [[0.08, -0.70], [0.08, 0]],
    [[0.08, -0.46]].concat(circ(0.26, -0.50, 0.20, 180, 300, 8))
  ]);
  def('s', 0.50, [
    [[0.46, -0.68], [0.34, -0.72], [0.18, -0.68], [0.13, -0.58], [0.20, -0.50], [0.34, -0.46], [0.44, -0.40], [0.43, -0.28], [0.32, -0.22], [0.16, -0.24], [0.08, -0.30]]
  ]);
  def('t', 0.50, [
    [[0.24, -0.90], [0.24, -0.14]].concat(circ(0.40, -0.14, 0.16, 180, 90, 6)),
    [[0.08, -0.66], [0.44, -0.66]]
  ]);
  def('u', 0.58, [
    [[0.06, -0.72], [0.06, -0.24]].concat(circ(0.30, -0.24, 0.24, 180, 0, 8)).concat([[0.54, -0.72]]),
    [[0.54, -0.30], [0.54, 0]]
  ]);
  def('v', 0.60, [[[0.04, -0.72], [0.30, 0.02], [0.56, -0.72]]]);
  def('w', 0.84, [
    [[0.02, -0.72], [0.22, 0.02], [0.42, -0.50], [0.62, 0.02], [0.82, -0.72]]
  ]);
  def('x', 0.58, [
    [[0.06, -0.70], [0.52, 0.02]],
    [[0.52, -0.70], [0.06, 0.02]]
  ]);
  def('y', 0.60, [
    [[0.04, -0.72], [0.30, 0.02]],
    [[0.56, -0.72], [0.22, 0.30]]
  ]);
  def('z', 0.56, [[[0.06, -0.70], [0.50, -0.70], [0.06, 0], [0.50, 0]]]);

  // ---- digits ----
  def('0', 0.62, [ell(0.32, -0.5, 0.30, 0.5, 0, 360, 18)]);
  def('1', 0.50, [[[0.06, -0.78], [0.30, -1], [0.30, 0]]]);
  def('2', 0.60, [
    circ(0.32, -0.72, 0.28, 180, 360, 10).concat([[0.04, 0], [0.60, 0]])
  ]);
  def('3', 0.60, [
    ell(0.30, -0.74, 0.26, 0.26, -90, 90, 8).concat(
      ell(0.30, -0.26, 0.30, 0.22, -90, 110, 9))
  ]);
  def('4', 0.64, [
    [[0.44, 0], [0.44, -1], [0.04, -0.30], [0.60, -0.30]]
  ]);
  def('5', 0.60, [
    [[0.54, -1], [0.12, -1], [0.08, -0.50], [0.30, -0.44], [0.52, -0.48], [0.60, -0.30], [0.55, -0.10], [0.36, 0.01], [0.12, -0.04], [0.05, -0.16]]
  ]);
  def('6', 0.60, [
    [[0.52, -0.92], [0.36, -1], [0.14, -0.92], [0.05, -0.66], [0.06, -0.42]],
    ell(0.32, -0.26, 0.26, 0.26, 0, 360, 14)
  ]);
  def('7', 0.60, [
    [[0.04, -1], [0.60, -1], [0.26, 0.06]]
  ]);
  def('8', 0.62, [
    ell(0.32, -0.74, 0.24, 0.26, 0, 360, 12),
    ell(0.32, -0.27, 0.29, 0.27, 0, 360, 14)
  ]);
  def('9', 0.60, [
    ell(0.32, -0.74, 0.27, 0.26, 0, 360, 14),
    [[0.59, -0.70], [0.58, -0.42], [0.48, -0.12], [0.26, 0.02]]
  ]);

  // ---- punctuation / symbols ----
  def(' ', SPACE_W, []);
  def('.', 0.16, [[[0.03, 0], [0.09, 0]]]);
  def(',', 0.20, [[[0.10, 0.02], [0.04, 0.22]]]);
  def(':', 0.16, [
    [[0.03, -0.70], [0.09, -0.70]],
    [[0.03, -0.05], [0.09, -0.05]]
  ]);
  def(';', 0.20, [
    [[0.06, -0.70], [0.12, -0.70]],
    [[0.10, 0.02], [0.04, 0.22]]
  ]);
  def('!', 0.16, [
    [[0.06, -1], [0.06, -0.28]],
    [[0.03, -0.02], [0.09, -0.02]]
  ]);
  def('?', 0.60, [
    [[0.06, -0.86], [0.16, -1.0], [0.40, -1.02], [0.54, -0.88], [0.50, -0.70], [0.30, -0.56], [0.30, -0.36]],
    [[0.27, -0.06], [0.33, -0.06]]
  ]);
  def("'", 0.16, [[[0.08, -1], [0.06, -0.80]]]);
  def('"', 0.32, [
    [[0.08, -1], [0.06, -0.80]],
    [[0.24, -1], [0.22, -0.80]]
  ]);
  def('-', 0.58, [[[0.06, -0.42], [0.52, -0.42]]]);
  def('+', 0.58, [
    [[0.29, -0.72], [0.29, -0.12]],
    [[0.02, -0.42], [0.56, -0.42]]
  ]);
  def('=', 0.58, [
    [[0.04, -0.56], [0.54, -0.56]],
    [[0.04, -0.28], [0.54, -0.28]]
  ]);
  def('*', 0.58, [
    [[0.29, -0.90], [0.29, -0.50]],
    [[0.08, -0.78], [0.50, -0.62]],
    [[0.50, -0.78], [0.08, -0.62]]
  ]);
  def('/', 0.58, [[[0.04, 0.10], [0.54, -1.05]]]);
  def('\\', 0.58, [[[0.04, -1.05], [0.54, 0.10]]]);
  def('(', 0.42, [ell(0.30, -0.45, 0.28, 0.55, 115, 245, 10)]);
  def(')', 0.42, [ell(0.12, -0.45, 0.28, 0.55, -65, 65, 10)]);
  def('[', 0.42, [[[0.34, -1], [0.08, -1], [0.08, 0], [0.34, 0]]]);
  def(']', 0.42, [[[0.04, -1], [0.30, -1], [0.30, 0], [0.04, 0]]]);
  def('{', 0.46, [[[0.40, -1], [0.20, -1], [0.20, -0.50], [0.06, -0.45], [0.20, -0.40], [0.20, 0], [0.40, 0]]]);
  def('}', 0.46, [[[0.06, -1], [0.26, -1], [0.26, -0.50], [0.40, -0.45], [0.26, -0.40], [0.26, 0], [0.06, 0]]]);
  def('<', 0.56, [[[0.48, -0.85], [0.08, -0.45], [0.48, -0.05]]]);
  def('>', 0.56, [[[0.08, -0.85], [0.48, -0.45], [0.08, -0.05]]]);
  def('#', 0.56, [
    [[0.18, -1], [0.12, -0.10]],
    [[0.42, -1], [0.36, -0.10]],
    [[0.04, -0.72], [0.54, -0.72]],
    [[0.02, -0.35], [0.52, -0.35]]
  ]);
  def('$', 0.60, [
    [[0.56, -0.94], [0.42, -1], [0.22, -1], [0.09, -0.92], [0.07, -0.78], [0.16, -0.67], [0.33, -0.60], [0.50, -0.53], [0.57, -0.40], [0.56, -0.22], [0.44, -0.09], [0.26, -0.03], [0.10, -0.07], [0.04, -0.16]],
    [[0.30, -1.08], [0.30, 0.10]]
  ]);
  def('%', 0.60, [
    [[0.52, -1], [0.10, -0.06]],
    circ(0.14, -0.78, 0.11, 0, 360, 8),
    circ(0.48, -0.26, 0.11, 0, 360, 8)
  ]);
  def('&', 0.60, [
    [[0.52, -0.98], [0.30, -0.72], [0.08, -0.20], [0.10, -0.04], [0.24, -0.02], [0.52, -0.44], [0.16, -0.44], [0.08, -0.52], [0.10, -0.68], [0.26, -0.76], [0.44, -0.68]]
  ]);
  def('@', 0.68, [
    ell(0.30, -0.42, 0.16, 0.18, 0, 360, 12),
    ell(0.32, -0.48, 0.34, 0.52, 20, 340, 16)
  ]);
  def('_', 0.60, [[[0.02, 0.06], [0.56, 0.06]]]);
  def('|', 0.16, [[[0.06, -1], [0.06, 0.14]]]);
  def('^', 0.60, [[[0.06, -0.62], [0.30, -0.92], [0.54, -0.62]]]);
  def('~', 0.62, [[[0.04, -0.50], [0.14, -0.60], [0.28, -0.56], [0.40, -0.44], [0.52, -0.40], [0.58, -0.46]]]);
  def('`', 0.16, [[[0.06, -1.0], [0.10, -0.80]]]);

  /* ---- metrics ---------------------------------------------------------- */

  function glyphOf(ch) {
    return G[ch] || null;
  }

  function charAdvance(ch) {
    var g = G[ch];
    if (!g) return SPACE_W + CHAR_GAP;
    return g.w + CHAR_GAP;
  }

  // Total advance width of a string in em units (gap after last char removed)
  function measure(text) {
    var t = String(text == null ? '' : text);
    if (!t.length) return 0;
    var w = 0;
    for (var i = 0; i < t.length; i++) w += charAdvance(t[i]);
    return Math.max(0, w - CHAR_GAP);
  }

  /* ---- layout ----------------------------------------------------------- */

  // Expand degenerate polylines (dots) so they still draw: a two-point
  // polyline whose endpoints coincide gets a minimum-length second point.
  function expandDots(polys, minLen) {
    for (var i = 0; i < polys.length; i++) {
      var pl = polys[i];
      if (pl.length === 2 && pl[0][0] === pl[1][0] && pl[0][1] === pl[1][1]) {
        pl[1] = [pl[0][0] + minLen, pl[0][1]];
      }
      if (pl.length < 2) polys.splice(i--, 1);
    }
    return polys;
  }

  // Lay out `text` in world coordinates.
  //
  // opts:
  //   x, y       anchor position (mm), default 0,0
  //   size       cap height (mm), default 1
  //   angle      rotation degrees, canvas convention (positive = clockwise
  //              on screen because model space is y-down), default 0
  //   justify    'left' | 'center' | 'right' around the anchor, default 'center'
  //   vAlign     'middle' (default: anchor at half cap height) | 'baseline'
  //   dotMin     minimum drawn length for dot glyphs (mm), default 0.05
  //
  // Returns an array of polylines ([[x,y], ...]), each >= 2 points.
  function strokesFor(text, opts) {
    opts = opts || {};
    var str = String(text == null ? '' : text);
    if (!str.trim().length) return [];
    var size = Number(opts.size) > 0 ? Number(opts.size) : 1;
    var ax = Number(opts.x) || 0;
    var ay = Number(opts.y) || 0;
    var ang = ((Number(opts.angle) || 0)) * Math.PI / 180;
    var c = Math.cos(ang), s = Math.sin(ang);

    var totalW = measure(str) * size;
    var penX = 0;
    var just = opts.justify || 'center';
    if (just === 'left') penX = 0;
    else if (just === 'right') penX = -totalW;
    else penX = -totalW / 2;

    var vShift = (opts.vAlign === 'baseline') ? 0 : CAP / 2 * size;

    // Batch transform: pen advances left-to-right; every glyph point is
    // scaled to mm, shifted for vertical alignment, rotated about the
    // anchor with the same matrix order as the canvas renderer
    // (translate(x,y), rotate(angle), draw at local coords).
    var out = [];
    var px = penX;
    for (var ci = 0; ci < str.length; ci++) {
      var ch2 = str[ci];
      if (ch2 === ' ') { px += charAdvance(ch2) * size; continue; }
      var g2 = G[ch2];
      if (!g2) { px += charAdvance(ch2) * size; continue; }
      for (var pi = 0; pi < g2.s.length; pi++) {
        var src2 = g2.s[pi];
        var pl2 = new Array(src2.length);
        for (var ki = 0; ki < src2.length; ki++) {
          var lx = px + src2[ki][0] * size;
          var ly = src2[ki][1] * size + vShift;
          pl2[ki] = [
            ax + lx * c - ly * s,
            ay + lx * s + ly * c
          ];
        }
        out.push(pl2);
      }
      px += g2.w * size + CHAR_GAP * size;
    }
    return expandDots(out, opts.dotMin != null ? Number(opts.dotMin) : 0.05);
  }

  /* ---- exports ---------------------------------------------------------- */

  return {
    strokesFor: strokesFor,
    measure: measure,
    charAdvance: charAdvance,
    glyphOf: glyphOf,
    glyphCount: Object.keys(G).length,
    CAP: CAP, XH: XH, DESC: DESC, CHAR_GAP: CHAR_GAP, DEFAULT_W: DEFAULT_W
  };
});
