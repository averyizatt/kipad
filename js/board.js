/* Kipad — board model, geometry, nets, DRC. Pure logic (no DOM). */
'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadBoard = factory();
})(typeof self !== 'undefined' ? self : this, function (root) {
  // root may be undefined in the CommonJS path; fall back to globalThis
  root = root || (typeof globalThis !== 'undefined' ? globalThis : this);

  const CLEARANCE_DEFAULT = 0.2; // mm (Default net class)
  const NETCLASS_DEFAULTS = { trackWidth: 0.25, clearance: 0.2, viaSize: 0.6, viaDrill: 0.3 };

  // ---------- geometry ----------
  function rot(x, y, deg) {
    const r = deg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [x * c - y * s, x * s + y * c];
  }
  function dist2(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }
  function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
    // distance between segments ab and cd
    const EPS = 1e-9;
    const r = [bx - ax, by - ay], s = [dx - cx, dy - cy];
    const rxs = r[0] * s[1] - r[1] * s[0];
    const qp = [cx - ax, cy - ay];
    if (Math.abs(rxs) < EPS) {
      // parallel: min of endpoint distances to other segment
      return Math.min(
        pointSegDist(ax, ay, cx, cy, dx, dy),
        pointSegDist(bx, by, cx, cy, dx, dy),
        pointSegDist(cx, cy, ax, ay, bx, by),
        pointSegDist(dx, dy, ax, ay, bx, by)
      );
    }
    const t = (qp[0] * s[1] - qp[1] * s[0]) / rxs;
    const u = (qp[0] * r[1] - qp[1] * r[0]) / rxs;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
    return Math.min(
      pointSegDist(ax, ay, cx, cy, dx, dy),
      pointSegDist(bx, by, cx, cy, dx, dy),
      pointSegDist(cx, cy, ax, ay, bx, by),
      pointSegDist(dx, dy, ax, ay, bx, by)
    );
  }
  function pointSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt(dist2(px, py, ax + t * dx, ay + t * dy));
  }

  // ---------- board factory ----------
  function makeBoard() {
    return {
      version: '20240108',
      nets: [{ id: 0, name: '' }],
      netClasses: [defaultNetClass()],
      zones: [],
      texts: [],
      footprints: [],
      tracks: [],
      vias: [],
      outline: []
    };
  }

  let _idc = 1;
  function newId(prefix) { return prefix + (_idc++); }

  // ---------- nets ----------
  function getNet(board, id) { return board.nets.find(n => n.id === id); }
  function netName(board, id) { const n = getNet(board, id); return n ? n.name : ''; }
  function addNet(board, name) {
    let n = board.nets.find(x => x.name === name && name !== '');
    if (n) return n.id;
    const id = board.nets.length;
    board.nets.push({ id, name });
    return id;
  }
  function ensureNet(board, name) { return addNet(board, name); }

  // ---------- net classes ----------
  // KiCad concept: every net belongs to a net class. The "Default" class
  // (id 0) always exists; classes carry track width, clearance, via size
  // and via drill. Nets store their class as net.classId (undefined = Default).
  function defaultNetClass() {
    return Object.assign({ id: 0, name: 'Default' }, NETCLASS_DEFAULTS);
  }
  function ensureNetClasses(board) {
    if (!Array.isArray(board.netClasses) || !board.netClasses.length) {
      // old boards (pre net-class) or foreign parsers: seed Default
      board.netClasses = [defaultNetClass()];
      for (const n of board.nets) n.classId = 0;
    } else if (!board.netClasses.some(c => c.id === 0)) {
      // defensive: Default must always be id 0 and first
      board.netClasses.unshift(defaultNetClass());
      for (const n of board.nets) if (n.classId != null) n.classId = 0;
    }
    return board.netClasses;
  }
  function addNetClass(board, name) {
    ensureNetClasses(board);
    let id = 0;
    for (const c of board.netClasses) if (c.id > id) id = c.id;
    const nc = Object.assign({ id: id + 1, name: (name && name.trim()) || ('Class ' + (id + 1)) }, NETCLASS_DEFAULTS);
    board.netClasses.push(nc);
    return nc.id;
  }
  function getNetClass(board, classId) {
    ensureNetClasses(board);
    return board.netClasses.find(c => c.id === classId) || board.netClasses[0];
  }
  function netClassOfNet(board, netId) {
    ensureNetClasses(board);
    const n = getNet(board, netId);
    if (n && n.classId != null) {
      const c = board.netClasses.find(x => x.id === n.classId);
      if (c) return c;
    }
    return board.netClasses[0];
  }
  function setNetClass(board, netId, classId) {
    ensureNetClasses(board);
    const n = getNet(board, netId);
    if (!n) return false;
    n.classId = board.netClasses.some(c => c.id === classId) ? classId : 0;
    return true;
  }
  function renameNetClass(board, classId, name) {
    ensureNetClasses(board);
    const c = board.netClasses.find(x => x.id === classId);
    if (!c) return false;
    c.name = (name && name.trim()) || c.name;
    return true;
  }
  function removeNetClass(board, classId) {
    ensureNetClasses(board);
    if (classId === 0) return false; // Default cannot be removed
    const idx = board.netClasses.findIndex(x => x.id === classId);
    if (idx < 0) return false;
    board.netClasses.splice(idx, 1);
    // nets in the removed class fall back to Default
    for (const n of board.nets) if (n.classId === classId) n.classId = 0;
    return true;
  }

  // ---------- footprints ----------
  function fpPadLocal(fpDef) {
    // fpDef from KipadFootprints.getFootprint: {pads:[{number,type,shape,at,size,drill,radius,layers}]}
    return fpDef.pads.map(p => ({ ...p }));
  }

  function placeFootprint(board, libName, at, angle, layer, refOverride) {
    const lib = (root.KipadFootprints || (typeof require !== 'undefined' ? require('./footprints.js') : null));
    if (!lib) throw new Error('KipadFootprints not loaded');
    const def = lib.getFootprint(libName);
    if (!def) throw new Error('Unknown footprint: ' + libName);

    // designator: count existing refs with same prefix
    const prefix = refOverride || def.ref || 'U';
    let n = 1;
    const used = new Set(board.footprints.map(f => f.ref));
    while (used.has(prefix + n)) n++;

    const fp = {
      id: newId('F'),
      lib: libName,
      ref: prefix + n,
      value: def.value || '',
      at: [at[0], at[1]],
      angle: angle || 0,
      layer: layer || 'F.Cu',
      pads: []
    };
    for (const p of def.pads) {
      const [lx, ly] = rot(p.at[0], p.at[1], fp.angle);
      fp.pads.push({
        number: p.number,
        type: p.type,
        shape: p.shape,
        at: [fp.at[0] + lx, fp.at[1] + ly],
        angle: (fp.angle + (p.angle || 0)) % 360,
        size: [p.size[0], p.size[1]],
        drill: p.drill != null ? p.drill : null,
        radius: p.radius != null ? p.radius : null,
        layers: p.layers.slice(),
        netId: 0
      });
    }
    board.footprints.push(fp);
    return fp;
  }

  function moveFootprint(board, fpId, at) {
    const fp = board.footprints.find(f => f.id === fpId);
    if (!fp) return;
    const dx = at[0] - fp.at[0], dy = at[1] - fp.at[1];
    fp.at = [at[0], at[1]];
    for (const p of fp.pads) { p.at = [p.at[0] + dx, p.at[1] + dy]; }
  }

  function rotateFootprint(board, fpId, deltaDeg) {
    const fp = board.footprints.find(f => f.id === fpId);
    if (!fp) return;
    const na = (fp.angle + deltaDeg) % 360;
    for (const p of fp.pads) {
      const [lx, ly] = rot(p.at[0] - fp.at[0], p.at[1] - fp.at[1], deltaDeg);
      p.at = [fp.at[0] + lx, fp.at[1] + ly];
      p.angle = (p.angle + deltaDeg) % 360;
    }
    fp.angle = na;
  }

  // ---------- zones (copper pours) ----------
  // v1 solid fill: the outline is a closed polygon of {x,y} points in world
  // mm; `net` is the net NAME, layer is 'F.Cu'|'B.Cu'. Fill geometry lives
  // outside the board model (KipadZones.fillZone), so undo snapshots and
  // localStorage JSON stay small.
  function addZone(board, opts) {
    if (!Array.isArray(board.zones)) board.zones = [];
    const z = {
      id: newId('Z'),
      net: (opts && opts.net) || '',
      layer: opts && opts.layer === 'B.Cu' ? 'B.Cu' : 'F.Cu',
      outline: ((opts && opts.outline) || []).map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y })
    };
    if (opts && opts.clearance != null) z.clearance = opts.clearance;
    if (opts && opts.minArea != null) z.minArea = opts.minArea;
    board.zones.push(z);
    return z;
  }
  function removeZone(board, zoneId) {
    if (!Array.isArray(board.zones)) return false;
    const i = board.zones.findIndex(z => z.id === zoneId);
    if (i < 0) return false;
    board.zones.splice(i, 1);
    return true;
  }
  function zonesOn(board, layer) {
    return (board.zones || []).filter(z => z.layer === layer);
  }

  // ---------- board text (silkscreen) ----------
  function addText(board, opts) {
    if (!Array.isArray(board.texts)) board.texts = [];
    opts = opts || {};
    const t = {
      id: newId('TXT'),
      text: String(opts.text == null ? 'Text' : opts.text),
      at: Array.isArray(opts.at) ? [opts.at[0], opts.at[1]] : [0, 0],
      layer: opts.layer === 'B.SilkS' ? 'B.SilkS' : 'F.SilkS',
      size: Math.max(0.1, Number(opts.size) || 1.5),
      thickness: Math.max(0.01, Number(opts.thickness) || 0.3),
      angle: ((Number(opts.angle) || 0) % 360 + 360) % 360,
      justify: opts.justify === 'left' || opts.justify === 'right' ? opts.justify : 'center'
    };
    board.texts.push(t);
    return t;
  }
  function removeText(board, textId) {
    if (!Array.isArray(board.texts)) return false;
    const i = board.texts.findIndex(t => t.id === textId);
    if (i < 0) return false;
    board.texts.splice(i, 1);
    return true;
  }
  function moveText(board, textId, at) {
    const t = (board.texts || []).find(x => x.id === textId);
    if (!t) return false;
    t.at = [at[0], at[1]];
    return true;
  }
  function hitText(board, x, y, tol) {
    const texts = board.texts || [];
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      const w = Math.max(t.size, String(t.text).length * t.size * 0.62) / 2 + (tol || 0);
      const h = t.size / 2 + (tol || 0);
      const p = rot(x - t.at[0], y - t.at[1], -(t.angle || 0));
      if (Math.abs(p[0]) <= w && Math.abs(p[1]) <= h) return t;
    }
    return null;
  }

  // ---------- tracks / vias ----------
  function addTrack(board, start, end, width, layer, netId) {
    const t = { id: newId('T'), start: [start[0], start[1]], end: [end[0], end[1]], width, layer, netId };
    board.tracks.push(t);
    return t;
  }
  function addVia(board, at, size, drill, netId) {
    const v = { id: newId('V'), at: [at[0], at[1]], size, drill, netId };
    board.vias.push(v);
    return v;
  }

  // ---------- hit testing (in mm) ----------
  function hitPad(board, x, y, tol) {
    for (const fp of board.footprints)
      for (const p of fp.pads) {
        const r = Math.max(p.size[0], p.size[1]) / 2 + tol;
        if (dist2(x, y, p.at[0], p.at[1]) <= r * r) return { fp, pad: p };
      }
    return null;
  }
  function hitFootprint(board, x, y, tol) {
    for (const fp of board.footprints) {
      // test any pad
      for (const p of fp.pads) {
        const r = Math.max(p.size[0], p.size[1]) / 2 + tol;
        if (dist2(x, y, p.at[0], p.at[1]) <= r * r) return fp;
      }
      // also test courtyard-ish box (fp origin area)
      const r0 = 1.5;
      if (dist2(x, y, fp.at[0], fp.at[1]) <= r0 * r0) return fp;
    }
    return null;
  }
  function hitTrack(board, x, y, tol) {
    for (const t of board.tracks) {
      if (pointSegDist(x, y, t.start[0], t.start[1], t.end[0], t.end[1]) <= t.width / 2 + tol) return t;
    }
    return null;
  }
  function hitVia(board, x, y, tol) {
    for (const v of board.vias) {
      if (Math.sqrt(dist2(x, y, v.at[0], v.at[1])) <= v.size / 2 + tol) return v;
    }
    return null;
  }

  // ---------- ratsnest ----------
  // Minimal spanning-ish: for each net, connect unconnected pad centers
  // (pads with no track on that net) using greedy nearest neighbor.
  function ratsnest(board) {
    const lines = [];
    const byNet = {};
    for (const fp of board.footprints)
      for (const p of fp.pads) {
        if (!byNet[p.netId]) byNet[p.netId] = [];
        byNet[p.netId].push(p);
      }
    for (const [netId, pads] of Object.entries(byNet)) {
      const id = Number(netId);
      if (id === 0 || pads.length < 2) continue;
      // has any track on this net?
      const routed = board.tracks.some(t => t.netId === id) || board.vias.some(v => v.netId === id);
      if (routed) continue;
      const pts = pads.map(p => p.at);
      const visited = new Array(pts.length).fill(false);
      visited[0] = true;
      let count = 1;
      while (count < pts.length) {
        let bestD = Infinity, bestI = -1, bestJ = -1;
        for (let i = 0; i < pts.length; i++) {
          if (!visited[i]) continue;
          for (let j = 0; j < pts.length; j++) {
            if (visited[j]) continue;
            const d = dist2(pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
            if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
          }
        }
        if (bestJ < 0) break;
        visited[bestJ] = true; count++;
        lines.push({ a: pts[bestI], b: pts[bestJ], netId: id });
      }
    }
    return lines;
  }

  // ---------- DRC ----------
  function copperItems(board, layer) {
    // returns [{kind, x?, y?, seg?, r?, netId, layer}]
    const items = [];
    for (const fp of board.footprints) {
      if (fp.layer !== layer) continue;
      for (const p of fp.pads) {
        if (p.layers[0] !== layer) continue;
        items.push({ kind: 'pad', x: p.at[0], y: p.at[1], r: Math.max(p.size[0], p.size[1]) / 2, netId: p.netId, layer });
      }
    }
    for (const t of board.tracks) {
      if (t.layer !== layer) continue;
      items.push({ kind: 'track', seg: [t.start, t.end], r: t.width / 2, netId: t.netId, layer });
    }
    for (const v of board.vias) {
      // via copper on both layers
      items.push({ kind: 'via', x: v.at[0], y: v.at[1], r: v.size / 2, netId: v.netId, layer });
    }
    return items;
  }
  function itemDist(a, b) {
    if (a.seg && b.seg) return segSegDist(a.seg[0][0], a.seg[0][1], a.seg[1][0], a.seg[1][1], b.seg[0][0], b.seg[0][1], b.seg[1][0], b.seg[1][1]) - a.r - b.r;
    if (a.seg) return pointSegDist(b.x, b.y, a.seg[0][0], a.seg[0][1], a.seg[1][0], a.seg[1][1]) - a.r - b.r;
    if (b.seg) return pointSegDist(a.x, a.y, b.seg[0][0], b.seg[0][1], b.seg[1][0], b.seg[1][1]) - a.r - b.r;
    return Math.sqrt(dist2(a.x, a.y, b.x, b.y)) - a.r - b.r;
  }
  function runDRC(board, clearanceOverride) {
    // clearanceOverride: optional explicit min clearance (mm) that replaces
    // per-net-class values — kept for backward compatibility. Otherwise the
    // required clearance between two items is the LARGER of the two classes'
    // clearances (KiCad rule).
    ensureNetClasses(board);
    const violations = [];
    for (const layer of ['F.Cu', 'B.Cu']) {
      const items = copperItems(board, layer);
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          if (a.netId !== 0 && a.netId === b.netId) continue; // same net OK
          const clsA = netClassOfNet(board, a.netId);
          const clsB = netClassOfNet(board, b.netId);
          const minCl = (clearanceOverride != null && clearanceOverride > 0)
            ? clearanceOverride
            : Math.max(clsA.clearance, clsB.clearance);
          const d = itemDist(a, b);
          if (d < minCl) {
            const mx = a.x != null ? a.x : (a.seg ? (a.seg[0][0] + a.seg[1][0]) / 2 : 0);
            const my = a.y != null ? a.y : (a.seg ? (a.seg[0][1] + a.seg[1][1]) / 2 : 0);
            violations.push({
              type: `${a.kind}-${b.kind}`,
              netA: netName(board, a.netId), netB: netName(board, b.netId),
              dist: Math.round(d * 1000) / 1000,
              clearance: minCl,
              classA: clsA.name, classB: clsB.name,
              layer,
              x: Math.round(mx * 1000) / 1000,
              y: Math.round(my * 1000) / 1000
            });
          }
        }
    }
    return violations;
  }

  return {
    CLEARANCE_DEFAULT, NETCLASS_DEFAULTS, makeBoard, getNet, netName, addNet, ensureNet,
    ensureNetClasses, defaultNetClass, addNetClass, getNetClass, netClassOfNet,
    setNetClass, renameNetClass, removeNetClass,
    addZone, removeZone, zonesOn, addText, removeText, moveText, hitText,
    placeFootprint, moveFootprint, rotateFootprint,
    addTrack, addVia, hitPad, hitFootprint, hitTrack, hitVia,
    ratsnest, runDRC, rot, segSegDist, pointSegDist
  };
});
