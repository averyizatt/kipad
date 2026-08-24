/* KipadMultisel — pure group-selection operations for the PCB editor.
   UMD, no dependencies: operates directly on plain board objects so tests
   can build minimal boards by hand. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KipadMultisel = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // kinds that participate in group move/rotate. Zones are selectable and
  // deletable but immovable — KiCad pours are refilled, never dragged.
  const MOVABLE = { footprint: true, text: true, track: true, via: true };

  // ---------- selection set (pure) ----------
  // A selection is a plain array of {id, kind}; callers own ordering.
  function toggle(sel, id, kind) {
    const i = sel.findIndex(s => s.id === id);
    if (i >= 0) return sel.slice(0, i).concat(sel.slice(i + 1));
    return sel.concat([{ id: id, kind: kind }]);
  }
  function has(sel, id) { return sel.some(s => s.id === id); }

  function rot(x, y, deg) {
    const r = deg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [x * c - y * s, x * s + y * c];
  }

  // ---------- geometry ----------
  // World anchor points of one member (for bounds / rotate centre).
  function itemPoints(board, it) {
    if (!it) return [];
    if (it.kind === 'footprint') {
      const fp = (board.footprints || []).find(f => f.id === it.id);
      if (!fp) return [];
      const pts = [[fp.at[0], fp.at[1]]];
      for (const p of fp.pads || []) pts.push([p.at[0], p.at[1]]);
      return pts;
    }
    if (it.kind === 'text') {
      const t = (board.texts || []).find(x => x.id === it.id);
      return t ? [[t.at[0], t.at[1]]] : [];
    }
    if (it.kind === 'track') {
      const t = (board.tracks || []).find(x => x.id === it.id);
      return t ? [[t.start[0], t.start[1]], [t.end[0], t.end[1]]] : [];
    }
    if (it.kind === 'via') {
      const v = (board.vias || []).find(x => x.id === it.id);
      return v ? [[v.at[0], v.at[1]]] : [];
    }
    return [];
  }

  function bounds(board, sel) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of sel) {
      for (const p of itemPoints(board, it)) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
    }
    if (!isFinite(minX)) return null;
    return { min: [minX, minY], max: [maxX, maxY], center: [(minX + maxX) / 2, (minY + maxY) / 2] };
  }

  // ---------- group transforms ----------
  // Shift every movable member by the same delta (mm). Missing ids are
  // skipped silently; returns the number of items actually moved.
  function moveItems(board, sel, dx, dy) {
    let n = 0;
    for (const it of sel) {
      if (!it || !MOVABLE[it.kind]) continue;
      if (it.kind === 'footprint') {
        const fp = (board.footprints || []).find(f => f.id === it.id);
        if (!fp) continue;
        fp.at = [fp.at[0] + dx, fp.at[1] + dy];
        for (const p of fp.pads || []) p.at = [p.at[0] + dx, p.at[1] + dy];
        n++;
      } else if (it.kind === 'text') {
        const t = (board.texts || []).find(x => x.id === it.id);
        if (!t) continue;
        t.at = [t.at[0] + dx, t.at[1] + dy];
        n++;
      } else if (it.kind === 'track') {
        const t = (board.tracks || []).find(x => x.id === it.id);
        if (!t) continue;
        t.start = [t.start[0] + dx, t.start[1] + dy];
        t.end = [t.end[0] + dx, t.end[1] + dy];
        n++;
      } else if (it.kind === 'via') {
        const v = (board.vias || []).find(x => x.id === it.id);
        if (!v) continue;
        v.at = [v.at[0] + dx, v.at[1] + dy];
        n++;
      }
    }
    return n;
  }

  // Rotate every movable member about `center` as a block: positions orbit
  // the centre AND each footprint/text spins by deltaDeg (KiCad R behaviour).
  function rotateItems(board, sel, center, deltaDeg) {
    let n = 0;
    for (const it of sel) {
      if (!it || !MOVABLE[it.kind]) continue;
      if (it.kind === 'footprint') {
        const fp = (board.footprints || []).find(f => f.id === it.id);
        if (!fp) continue;
        // orbit the anchor about the group centre, then rebuild pad world
        // positions from the ORIGINAL local offsets spun once — never
        // translate pads first (that would rotate their offsets twice)
        const [rx, ry] = rot(fp.at[0] - center[0], fp.at[1] - center[1], deltaDeg);
        const nx = center[0] + rx, ny = center[1] + ry;
        for (const p of fp.pads || []) {
          const [lx, ly] = rot(p.at[0] - fp.at[0], p.at[1] - fp.at[1], deltaDeg);
          p.at = [nx + lx, ny + ly];
          p.angle = ((p.angle || 0) + deltaDeg) % 360;
        }
        fp.at = [nx, ny];
        fp.angle = ((fp.angle || 0) + deltaDeg) % 360;
        n++;
      } else if (it.kind === 'text') {
        const t = (board.texts || []).find(x => x.id === it.id);
        if (!t) continue;
        const [rx, ry] = rot(t.at[0] - center[0], t.at[1] - center[1], deltaDeg);
        t.at = [center[0] + rx, center[1] + ry];
        t.angle = ((t.angle || 0) + deltaDeg) % 360;
        n++;
      } else if (it.kind === 'track') {
        const t = (board.tracks || []).find(x => x.id === it.id);
        if (!t) continue;
        const [sx, sy] = rot(t.start[0] - center[0], t.start[1] - center[1], deltaDeg);
        const [ex, ey] = rot(t.end[0] - center[0], t.end[1] - center[1], deltaDeg);
        t.start = [center[0] + sx, center[1] + sy];
        t.end = [center[0] + ex, center[1] + ey];
        n++;
      } else if (it.kind === 'via') {
        const v = (board.vias || []).find(x => x.id === it.id);
        if (!v) continue;
        const [rx, ry] = rot(v.at[0] - center[0], v.at[1] - center[1], deltaDeg);
        v.at = [center[0] + rx, center[1] + ry];
        n++;
      }
    }
    return n;
  }

  // Partition a selection into per-collection id lists that exist on the
  // board right now (zones included). Unknown/stale ids are dropped.
  function deletePlan(board, sel) {
    const plan = { footprints: [], tracks: [], vias: [], texts: [], zones: [] };
    for (const it of sel) {
      if (!it || !it.id) continue;
      switch (it.kind) {
        case 'footprint':
          if ((board.footprints || []).some(f => f.id === it.id)) plan.footprints.push(it.id);
          break;
        case 'track':
          if ((board.tracks || []).some(t => t.id === it.id)) plan.tracks.push(it.id);
          break;
        case 'via':
          if ((board.vias || []).some(v => v.id === it.id)) plan.vias.push(it.id);
          break;
        case 'text':
          if ((board.texts || []).some(t => t.id === it.id)) plan.texts.push(it.id);
          break;
        case 'zone':
          if ((board.zones || []).some(z => z.id === it.id)) plan.zones.push(it.id);
          break;
      }
    }
    return plan;
  }

  return {
    MOVABLE: MOVABLE,
    toggle: toggle,
    has: has,
    itemPoints: itemPoints,
    bounds: bounds,
    moveItems: moveItems,
    rotateItems: rotateItems,
    deletePlan: deletePlan
  };
}));
