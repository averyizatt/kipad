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

  // ---------- extended DRC checks (holes, board edge, silkscreen) ----------
  const HOLE_CLEARANCE_DEFAULT = 0.25; // mm copper-to-drilled-hole (KiCad default)
  const EDGE_CLEARANCE_DEFAULT = 0.5;  // mm copper-to-board-edge (KiCad default)
  const SILK_PAD_CORE = 0.5;           // fraction of pad kept clear of silk (noise guard)

  function padOnLayer(p, cu) {
    const L = p.layers || [];
    for (const l of L) if (l === cu || l === '*.Cu') return true;
    return false;
  }
  function copperItemsExt(board, layer) {
    // like copperItems but tolerates *.Cu wildcards and tags pad ownership
    const items = [];
    for (const fp of board.footprints) {
      if (fp.layer !== layer) continue;
      for (const p of fp.pads) {
        if (!padOnLayer(p, layer)) continue;
        items.push({ kind: 'pad', x: p.at[0], y: p.at[1], r: Math.max(p.size[0], p.size[1]) / 2, netId: p.netId, layer, ownerPad: fp.id + '#' + p.number });
      }
    }
    for (const t of board.tracks) {
      if (t.layer !== layer) continue;
      items.push({ kind: 'track', seg: [t.start, t.end], r: t.width / 2, netId: t.netId, layer });
    }
    for (const v of board.vias) {
      items.push({ kind: 'via', x: v.at[0], y: v.at[1], r: v.size / 2, netId: v.netId, layer });
    }
    return items;
  }
  function holeItems(board) {
    // every drilled hole: THT pad drills + via drills, tagged with owning pad
    const holes = [];
    for (const fp of board.footprints)
      for (const p of fp.pads)
        if (p.type === 'tht' && p.drill != null && !isNaN(p.drill) && p.drill > 0)
          holes.push({ kind: 'pad', x: p.at[0], y: p.at[1], r: p.drill / 2, netId: p.netId, ownerPad: fp.id + '#' + p.number });
    for (const v of board.vias)
      if (v.drill != null && v.drill > 0)
        holes.push({ kind: 'via', x: v.at[0], y: v.at[1], r: v.drill / 2, netId: v.netId, ownerPad: null });
    return holes;
  }
  function edgeSegs(board) {
    const o = Array.isArray(board.outline) ? board.outline : [];
    if (o.length < 2) return [];
    const segs = [];
    for (let i = 0; i < o.length - 1; i++) segs.push([o[i], o[i + 1]]);
    const f = o[0], l = o[o.length - 1];
    if (o.length > 2 && !(Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6)) segs.push([l, f]);
    return segs;
  }
  function itemHoleDist(hole, it) {
    if (it.seg) return pointSegDist(hole.x, hole.y, it.seg[0][0], it.seg[0][1], it.seg[1][0], it.seg[1][1]) - it.r - hole.r;
    return Math.sqrt(dist2(hole.x, hole.y, it.x, it.y)) - it.r - hole.r;
  }
  function itemEdgeDist(it, s) {
    if (it.seg) return segSegDist(it.seg[0][0], it.seg[0][1], it.seg[1][0], it.seg[1][1], s[0].x, s[0].y, s[1].x, s[1].y) - it.r;
    return pointSegDist(it.x, it.y, s[0].x, s[0].y, s[1].x, s[1].y) - it.r;
  }
  function exposedPadsBySide(board) {
    const out = { 'F.Cu': [], 'B.Cu': [] };
    for (const fp of board.footprints)
      for (const p of fp.pads) {
        if (padOnLayer(p, 'F.Cu')) out['F.Cu'].push({ p, ref: fp.ref, fp });
        else if (padOnLayer(p, 'B.Cu')) out['B.Cu'].push({ p, ref: fp.ref, fp });
      }
    return out;
  }
  function textWorldBBox(t) {
    // approximate rendered-text bounding box (heuristic char width), rotation-aware
    const w = Math.max(t.size, String(t.text).length * t.size * 0.62);
    const h = t.size * 1.15;
    let x0 = -w / 2, x1 = w / 2;
    if (t.justify === 'left') { x0 = 0; x1 = w; }
    else if (t.justify === 'right') { x0 = -w; x1 = 0; }
    const cs = [[x0, -h / 2], [x1, -h / 2], [x1, h / 2], [x0, h / 2]];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cs) {
      const rc = rot(c[0], c[1], t.angle);
      const wx = t.at[0] + rc[0], wy = t.at[1] + rc[1];
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }
    return { minX, minY, maxX, maxY };
  }
  function segRectHit(ax, ay, bx, by, r) {
    // Liang-Barsky: does segment a-b intersect axis-aligned rect r?
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const edges = [[-dx, ax - r.minX], [dx, r.maxX - ax], [-dy, ay - r.minY], [dy, r.maxY - ay]];
    for (const e of edges) {
      const p = e[0], q = e[1];
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  function padCoreRect(p, shrink) {
    const hw = p.size[0] / 2 * shrink, hh = p.size[1] / 2 * shrink;
    return { minX: p.at[0] - hw, maxX: p.at[0] + hw, minY: p.at[1] - hh, maxY: p.at[1] + hh };
  }
  function silkViolations(board) {
    // Silkscreen printed over exposed copper is lost at fab — KiCad flags it.
    // Heuristic: only flag silk reaching the central SILK_PAD_CORE of a pad so
    // corner-clipping (common in real footprints) stays quiet. Footprint silk
    // art is only checked against OTHER footprints' pads (library art is not
    // the user's fault); user-placed board text is checked against every pad.
    const out = [];
    const seen = new Set();
    const pads = exposedPadsBySide(board);
    const side = { 'F.SilkS': 'F.Cu', 'B.SilkS': 'B.Cu' };
    const pushOnce = v => {
      const k = v.type + '|' + v.msg;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(v);
    };
    for (const t of board.texts || []) {
      const cu = side[t.layer];
      if (!cu || !pads[cu].length) continue;
      const bb = textWorldBBox(t);
      for (const it of pads[cu]) {
        const core = padCoreRect(it.p, SILK_PAD_CORE);
        if (bb.maxX < core.minX || bb.minX > core.maxX || bb.maxY < core.minY || bb.minY > core.maxY) continue;
        pushOnce({
          type: 'silk-text', severity: 'warning',
          msg: 'Silkscreen text "' + t.text + '" covers pad ' + it.ref + ' (' + cu + ')',
          netA: netName(board, it.p.netId), netB: '', dist: null, clearance: null,
          classA: '', classB: '', layer: t.layer,
          x: Math.round((bb.minX + bb.maxX) / 2 * 1000) / 1000,
          y: Math.round((bb.minY + bb.maxY) / 2 * 1000) / 1000
        });
      }
    }
    const Lib = root.KipadFootprints || (typeof require !== 'undefined' ? require('./footprints.js') : null);
    if (!Lib || !pads['F.Cu'].length) return out;
    for (const fp of board.footprints) {
      if (fp.layer !== 'F.Cu') continue;
      const def = Lib.getFootprint(fp.lib);
      if (!def || !Array.isArray(def.silk)) continue;
      const world = pt => { const rc = rot(pt[0], pt[1], fp.angle); return [fp.at[0] + rc[0], fp.at[1] + rc[1]]; };
      for (const s of def.silk) {
        if ((s.layer || 'F.SilkS') !== 'F.SilkS') continue;
        const pts = s.pts || [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = world(pts[i]), b = world(pts[i + 1]);
          for (const it of pads['F.Cu']) {
            if (it.fp.id === fp.id) continue; // own-library art exempt
            if (!segRectHit(a[0], a[1], b[0], b[1], padCoreRect(it.p, SILK_PAD_CORE))) continue;
            pushOnce({
              type: 'silk-line', severity: 'warning',
              msg: 'Silkscreen of ' + fp.ref + ' runs across pad ' + it.ref + ' (F.Cu)',
              netA: '', netB: netName(board, it.p.netId), dist: null, clearance: null,
              classA: '', classB: '', layer: 'F.SilkS',
              x: Math.round(it.p.at[0] * 1000) / 1000,
              y: Math.round(it.p.at[1] * 1000) / 1000
            });
          }
        }
      }
    }
    return out;
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
              severity: 'error',
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
    // drilled holes need clearance from other-net copper (all layers)
    const holes = holeItems(board);
    if (holes.length) {
      for (const layer of ['F.Cu', 'B.Cu']) {
        for (const it of copperItemsExt(board, layer)) {
          for (const h of holes) {
            if (it.ownerPad && it.ownerPad === h.ownerPad) continue; // own annulus
            if (h.netId !== 0 && h.netId === it.netId) continue;    // same net
            const d = itemHoleDist(h, it);
            if (d >= HOLE_CLEARANCE_DEFAULT) continue;
            violations.push({
              type: `hole-${it.kind}`, severity: 'error',
              msg: `${it.kind} (${netName(board, it.netId)}) ${d < 0 ? 'crosses' : 'crowds'} ${h.kind === 'via' ? 'via' : 'pad'} drill hole (${netName(board, h.netId)}): gap ${Math.round(d * 1000) / 1000}mm < ${HOLE_CLEARANCE_DEFAULT}mm hole clearance`,
              netA: netName(board, h.netId), netB: netName(board, it.netId),
              dist: Math.round(d * 1000) / 1000, clearance: HOLE_CLEARANCE_DEFAULT,
              classA: '', classB: '', layer,
              x: Math.round(h.x * 1000) / 1000,
              y: Math.round(h.y * 1000) / 1000
            });
          }
        }
      }
    }
    // copper must keep distance from the board outline
    const esegs = edgeSegs(board);
    if (esegs.length) {
      for (const layer of ['F.Cu', 'B.Cu']) {
        for (const it of copperItemsExt(board, layer)) {
          let worst = null;
          for (const s of esegs) {
            const d = itemEdgeDist(it, s);
            if (!worst || d < worst.d) worst = { d };
          }
          if (worst && worst.d < EDGE_CLEARANCE_DEFAULT) {
            const cx = it.x != null ? it.x : (it.seg ? (it.seg[0][0] + it.seg[1][0]) / 2 : 0);
            const cy = it.y != null ? it.y : (it.seg ? (it.seg[0][1] + it.seg[1][1]) / 2 : 0);
            violations.push({
              type: `edge-${it.kind}`, severity: 'error',
              msg: `${it.kind} (${netName(board, it.netId)}) too close to board edge: gap ${Math.round(worst.d * 1000) / 1000}mm < ${EDGE_CLEARANCE_DEFAULT}mm edge clearance`,
              netA: netName(board, it.netId), netB: '',
              dist: Math.round(worst.d * 1000) / 1000, clearance: EDGE_CLEARANCE_DEFAULT,
              classA: '', classB: '', layer,
              x: Math.round(cx * 1000) / 1000,
              y: Math.round(cy * 1000) / 1000
            });
          }
        }
      }
    }
    // silkscreen over exposed pads (warnings)
    for (const sv of silkViolations(board)) violations.push(sv);
    return violations;
  }

  return {
    CLEARANCE_DEFAULT, NETCLASS_DEFAULTS, makeBoard, getNet, netName, addNet, ensureNet,
    ensureNetClasses, defaultNetClass, addNetClass, getNetClass, netClassOfNet,
    HOLE_CLEARANCE_DEFAULT, EDGE_CLEARANCE_DEFAULT,
    setNetClass, renameNetClass, removeNetClass,
    addZone, removeZone, zonesOn, addText, removeText, moveText, hitText,
    placeFootprint, moveFootprint, rotateFootprint,
    addTrack, addVia, hitPad, hitFootprint, hitTrack, hitVia,
    ratsnest, runDRC, rot, segSegDist, pointSegDist
  };
});
