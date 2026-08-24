/* KipadRoute — pure 45°-constrained routing geometry for the PCB editor.
 * UMD: works in node (tests) and browser (app parts + render.js).
 *
 * KiCad-style track preview: every segment is horizontal, vertical or exactly 45°.
 *
 * elbow(p1, p2, posture) -> array of points after p1 through p2 (p1 excluded, p2 included)
 *   posture 'diag'    : 45° diagonal leaves p1, axis-straight finishes into p2
 *   posture 'straight': axis-straight leaves p1, 45° diagonal arrives into p2
 *   Targets already axis-aligned or exact-45 collapse to [p2].
 * cleanup(pts, eps)    -> new point list: consecutive duplicates dropped, collinear
 *   runs merged (corners kept). Safe on short/degenerate input.
 * isAllowed(p1, p2, eps) -> true when the segment is H/V/45 within tolerance.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KipadRoute = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;

  function sgn(v) { return v > EPS ? 1 : (v < -EPS ? -1 : 0); }

  function elbow(p1, p2, posture) {
    var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    var adx = Math.abs(dx), ady = Math.abs(dy);
    // already H / V / 45 — nothing to bend
    if (adx < EPS || ady < EPS || Math.abs(adx - ady) < EPS) return [p2];
    var d = Math.min(adx, ady);
    var sx = sgn(dx), sy = sgn(dy);
    var e = (posture === 'straight')
      ? [p2[0] - sx * d, p2[1] - sy * d]   // straight first, diagonal into p2
      : [p1[0] + sx * d, p1[1] + sy * d];  // diagonal first, straight into p2
    return [e, p2];
  }

  function isAllowed(p1, p2, eps) {
    var t = (typeof eps === 'number' && eps >= 0) ? eps : 1e-6;
    var dx = Math.abs(p2[0] - p1[0]), dy = Math.abs(p2[1] - p1[1]);
    return dx < t || dy < t || Math.abs(dx - dy) < t;
  }

  function close(a, b, eps) {
    var t = typeof eps === 'number' ? eps : 1e-6;
    return Math.abs(a[0] - b[0]) < t && Math.abs(a[1] - b[1]) < t;
  }

  function cleanup(pts, eps) {
    if (!pts || pts.length === 0) return [];
    var out = [[pts[0][0], pts[0][1]]];
    for (var i = 1; i < pts.length; i++) {
      if (!close(out[out.length - 1], pts[i], eps)) out.push([pts[i][0], pts[i][1]]);
    }
    // merge collinear triples: cross product ~ 0 relative to segment lengths
    var changed = true;
    while (changed && out.length > 2) {
      changed = false;
      for (var j = 1; j < out.length - 1; j++) {
        var a = out[j - 1], b = out[j], c = out[j + 1];
        var abx = b[0] - a[0], aby = b[1] - a[1];
        var bcx = c[0] - b[0], bcy = c[1] - b[1];
        var cross = abx * bcy - aby * bcx;
        var l1 = Math.hypot(abx, aby), l2 = Math.hypot(bcx, bcy);
        if (l1 * l2 === 0 || Math.abs(cross) / (l1 * l2) < 1e-9) {
          out.splice(j, 1);
          changed = true;
          j--; // stay in place, re-test with new neighbour
        }
      }
    }
    return out;
  }

  return { elbow: elbow, cleanup: cleanup, isAllowed: isAllowed };
});
