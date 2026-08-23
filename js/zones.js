'use strict';

/**
 * KipadZones — copper zone (pour) fill engine for the PCB editor.
 *
 * Pure logic, no DOM. UMD: browser global `KipadZones` / CommonJS.
 *
 * KiCad-style solid fill via a raster flood algorithm:
 *   1. lay a square grid (default 0.25 mm, configurable) over the zone's
 *      bounding box padded by the clearance + largest copper radius
 *   2. a cell is a candidate when its centre is inside zone.outline
 *   3. a candidate is BLOCKED when it sits within the zone's clearance of
 *      opposite-net copper (pads / tracks / vias / other zones); same-net
 *      copper never blocks (the pour merges with it)
 *   4. the fill floods (4-neighbour) from candidate cells that touch
 *      same-net copper — regions with no same-net copper stay unfilled,
 *      exactly like KiCad's disconnected-island behaviour
 *
 * fillZone(zone, ctx, opts) ->
 *   { cellSize, ox, oy, cols, rows, runs: [[row, colStart, colEnd], ...],
 *     area, filled }
 * runs are inclusive column spans on one grid row; the world rect of a run:
 *   x = ox + colStart*cellSize .. ox + (colEnd+1)*cellSize  (same for y/row).
 * zone: { net (name), layer, outline: [{x,y}] closed ring, clearance?,
 *         minArea?, cellSize? }.
 * ctx : { pads: [{x,y,w,h,net}], tracks: [{ax,ay,bx,by,r,net}],
 *         vias: [{x,y,r,net}], zones?: [{outline, net}] (other zones, same
 *         layer), netClassOf(netName) -> {clearance} }.
 * A zone.clearance override always wins over the net class value.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadZones = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_CELL = 0.25;     // mm — grid resolution
  var DEFAULT_CLEARANCE = 0.2; // mm — Default net class clearance
  var EPS = 1e-7;

  function normPt(p) { return Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }; }

  function pointSegDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var l2 = dx * dx + dy * dy;
    var t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }

  // even-odd ray cast; points on an edge count as inside
  function pointInPolygon(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = normPt(poly[i]), b = normPt(poly[j]);
      if (pointSegDist(x, y, a.x, a.y, b.x, b.y) < EPS) return true;
      if ((a.y > y) !== (b.y > y)) {
        var xint = (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x;
        if (x < xint) inside = !inside;
      }
    }
    return inside;
  }

  // distance from a point to an axis-aligned rect (0 when inside)
  function rectDist(px, py, rc) {
    var dx = Math.max(rc.x - px, 0, px - (rc.x + rc.w));
    var dy = Math.max(rc.y - py, 0, py - (rc.y + rc.h));
    return Math.sqrt(dx * dx + dy * dy);
  }

  function polyEdgesDist(px, py, poly) {
    var best = Infinity;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = normPt(poly[i]), b = normPt(poly[j]);
      var d = pointSegDist(px, py, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    return best;
  }

  function emptyFill(cellSize) {
    return { cellSize: cellSize, ox: 0, oy: 0, cols: 0, rows: 0, runs: [], area: 0, filled: false };
  }

  function fillZone(zone, ctx, opts) {
    opts = opts || {};
    var cell = opts.cellSize || zone.cellSize || DEFAULT_CELL;
    var poly = (zone.outline || []).map(normPt);
    if (poly.length < 3) return emptyFill(cell);

    var clsFn = ctx && typeof ctx.netClassOf === 'function' ? ctx.netClassOf : function () { return {}; };
    var cls = clsFn(zone.net) || {};
    var clearance = zone.clearance != null && zone.clearance >= 0 ? zone.clearance
      : (cls.clearance != null ? cls.clearance : DEFAULT_CLEARANCE);
    var znet = zone.net || '';

    var pads = (ctx && ctx.pads) || [];
    var tracks = (ctx && ctx.tracks) || [];
    var vias = (ctx && ctx.vias) || [];
    var others = (ctx && ctx.zones) || [];   // other zones on this layer

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var maxR = clearance;
    var i;
    for (i = 0; i < poly.length; i++) {
      minX = Math.min(minX, poly[i].x); maxX = Math.max(maxX, poly[i].x);
      minY = Math.min(minY, poly[i].y); maxY = Math.max(maxY, poly[i].y);
    }
    for (i = 0; i < tracks.length; i++) maxR = Math.max(maxR, tracks[i].r || 0);
    for (i = 0; i < vias.length; i++) maxR = Math.max(maxR, vias[i].r || 0);
    minX -= maxR + cell * 2; minY -= maxR + cell * 2;
    maxX += maxR + cell * 2; maxY += maxR + cell * 2;

    var ox = Math.floor(minX / cell) * cell;
    var oy = Math.floor(minY / cell) * cell;
    var cols = Math.ceil((maxX - ox) / cell);
    var rows = Math.ceil((maxY - oy) / cell);

    var open = new Uint8Array(rows * cols);
    var seed = new Uint8Array(rows * cols);
    var touch = cell * 1.01;  // a cell "touches" copper within one grid step

    // pre-normalize other-zone outlines once
    var otherPolys = [];
    for (i = 0; i < others.length; i++) {
      var op = (others[i].outline || []).map(normPt);
      if (op.length >= 3) otherPolys.push({ poly: op, net: others[i].net || '' });
    }

    function blockedAt(x, y) {
      var k, it, d;
      for (k = 0; k < pads.length; k++) {
        it = pads[k];
        if ((it.net || '') === znet) continue;
        if (rectDist(x, y, it) < clearance) return true;
      }
      for (k = 0; k < tracks.length; k++) {
        it = tracks[k];
        if ((it.net || '') === znet) continue;
        d = pointSegDist(x, y, it.ax, it.ay, it.bx, it.by) - (it.r || 0);
        if (d < clearance) return true;
      }
      for (k = 0; k < vias.length; k++) {
        it = vias[k];
        if ((it.net || '') === znet) continue;
        d = Math.hypot(x - it.x, y - it.y) - (it.r || 0);
        if (d < clearance) return true;
      }
      for (k = 0; k < otherPolys.length; k++) {
        var oz = otherPolys[k];
        if (oz.net === znet) continue;
        if (pointInPolygon(x, y, oz.poly) || polyEdgesDist(x, y, oz.poly) < clearance) return true;
      }
      return false;
    }

    function touchesSameNet(x, y) {
      var k, it, d;
      for (k = 0; k < pads.length; k++) {
        it = pads[k];
        if ((it.net || '') !== znet) continue;
        if (rectDist(x, y, it) <= touch) return true;
      }
      for (k = 0; k < tracks.length; k++) {
        it = tracks[k];
        if ((it.net || '') !== znet) continue;
        d = pointSegDist(x, y, it.ax, it.ay, it.bx, it.by) - (it.r || 0);
        if (d <= touch) return true;
      }
      for (k = 0; k < vias.length; k++) {
        it = vias[k];
        if ((it.net || '') !== znet) continue;
        d = Math.hypot(x - it.x, y - it.y) - (it.r || 0);
        if (d <= touch) return true;
      }
      return false;
    }

    var idx, r, c, cx, cy;
    for (r = 0; r < rows; r++) {
      cy = oy + (r + 0.5) * cell;
      for (c = 0; c < cols; c++) {
        cx = ox + (c + 0.5) * cell;
        idx = r * cols + c;
        if (!pointInPolygon(cx, cy, poly)) continue;
        if (blockedAt(cx, cy)) continue;
        open[idx] = 1;
        if (touchesSameNet(cx, cy)) seed[idx] = 1;
      }
    }

    // flood fill (4-neighbour) from seeds over open cells
    var filled = new Uint8Array(rows * cols);
    var stack = [];
    function push(n) { if (open[n] && !filled[n]) { filled[n] = 1; stack.push(n); } }
    for (idx = 0; idx < seed.length; idx++) if (seed[idx]) { filled[idx] = 1; stack.push(idx); }
    while (stack.length) {
      idx = stack.pop();
      r = (idx / cols) | 0;
      c = idx - r * cols;
      if (c > 0) push(idx - 1);
      if (c < cols - 1) push(idx + 1);
      if (r > 0) push(idx - cols);
      if (r < rows - 1) push(idx + cols);
    }

    // horizontal run-length encode per row
    var runs = [], count = 0, startC = -1;
    for (r = 0; r < rows; r++) {
      startC = -1;
      for (c = 0; c <= cols; c++) {
        var on = c < cols && filled[r * cols + c] === 1;
        if (on && startC < 0) startC = c;
        else if (!on && startC >= 0) { runs.push([r, startC, c - 1]); count += c - startC; startC = -1; }
      }
    }

    var area = count * cell * cell;
    if (zone.minArea != null && area < zone.minArea) {
      return { cellSize: cell, ox: ox, oy: oy, cols: cols, rows: rows, runs: [], area: area, filled: false };
    }
    return { cellSize: cell, ox: ox, oy: oy, cols: cols, rows: rows, runs: runs, area: area, filled: count > 0 };
  }

  return {
    DEFAULT_CELL: DEFAULT_CELL,
    DEFAULT_CLEARANCE: DEFAULT_CLEARANCE,
    fillZone: fillZone,
    pointInPolygon: pointInPolygon,
    pointSegDist: pointSegDist,
    rectDist: rectDist,
    polyEdgesDist: polyEdgesDist
  };
});
