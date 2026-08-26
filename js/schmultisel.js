/* KipadSchMultisel — pure multi-selection geometry and group operations for
   schematic objects. A selection is [{id, kind}], where kind is symbol,
   wire, label, junction, or noconn. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KipadSchMultisel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function has(sel, id) { return (sel || []).some(function (it) { return it.id === id; }); }
  function toggle(sel, id, kind) {
    var i = (sel || []).findIndex(function (it) { return it.id === id; });
    if (i >= 0) return sel.slice(0, i).concat(sel.slice(i + 1));
    return (sel || []).concat([{ id: id, kind: kind }]);
  }
  function rotatePoint(p, center, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    var x = p[0] - center[0], y = p[1] - center[1];
    return [center[0] + x * c - y * s, center[1] + x * s + y * c];
  }
  function collection(sch, kind) {
    return kind === 'symbol' ? sch.symbols : kind === 'wire' ? sch.wires :
      kind === 'label' ? sch.labels : kind === 'junction' ? sch.junctions :
      kind === 'noconn' ? sch.noConnects : null;
  }
  function findItem(sch, it) {
    var list = it && collection(sch, it.kind);
    return list ? list.find(function (x) { return x.id === it.id; }) : null;
  }
  function pointsOf(sch, it) {
    var x = findItem(sch, it);
    if (!x) return [];
    if (it.kind === 'wire') return (x.pts || []).map(function (p) { return [p[0], p[1]]; });
    return x.at ? [[x.at[0], x.at[1]]] : [];
  }
  function bounds(sch, sel) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (sel || []).forEach(function (it) {
      pointsOf(sch, it).forEach(function (p) {
        minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
      });
    });
    if (!isFinite(minX)) return null;
    return { min: [minX, minY], max: [maxX, maxY], center: [(minX + maxX) / 2, (minY + maxY) / 2] };
  }
  function moveItems(sch, sel, dx, dy) {
    var n = 0;
    (sel || []).forEach(function (it) {
      var x = findItem(sch, it);
      if (!x) return;
      if (it.kind === 'wire') x.pts = x.pts.map(function (p) { return [p[0] + dx, p[1] + dy]; });
      else x.at = [x.at[0] + dx, x.at[1] + dy];
      n++;
    });
    return n;
  }
  function rotateItems(sch, sel, center, deg) {
    var n = 0;
    (sel || []).forEach(function (it) {
      var x = findItem(sch, it);
      if (!x) return;
      if (it.kind === 'wire') x.pts = x.pts.map(function (p) { return rotatePoint(p, center, deg); });
      else x.at = rotatePoint(x.at, center, deg);
      if (it.kind === 'symbol' || it.kind === 'label') x.angle = ((x.angle || 0) + deg) % 360;
      n++;
    });
    return n;
  }
  function deletePlan(sch, sel) {
    var plan = { symbols: [], wires: [], labels: [], junctions: [], noConnects: [] };
    var key = { symbol: 'symbols', wire: 'wires', label: 'labels', junction: 'junctions', noconn: 'noConnects' };
    (sel || []).forEach(function (it) {
      var k = it && key[it.kind];
      if (k && findItem(sch, it)) plan[k].push(it.id);
    });
    return plan;
  }
  function segIntersectsRect(a, b, r) {
    var t0 = 0, t1 = 1, dx = b[0] - a[0], dy = b[1] - a[1];
    var p = [-dx, dx, -dy, dy];
    var q = [a[0] - r.minX, r.maxX - a[0], a[1] - r.minY, r.maxY - a[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      var t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  function symbolPoints(sym, getSymbol) {
    var pts = [[sym.at[0], sym.at[1]]], def = getSymbol ? getSymbol(sym.libId) : null;
    if (!def) return pts;
    var r = (sym.angle || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    function add(p) { pts.push([sym.at[0] + p[0] * c - p[1] * s, sym.at[1] + p[0] * s + p[1] * c]); }
    (def.graphics || []).forEach(function (g) {
      if (g.start) add(g.start); if (g.end) add(g.end); if (g.center) add(g.center);
      (g.pts || []).forEach(add);
    });
    (def.pins || []).forEach(function (p) { add(p.at); });
    return pts;
  }
  function symbolBox(sym, getSymbol) {
    var pts = symbolPoints(sym, getSymbol), xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    return { minX: Math.min.apply(null, xs), minY: Math.min.apply(null, ys), maxX: Math.max.apply(null, xs), maxY: Math.max.apply(null, ys) };
  }
  function overlaps(a, b) { return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY; }
  function collectInRect(sch, rect, getSymbol) {
    if (!rect) return [];
    var r = { minX: Math.min(rect.minX, rect.maxX), minY: Math.min(rect.minY, rect.maxY), maxX: Math.max(rect.minX, rect.maxX), maxY: Math.max(rect.minY, rect.maxY) };
    var inside = function (p) { return p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY; };
    var out = [];
    (sch.symbols || []).forEach(function (x) { if (overlaps(symbolBox(x, getSymbol), r)) out.push({ id: x.id, kind: 'symbol' }); });
    (sch.wires || []).forEach(function (x) {
      for (var i = 0; i + 1 < x.pts.length; i++) if (segIntersectsRect(x.pts[i], x.pts[i + 1], r)) { out.push({ id: x.id, kind: 'wire' }); break; }
    });
    (sch.labels || []).forEach(function (x) { if (inside(x.at)) out.push({ id: x.id, kind: 'label' }); });
    (sch.junctions || []).forEach(function (x) { if (inside(x.at)) out.push({ id: x.id, kind: 'junction' }); });
    (sch.noConnects || []).forEach(function (x) { if (inside(x.at)) out.push({ id: x.id, kind: 'noconn' }); });
    return out;
  }
  function hitTest(sch, x, y, tol, getSymbol) {
    var p = [x, y], i, a, d;
    for (i = (sch.noConnects || []).length - 1; i >= 0; i--) if (Math.hypot(sch.noConnects[i].at[0] - x, sch.noConnects[i].at[1] - y) <= tol) return { id: sch.noConnects[i].id, kind: 'noconn', anchor: sch.noConnects[i].at };
    for (i = (sch.symbols || []).length - 1; i >= 0; i--) {
      var box = symbolBox(sch.symbols[i], getSymbol);
      if (x >= box.minX - tol && x <= box.maxX + tol && y >= box.minY - tol && y <= box.maxY + tol) return { id: sch.symbols[i].id, kind: 'symbol', anchor: sch.symbols[i].at };
    }
    for (i = (sch.labels || []).length - 1; i >= 0; i--) if (Math.hypot(sch.labels[i].at[0] - x, sch.labels[i].at[1] - y) <= tol) return { id: sch.labels[i].id, kind: 'label', anchor: sch.labels[i].at };
    for (i = (sch.junctions || []).length - 1; i >= 0; i--) if (Math.hypot(sch.junctions[i].at[0] - x, sch.junctions[i].at[1] - y) <= tol) return { id: sch.junctions[i].id, kind: 'junction', anchor: sch.junctions[i].at };
    for (i = (sch.wires || []).length - 1; i >= 0; i--) {
      for (var k = 0; k + 1 < sch.wires[i].pts.length; k++) {
        a = sch.wires[i].pts[k]; var b = sch.wires[i].pts[k + 1];
        var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        var t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
        d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
        if (d <= tol) return { id: sch.wires[i].id, kind: 'wire', anchor: [a[0] + t * dx, a[1] + t * dy] };
      }
    }
    return null;
  }
  return { has: has, toggle: toggle, bounds: bounds, moveItems: moveItems, rotateItems: rotateItems,
    deletePlan: deletePlan, segIntersectsRect: segIntersectsRect, collectInRect: collectInRect, hitTest: hitTest };
}));
