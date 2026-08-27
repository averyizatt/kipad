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
 * avoid(start, target, posture, obstacles, width) -> a collision-free 45-degree
 *   tail (start excluded), or null when no deterministic walk-around is found.
 *   Obstacles are circles `{at,radius,clearance}` or capsules
 *   `{a,b,radius,clearance}`. `width` is the routed track width; callers supply
 *   the effective net-pair clearance on each obstacle.
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

  // ---- clearance-aware walk-around routing --------------------------------

  function pointSegDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var den = dx * dx + dy * dy;
    if (!den) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  // Minimum distance between two finite segments (intersection naturally gives 0).
  function segSegDist(a, b, c, d) {
    function orient(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    function between(v, x, y) { return v >= Math.min(x, y) - EPS && v <= Math.max(x, y) + EPS; }
    var o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) &&
        ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) return 0;
    if (Math.abs(o1) <= EPS && between(c[0], a[0], b[0]) && between(c[1], a[1], b[1])) return 0;
    if (Math.abs(o2) <= EPS && between(d[0], a[0], b[0]) && between(d[1], a[1], b[1])) return 0;
    if (Math.abs(o3) <= EPS && between(a[0], c[0], d[0]) && between(a[1], c[1], d[1])) return 0;
    if (Math.abs(o4) <= EPS && between(b[0], c[0], d[0]) && between(b[1], c[1], d[1])) return 0;
    return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
  }

  function obstacleRadius(o, width) {
    return Math.max(0, Number(o.radius) || 0) + Math.max(0, Number(o.clearance) || 0) + Math.max(0, Number(width) || 0) / 2;
  }

  function segmentClear(a, b, obstacles, width) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i], r = obstacleRadius(o, width);
      var d = o.a && o.b ? segSegDist(a, b, o.a, o.b) : pointSegDist(o.at, a, b);
      if (d < r - 1e-7) return false;
    }
    return true;
  }

  function pathClear(pts, obstacles, width) {
    for (var i = 0; i < pts.length - 1; i++) if (!segmentClear(pts[i], pts[i + 1], obstacles, width)) return false;
    return true;
  }

  function pathLen(pts) {
    var n = 0;
    for (var i = 0; i < pts.length - 1; i++) n += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    return n;
  }

  function edgePath(a, b, preferred, obstacles, width) {
    var order = preferred === 'straight' ? ['straight', 'diag'] : ['diag', 'straight'];
    var best = null;
    for (var i = 0; i < order.length; i++) {
      var p = [a].concat(elbow(a, b, order[i]));
      if (!pathClear(p, obstacles, width)) continue;
      var len = pathLen(p);
      if (!best || len < best.len - EPS) best = { pts: p, len: len };
    }
    return best;
  }

  // Small deterministic visibility search around inflated obstacle bounding boxes.
  // This is obstacle avoidance, not push-and-shove: existing copper never moves.
  function avoid(start, target, posture, obstacles, width) {
    var obs = Array.isArray(obstacles) ? obstacles.filter(function (o) {
      return o && ((o.at && o.at.length >= 2) || (o.a && o.b));
    }) : [];
    var direct = [start].concat(elbow(start, target, posture));
    if (!obs.length || pathClear(direct, obs, width)) return direct.slice(1);

    // Keep pointer-move preview cost bounded on dense boards. The closest
    // obstacles include every direct blocker first (negative score). The final
    // result is still checked against the complete list, so the cap can only
    // decline a route in a crowded area; it can never admit an unsafe one.
    var relevant = obs.map(function (o, idx) {
      var best = Infinity;
      for (var si = 0; si < direct.length - 1; si++) {
        var dd = o.a && o.b ? segSegDist(direct[si], direct[si + 1], o.a, o.b)
                            : pointSegDist(o.at, direct[si], direct[si + 1]);
        best = Math.min(best, dd - obstacleRadius(o, width));
      }
      return { o: o, score: best, idx: idx };
    }).sort(function (a, b) { return a.score - b.score || a.idx - b.idx; })
      .slice(0, 16).map(function (x) { return x.o; });

    var nodes = [[start[0], start[1]], [target[0], target[1]]];
    var NUDGE = 1e-4;
    for (var i = 0; i < relevant.length; i++) {
      var o = relevant[i], r = obstacleRadius(o, width) + NUDGE;
      var x0, x1, y0, y1;
      if (o.a && o.b) {
        x0 = Math.min(o.a[0], o.b[0]) - r; x1 = Math.max(o.a[0], o.b[0]) + r;
        y0 = Math.min(o.a[1], o.b[1]) - r; y1 = Math.max(o.a[1], o.b[1]) + r;
      } else {
        x0 = o.at[0] - r; x1 = o.at[0] + r; y0 = o.at[1] - r; y1 = o.at[1] + r;
      }
      nodes.push([x0, y0], [x0, y1], [x1, y0], [x1, y1]);
    }

    var n = nodes.length, dist = new Array(n), prev = new Array(n), prevPath = new Array(n), used = new Array(n);
    for (var d = 0; d < n; d++) { dist[d] = Infinity; prev[d] = -1; used[d] = false; }
    dist[0] = 0;
    for (var step = 0; step < n; step++) {
      var u = -1;
      for (var q = 0; q < n; q++) if (!used[q] && (u < 0 || dist[q] < dist[u])) u = q;
      if (u < 0 || !isFinite(dist[u])) break;
      used[u] = true;
      if (u === 1) break;
      for (var v = 0; v < n; v++) {
        if (used[v] || v === u) continue;
        var ep = edgePath(nodes[u], nodes[v], posture, relevant, width);
        if (!ep) continue;
        var nd = dist[u] + ep.len;
        if (nd < dist[v] - EPS) { dist[v] = nd; prev[v] = u; prevPath[v] = ep.pts; }
      }
    }
    if (!isFinite(dist[1])) return null;
    var edges = [], at = 1;
    while (at !== 0) { edges.push(prevPath[at]); at = prev[at]; if (at < 0) return null; }
    edges.reverse();
    var out = [[start[0], start[1]]];
    for (var z = 0; z < edges.length; z++) for (var k = 1; k < edges[z].length; k++) out.push(edges[z][k]);
    out = cleanup(out);
    return pathClear(out, obs, width) ? out.slice(1) : null;
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
    elbow: elbow, cleanup: cleanup, isAllowed: isAllowed, avoid: avoid,
    widthChoices: widthChoices, viaChoices: viaChoices,
    resolveTrackWidth: resolveTrackWidth, resolveVia: resolveVia,
    toggleRouteVia: toggleRouteVia, currentLayer: currentLayer,
    cleanupRouted: cleanupRouted, commitPlan: commitPlan
  };
});
