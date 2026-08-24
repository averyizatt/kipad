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
 *
 * Track width / via size choice helpers (back the toolbar comboboxes):
 * widthChoices(classWidth, presets)  -> ascending unique width list, class default included
 * viaChoices(clsSize, clsDrill, ps)  -> ascending unique {size,drill} list; on a size clash the
 *                                       class pair wins (its drill is authoritative)
 * resolveTrackWidth(override, clsW)  -> override (>0 number) or classWidth
 * resolveVia(override, cls)          -> override {size,drill} or the class pair
 *
 * Via-in-route (layer switching while routing):
 * toggleRouteVia(route, size, drill) -> adds/removes a via marker on the route's last point and
 *                                       flips route.layer accordingly; mutates + returns route.
 *   Route model: {pts:[[x,y]..], layer0:'F.Cu', layer:<current>, vias:[{idx,size,drill}..]}
 *   A via at point idx means: segments leaving points >= idx are on the flipped layer.
 * currentLayer(layer0, vias)         -> layer after applying all via flips (F.Cu <-> B.Cu).
 * cleanupRouted(pts, vias, eps)      -> cleanup() that never merges away a via point; duplicate
 *                                       points merge keeping the via flag. Returns {pts, vias}
 *                                       with vias re-indexed onto the cleaned list.
 * commitPlan(route, eps)             -> finished-route commit plan:
 *   null when fewer than two usable points, else
 *   {segments:[{a,b,width,layer}], vias:[{at,size,drill}]} — per-segment layers applied,
 *   stale vias (idx past the last point) dropped, geometry cleaned via cleanupRouted.
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

  // ---- via-in-route support -------------------------------------------------

  function flipLayer(l) { return l === 'F.Cu' ? 'B.Cu' : 'F.Cu'; }

  function currentLayer(layer0, vias) {
    var l = layer0 === 'B.Cu' ? 'B.Cu' : 'F.Cu';
    var n = Array.isArray(vias) ? vias.length : 0;
    for (var i = 0; i < n; i++) l = flipLayer(l);
    return l;
  }

  // Toggle a via on the route's last point: add one (flipping the drawing layer)
  // or remove an existing one there (flipping back). Mutates + returns `route`.
  function toggleRouteVia(route, size, drill) {
    if (!route || !Array.isArray(route.pts) || !route.pts.length) return route;
    if (!route.layer0) route.layer0 = route.layer || 'F.Cu';
    if (!Array.isArray(route.vias)) route.vias = [];
    var last = route.pts.length - 1;
    for (var i = 0; i < route.vias.length; i++) {
      if (route.vias[i].idx === last) {
        route.vias.splice(i, 1);
        route.layer = currentLayer(route.layer0, route.vias);
        return route;
      }
    }
    route.vias.push({ idx: last, size: size, drill: drill });
    route.layer = currentLayer(route.layer0, route.vias);
    return route;
  }

  // via lookup by point index (null when absent)
  function viaAtIdx(vias, idx) {
    if (!Array.isArray(vias)) return null;
    for (var i = 0; i < vias.length; i++) if (vias[i].idx === idx) return vias[i];
    return null;
  }

  // cleanup() that protects via markers: consecutive duplicates merge (the
  // survivor keeps the via flag), collinear middles are only removed when they
  // carry no via. Vias come back re-indexed onto the cleaned point list.
  function cleanupRouted(pts, vias, eps) {
    if (!pts || pts.length === 0) return { pts: [], vias: [] };
    var out = []; // [{x,y,via}]
    for (var i = 0; i < pts.length; i++) {
      var v = viaAtIdx(vias, i);
      if (out.length && close(out[out.length - 1], pts[i], eps)) {
        if (v && !out[out.length - 1].via) out[out.length - 1].via = v;
        continue;
      }
      out.push({ x: pts[i][0], y: pts[i][1], via: v });
    }
    var changed = true;
    while (changed && out.length > 2) {
      changed = false;
      for (var j = 1; j < out.length - 1; j++) {
        if (out[j].via) continue;
        var a = out[j - 1], b = out[j], c = out[j + 1];
        var abx = b.x - a.x, aby = b.y - a.y, bcx = c.x - b.x, bcy = c.y - b.y;
        var cross = abx * bcy - aby * bcx;
        var l1 = Math.hypot(abx, aby), l2 = Math.hypot(bcx, bcy);
        if (l1 * l2 === 0 || Math.abs(cross) / (l1 * l2) < 1e-9) {
          out.splice(j, 1);
          changed = true;
          j--;
        }
      }
    }
    var pts2 = [], vias2 = [];
    for (var k = 0; k < out.length; k++) {
      pts2.push([out[k].x, out[k].y]);
      if (out[k].via) vias2.push({ idx: k, size: out[k].via.size, drill: out[k].via.drill });
    }
    return { pts: pts2, vias: vias2 };
  }

  // Build everything finishRoute needs in one pure call.
  function commitPlan(route, eps) {
    if (!route || !Array.isArray(route.pts)) return null;
    var layer0 = route.layer0 || route.layer || 'F.Cu';
    var cl = cleanupRouted(route.pts, Array.isArray(route.vias) ? route.vias : [], eps);
    if (cl.pts.length < 2) return null;
    var segments = [], vias = [];
    for (var s = 0; s < cl.pts.length - 1; s++) {
      var via = viaAtIdx(cl.vias, s); // via AT this point flips the layer from here on
      if (via) layer0 = flipLayer(layer0);
      segments.push({ a: [cl.pts[s][0], cl.pts[s][1]], b: [cl.pts[s + 1][0], cl.pts[s + 1][1]], width: route.width, layer: layer0 });
    }
    for (var q = 0; q < cl.vias.length; q++) {
      var vq = cl.vias[q], p = cl.pts[vq.idx];
      vias.push({ at: [p[0], p[1]], size: vq.size, drill: vq.drill });
    }
    return { segments: segments, vias: vias };
  }

  function widthChoices(classWidth, presets) {
    var out = [];
    var all = (typeof classWidth === 'number' && classWidth > 0 ? [classWidth] : [])
      .concat(Array.isArray(presets) ? presets : []);
    for (var i = 0; i < all.length; i++) {
      var w = Number(all[i]);
      if (!(w > 0)) continue;
      if (out.indexOf(w) < 0) out.push(w);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function viaChoices(classSize, classDrill, presets) {
    var bySize = {};
    var sizes = [];
    function add(size, drill) {
      if (!(size > 0)) return;
      var s = Number(size);
      if (!(s in bySize)) { bySize[s] = { size: s, drill: drill > 0 && drill < s ? Number(drill) : null }; sizes.push(s); }
    }
    add(classSize, classDrill); // class pair first so it wins size clashes
    if (Array.isArray(presets)) for (var i = 0; i < presets.length; i++) add(presets[i][0], presets[i][1]);
    // fill missing drills with half the ring (KiCad-ish default when unset)
    for (var j = 0; j < sizes.length; j++) {
      var c = bySize[sizes[j]];
      if (c.drill == null) c.drill = Math.round(c.size / 2 * 100) / 100;
    }
    sizes.sort(function (a, b) { return a - b; });
    return sizes.map(function (s) { return bySize[s]; });
  }

  function resolveTrackWidth(override, classWidth) {
    return (typeof override === 'number' && override > 0) ? override : classWidth;
  }

  function resolveVia(override, cls) {
    if (override && override.size > 0) {
      var drill = (override.drill > 0 && override.drill < override.size) ? override.drill : null;
      if (drill == null) drill = Math.max(0.1, Math.round(override.size / 2 * 100) / 100);
      return { size: override.size, drill: drill };
    }
    var c = cls || {};
    return { size: c.viaSize, drill: c.viaDrill };
  }

  return {
    elbow: elbow, cleanup: cleanup, isAllowed: isAllowed,
    widthChoices: widthChoices, viaChoices: viaChoices,
    resolveTrackWidth: resolveTrackWidth, resolveVia: resolveVia,
    toggleRouteVia: toggleRouteVia, currentLayer: currentLayer,
    cleanupRouted: cleanupRouted, commitPlan: commitPlan
  };
});
