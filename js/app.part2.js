/* Kipad main app, part 2: previews, tools, copper zones, actions, routing, outline drawing, DRC/ERC panels, save/open/export. */
'use strict';

  // ---------- previews ----------
  function drawFpPreview(cv, fp) {
    if (!cv || !fp) return;
    const c = cv.getContext('2d');
    const W = cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
    const H = cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
    c.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    const w = cv.clientWidth, h = cv.clientHeight;
    c.fillStyle = '#1e1e1e'; c.fillRect(0, 0, w, h);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of fp.pads) {
      x0 = Math.min(x0, p.at[0] - p.size[0] / 2); x1 = Math.max(x1, p.at[0] + p.size[0] / 2);
      y0 = Math.min(y0, p.at[1] - p.size[1] / 2); y1 = Math.max(y1, p.at[1] + p.size[1] / 2);
    }
    if (fp.courtyard) {
      x0 = Math.min(x0, fp.courtyard.min[0]); x1 = Math.max(x1, fp.courtyard.max[0]);
      y0 = Math.min(y0, fp.courtyard.min[1]); y1 = Math.max(y1, fp.courtyard.max[1]);
    }
    if (!isFinite(x0)) return;
    const pad = 8;
    const sc = Math.min((w - pad * 2) / (x1 - x0 || 1), (h - pad * 2) / (y1 - y0 || 1));
    const ox = w / 2 - (x0 + x1) / 2 * sc, oy = h / 2 - (y0 + y1) / 2 * sc;
    c.save(); c.translate(ox, oy); c.scale(sc, sc);
    c.lineWidth = 0.1;
    if (fp.courtyard) {
      c.strokeStyle = 'rgba(200,200,0,0.8)';
      c.strokeRect(fp.courtyard.min[0], fp.courtyard.min[1], fp.courtyard.max[0] - fp.courtyard.min[0], fp.courtyard.max[1] - fp.courtyard.min[1]);
    }
    c.strokeStyle = 'rgba(240,240,240,0.9)';
    for (const s of fp.silk || []) {
      if (s.type === 'line') {
        c.beginPath();
        for (let i = 0; i < s.pts.length; i++) { if (i === 0) c.moveTo(s.pts[i][0], s.pts[i][1]); else c.lineTo(s.pts[i][0], s.pts[i][1]); }
        c.stroke();
      } else if (s.type === 'circle') {
        c.beginPath(); c.arc(s.at[0], s.at[1], s.r, 0, Math.PI * 2); c.stroke();
      } else if (s.type === 'rect') {
        c.strokeRect(Math.min(s.start[0], s.end[0]), Math.min(s.start[1], s.end[1]),
          Math.abs(s.end[0] - s.start[0]), Math.abs(s.end[1] - s.start[1]));
      }
    }
    for (const p of fp.pads) {
      c.fillStyle = p.layers[0] === 'B.Cu' ? '#0000ff' : '#ff0000';
      c.strokeStyle = c.fillStyle;
      const ww = p.size[0], hh = p.size[1];
      if (p.shape === 'circle') { c.beginPath(); c.arc(p.at[0], p.at[1], ww / 2, 0, Math.PI * 2); c.fill(); }
      else if (p.shape === 'roundrect') { c.beginPath(); c.arc(p.at[0], p.at[1], Math.min(ww, hh) * 0.2, 0, Math.PI * 2); c.fill(); c.fillRect(p.at[0] - ww / 2, p.at[1] - hh / 2, ww, hh); }
      else { c.fillRect(p.at[0] - ww / 2, p.at[1] - hh / 2, ww, hh); }
    }
    c.restore();
  }

  function drawSymbolPreview(cv, sym) {
    if (!cv || !sym) return;
    const c = cv.getContext('2d');
    const W = cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
    const H = cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
    c.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    const w = cv.clientWidth, h = cv.clientHeight;
    c.fillStyle = '#1e1e1e'; c.fillRect(0, 0, w, h);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    for (const p of sym.pins || []) add(p.at[0], p.at[1]);
    for (const g of sym.graphics || []) {
      if (g.type === 'rect') { add(g.start[0], g.start[1]); add(g.end[0], g.end[1]); }
      else if (g.type === 'circle') { add(g.center[0] - g.r, g.center[1] - g.r); add(g.center[0] + g.r, g.center[1] + g.r); }
      else if (g.type === 'polyline' || g.type === 'arc') for (const p of g.pts || []) add(p[0], p[1]);
      else if (g.type === 'text') add(g.at[0], g.at[1]);
    }
    if (!isFinite(x0)) return;
    const pad = 14;
    const sc = Math.min((w - pad * 2) / (x1 - x0 || 1), (h - pad * 2) / (y1 - y0 || 1));
    const ox = w / 2 - (x0 + x1) / 2 * sc, oy = h / 2 - (y0 + y1) / 2 * sc;
    c.save(); c.translate(ox, oy); c.scale(sc, sc);
    c.strokeStyle = '#e0e0e0'; c.fillStyle = '#e0e0e0';
    c.lineWidth = 0.3;
    for (const g of sym.graphics || []) {
      if (g.type === 'rect') c.strokeRect(g.start[0], g.start[1], g.end[0] - g.start[0], g.end[1] - g.start[1]);
      else if (g.type === 'circle') { c.beginPath(); c.arc(g.center[0], g.center[1], g.r, 0, Math.PI * 2); c.stroke(); }
      else if (g.type === 'polyline' || g.type === 'arc') {
        c.beginPath();
        for (let i = 0; i < g.pts.length; i++) { if (i === 0) c.moveTo(g.pts[i][0], g.pts[i][1]); else c.lineTo(g.pts[i][0], g.pts[i][1]); }
        c.stroke();
      } else if (g.type === 'text') {
        c.font = `${g.size || 1}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(g.text, g.at[0], g.at[1]);
      }
    }
    for (const p of sym.pins || []) {
      const a = p.angle * Math.PI / 180;
      const ex = p.at[0] + Math.cos(a) * (p.length || 2.54), ey = p.at[1] + Math.sin(a) * (p.length || 2.54);
      c.strokeStyle = '#4db8ff'; c.fillStyle = '#4db8ff';
      c.lineWidth = 0.35;
      c.beginPath(); c.moveTo(p.at[0], p.at[1]); c.lineTo(ex, ey); c.stroke();
      c.beginPath(); c.arc(p.at[0], p.at[1], 0.5, 0, Math.PI * 2); c.fill();
      c.font = '0.8px sans-serif';
      c.fillText(p.number, p.at[0] - Math.cos(a) * (p.length || 2.54) * 0.4, p.at[1] - Math.sin(a) * (p.length || 2.54) * 0.4);
    }
    c.restore();
  }

  // ---------- status / modal ----------
  function setStatus(t) { $('st-msg').textContent = t; }
  function showModal(title, body) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = body;
    $('modal').classList.remove('hidden');
  }
  function hideModal() { $('modal').classList.add('hidden'); }

  // ---------- tools ----------
  function setTool(t) {
    tool = t;
    route = null; outlinePts = null; routeCursor = null;
    if (t !== 'zone') zonePts = null;
    if (t !== 'text') textPlace = null;
    if (t !== 'footprint') placeLib = null;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    const map = { select: 'tool-select', highlight: 'tool-highlight', footprint: 'tool-footprint', track: 'tool-track', via: 'tool-via', zone: 'tool-zone', text: 'tool-text', line: 'tool-line', rect: 'tool-rect', circle: 'tool-circle', arc: 'tool-arc', measure: 'tool-measure' };
    if (map[t]) $(map[t]).classList.add('active');
    if (t === 'measure') { measureA = null; measureB = null; measureCur = null; }
    render();
  }

  function startTextTool() {
    const value = prompt('Board text:', textPlace ? textPlace.text : 'Text');
    if (value == null || !value.trim()) return;
    textPlace = { text: value.trim(), layer: layer === 'B.Cu' ? 'B.SilkS' : 'F.SilkS', size: 1.5, thickness: 0.3, angle: 0, justify: 'center' };
    setTool('text');   // keeps textPlace — only non-text tools clear it
    setStatus('Tap board to place “' + value.trim() + '” — edit size/layer in Properties');
    render();
  }

  function setSchTool(t) {
    schTool = t;
    if (t !== 'symbol') schPlaceName = null;
    schWirePts = [];
    if (t !== 'select') schSelNc = null;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    const map = { select: 'sch-select', symbol: 'sch-symbol', wire: 'sch-wire', label: 'sch-label', glabel: 'sch-glabel', junction: 'sch-junction', noconn: 'sch-noconn' };
    if (map[t] && $(map[t])) $(map[t]).classList.add('active');
    if (t === 'symbol') {
      setTab('symbols');
      if (!schPlaceName && symSel) schPlaceName = symSel;
      setStatus(schPlaceName ? 'Tap canvas to place ' + schPlaceName + ' (R rotate)' : 'Pick a symbol from the Symbols panel first');
    }
    render();
  }

  // ---------- copper zones ----------
  // Build the pure-geometry context KipadZones.fillZone expects from the
  // live board (pads/tracks/vias with net names + class clearance lookup).
  function zoneCtx() {
    B.ensureNetClasses(board);
    const pads = [], tracks = [], vias = [];
    for (const fp of board.footprints) for (const p of fp.pads) {
      pads.push({ x: p.at[0] - p.size[0] / 2, y: p.at[1] - p.size[1] / 2, w: p.size[0], h: p.size[1], net: B.netName(board, p.netId) });
    }
    for (const t of board.tracks) {
      for (const s of B.trackSegments(t))
        tracks.push({ ax: s.ax, ay: s.ay, bx: s.bx, by: s.by, r: t.width / 2, net: B.netName(board, t.netId) });
    }
    for (const v of board.vias) {
      vias.push({ x: v.at[0], y: v.at[1], r: v.size / 2, net: B.netName(board, v.netId) });
    }
    const netClassOf = name => B.netClassOfNet(board, (board.nets.find(n => n.name === name) || { id: 0 }).id);
    return { pads, tracks, vias, netClassOf };
  }
  function refillZones() {
    zonesDirty = false;
    if (!Z) return;
    if (!board.zones || !board.zones.length) { zoneFills.clear(); render(); return; }
    const c = zoneCtx();
    for (const z of board.zones) {
      const others = board.zones.filter(o => o !== z && o.layer === z.layer)
        .map(o => ({ outline: o.outline, net: o.net }));
      try {
        zoneFills.set(z.id, Z.fillZone(z, { pads: c.pads, tracks: c.tracks, vias: c.vias, netClassOf: c.netClassOf, zones: others }));
      } catch (e) { zoneFills.delete(z.id); }
    }
    render();
    if (selKind === 'zone') refreshProps();   // keep area/fill info fresh
  }
  // auto-refill after any copper-affecting edit (debounced so drags that
  // touch many items only recompute once)
  function markZonesDirty(immediate) {
    zonesDirty = true;
    if (zoneTimer) clearTimeout(zoneTimer);
    zoneTimer = setTimeout(() => { zoneTimer = null; if (zonesDirty) refillZones(); }, immediate ? 0 : 150);
  }
  function hitZone(x, y) {
    if (!Z || !board.zones || !board.zones.length) return null;
    for (let i = board.zones.length - 1; i >= 0; i--) {
      const z = board.zones[i];
      if (z.layer !== layer) continue;
      if (Z.pointInPolygon(x, y, z.outline)) return z;
    }
    return null;
  }
  function finishZone() {
    if (!zonePts || zonePts.pts.length < 3) { zonePts = null; render(); return; }
    pushUndo();
    const z = B.addZone(board, {
      net: B.netName(board, zonePts.netId),
      layer,
      outline: zonePts.pts.map(p => ({ x: p[0], y: p[1] }))
    });
    selId = z.id; selKind = 'zone';
    zonePts = null;
    refillZones(); refreshAll();
    setStatus('Zone added on ' + layer + ' — net "' + (z.net || '—') + '"');
  }

  // ---------- actions ----------
  function doDelete() {
    if (selId) {
      pushUndo();
      const fp = board.footprints.find(f => f.id === selId);
      if (fp) board.footprints = board.footprints.filter(f => f.id !== selId);
      else if (board.tracks.find(t => t.id === selId)) board.tracks = board.tracks.filter(t => t.id !== selId);
      else if (board.vias.find(v => v.id === selId)) board.vias = board.vias.filter(v => v.id !== selId);
      else if ((board.texts || []).find(t => t.id === selId)) B.removeText(board, selId);
      else B.removeZone(board, selId);
      selId = null; selKind = null;
      render(); refreshAll();
    }
  }
  function doRotateSel() {
    if (selKind === 'text' && selId) {
      const t = board.texts.find(x => x.id === selId);
      if (t) { pushUndo(); t.angle = (t.angle + 90) % 360; render(); refreshProps(); }
    }
    else if (selId) { pushUndo(); B.rotateFootprint(board, selId, 90); render(); refreshProps(); }
    else if (tool === 'footprint') { placeAngle = (placeAngle + 90) % 360; render(); }
    else if (tool === 'text' && textPlace) { textPlace.angle = (textPlace.angle + 90) % 360; render(); }
  }
  function switchLayer() {
    if (zonePts && tool === 'zone') { zonePts = null; setStatus('Layer switched — zone draft cancelled'); }
    layer = layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
    $('st-layer').textContent = layer;
    refreshLayers(); render();
  }

  // routing (45°-constrained; posture toggled with /)
  let routePosture = 'diag'; // 'diag' = diagonal first · 'straight' = straight first
  function cycleRoutePosture() {
    routePosture = routePosture === 'diag' ? 'straight' : 'diag';
    setStatus('Route posture: ' + (routePosture === 'diag' ? 'diagonal first' : 'straight first'));
    render();
  }
  function startRoute(x, y) {
    const hit = B.hitPad(board, x, y, pickTol());
    let netId = 0;
    if (hit) netId = hit.pad.netId;
    else if (hiNet != null) netId = hiNet;
    // default width comes from the net's class (W still cycles from there)
    trackWidth = B.netClassOfNet(board, netId).trackWidth;
    route = { pts: [[snap(x), snap(y)]], netId, layer, width: trackWidth, posture: routePosture };
    if (hit) route.pts = [[hit.pad.at[0], hit.pad.at[1]]];
    setStatus('Routing net "' + B.netName(board, netId) + '" — tap points (/ = 45° posture, Backspace = undo point), Enter to finish, V = via+layer');
  }
  function extendRoute(x, y) {
    if (!route) return;
    const last = route.pts[route.pts.length - 1];
    const p = [snap(x), snap(y)];
    if (p[0] === last[0] && p[1] === last[1]) return;
    for (const pt of KipadRoute.elbow(last, p, routePosture)) route.pts.push(pt);
  }
  function finishRoute() {
    if (!route || route.pts.length < 2) { route = null; render(); return; }
    const clean = KipadRoute.cleanup(route.pts); // drop dups + collinear runs before commit
    if (clean.length < 2) { route = null; routeCursor = null; render(); return; }
    pushUndo();
    for (let i = 0; i < clean.length - 1; i++) {
      B.addTrack(board, clean[i], clean[i + 1], route.width, route.layer, route.netId);
    }
    route = null; routeCursor = null;
    render(); refreshAll(); setStatus('Track placed');
  }
  function addViaHere(x, y) {
    pushUndo();
    const netId = route ? route.netId : (hiNet != null ? hiNet : 0);
    // vias take size/drill from the net's class
    const cls = B.netClassOfNet(board, netId);
    const v = B.addVia(board, [snap(x), snap(y)], cls.viaSize, cls.viaDrill, netId);
    if (route) route.layer = route.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
    render(); refreshAll();
    return v;
  }
  function cycleTrackWidth() {
    const cls = B.netClassOfNet(board, route ? route.netId : (hiNet != null ? hiNet : 0));
    const widths = [];
    for (const w of [cls.trackWidth].concat(TRACK_WIDTHS)) if (widths.indexOf(w) < 0) widths.push(w);
    trackWidth = widths[(widths.indexOf(trackWidth) + 1) % widths.length];
    if (route) route.width = trackWidth;
    setStatus('Track width: ' + trackWidth + ' mm');
    render();
  }

  // outline graphics (line/rect/circle/arc → Edge.Cuts polylines)
  let gfxStart = null; // for line/rect/circle first point
  function startGfx(x, y) {
    gfxStart = [snap(x), snap(y)];
    outlinePts = [gfxStart];
    setStatus('Draw on Edge.Cuts — tap to finish, Esc cancel');
  }
  function extendGfx(x, y) {
    if (!gfxStart || !outlinePts) return;
    const p = [snap(x), snap(y)];
    if (tool === 'line') {
      pushUndo();
      board.outline.push([gfxStart, p]);
      outlinePts = null; gfxStart = null;
      render();
    } else if (tool === 'rect') {
      if (outlinePts.length === 1) { outlinePts.push(p); }
      else {
        pushUndo();
        const [x0, y0] = gfxStart, [x1, y1] = p;
        board.outline.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
        outlinePts = null; gfxStart = null;
        render(); setStatus('Rectangle added to outline');
      }
    } else if (tool === 'circle') {
      const r = Math.hypot(p[0] - gfxStart[0], p[1] - gfxStart[1]);
      pushUndo();
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const a = i / 48 * Math.PI * 2;
        pts.push([gfxStart[0] + r * Math.cos(a), gfxStart[1] + r * Math.sin(a)]);
      }
      board.outline.push(pts);
      outlinePts = null; gfxStart = null;
      render(); setStatus('Circle added to outline');
    } else if (tool === 'arc') {
      if (outlinePts.length === 1) outlinePts.push(p);
      else {
        // 3-point arc through start, mid, end
        pushUndo();
        const a = outlinePts[0], b = outlinePts[1], c = p;
        const pts = arcPolyline(a, b, c);
        board.outline.push(pts);
        outlinePts = null; gfxStart = null;
        render(); setStatus('Arc added to outline');
      }
    }
  }
  function arcPolyline(a, b, c) {
    // circle through 3 points, sample from a to c passing b
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return [a, c];
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy);
    const a0 = Math.atan2(ay - uy, ax - ux);
    const a1 = Math.atan2(by - uy, bx - ux);
    const a2 = Math.atan2(cy - uy, cx - ux);
    let sweep = a2 - a0;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    // check midpoint direction
    let mid = a1 - a0;
    while (mid < -Math.PI) mid += 2 * Math.PI;
    while (mid > Math.PI) mid -= 2 * Math.PI;
    if (Math.sign(mid) !== Math.sign(sweep)) sweep = (sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI);
    const n = 32;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const ang = a0 + sweep * i / n;
      pts.push([ux + r * Math.cos(ang), uy + r * Math.sin(ang)]);
    }
    return pts;
  }

  // ---------- DRC ----------
  let drcViolations = [];
  function runDRC() {
    const panel = $('drc-panel');
    drcViolations = B.runDRC(board);
    panel.classList.remove('hidden');
    if (!drcViolations.length) {
      panel.innerHTML = '<h4>DRC</h4><div class="drc-clear">✓ No violations — clearances, holes, edges, silkscreen and connectivity all pass</div>';
      return;
    }
    const errs = drcViolations.filter(v => v.severity !== 'warning').length;
    const warns = drcViolations.length - errs;
    panel.innerHTML = '<h4>DRC — ' + errs + ' error(s), ' + warns + ' warning(s)</h4>' +
      drcViolations.slice(0, 40).map((v, i) =>
        `<div class="drc-item${v.severity === 'warning' ? ' warn' : ''}" data-i="${i}">${esc(v.msg)} @${v.x},${v.y}</div>`
      ).join('');
    panel.querySelectorAll('.drc-item').forEach(el => el.addEventListener('click', () => {
      const v = drcViolations[Number(el.dataset.i)];
      if (!v) return;
      view.x = v.x; view.y = v.y;   // centre canvas on the violation
      render();
      setStatus(v.msg);
    }));
  }

  // ---------- ERC (schematic electrical rules check) ----------
  function refreshErc() {
    ercViolations = (Erc && sch) ? Erc.runERC(sch, Syms.getSymbol, FPs ? FPs.getFootprint : null) : [];
    ercDirty = false;
    updateErcStatus();
  }
  function updateErcStatus() {
    const el = $('st-erc');
    if (!el || !Erc) return;
    const c = Erc.counts(ercViolations);
    el.textContent = 'ERC: ' + c.errors + ' error' + (c.errors === 1 ? '' : 's') + ', ' +
      c.warnings + ' warning' + (c.warnings === 1 ? '' : 's');
    el.classList.toggle('clean', c.errors === 0 && c.warnings === 0);
    el.classList.toggle('dirty', c.errors + c.warnings > 0);
  }
  // centre the canvas on a violation and select its symbol (if any)
  function ercLocate(v) {
    if (!v) return;
    if (v.symbolId) schSelId = v.symbolId;
    view.x = v.x; view.y = v.y;    // w2s puts view.x/view.y at canvas centre
    render(); refreshAll();
    setStatus(v.code + ': ' + v.message);
  }
  function showErc() {
    refreshErc();
    const panel = $('erc-panel');
    if (!panel || !Erc) return;
    panel.classList.remove('hidden');
    const c = Erc.counts(ercViolations);
    if (!ercViolations.length) {
      panel.innerHTML = '<div class="erc-head"><h4>ERC — Electrical Rules Check</h4><button class="erc-close" title="Close">✕</button></div>' +
        '<div class="erc-summary">✓ No ERC violations</div>';
    } else {
      let html = '<div class="erc-head"><h4>ERC — Electrical Rules Check</h4><button class="erc-close" title="Close">✕</button></div>' +
        '<div class="erc-summary">' + c.errors + ' error' + (c.errors === 1 ? '' : 's') + ', ' +
        c.warnings + ' warning' + (c.warnings === 1 ? '' : 's') + '</div>';
      let startedErr = false, startedWarn = false;
      ercViolations.forEach((v, i) => {
        if (v.severity === 'error' && !startedErr) { html += '<div class="erc-group-title">Errors</div>'; startedErr = true; }
        if (v.severity === 'warning' && !startedWarn) { html += '<div class="erc-group-title">Warnings</div>'; startedWarn = true; }
        html += `<div class="erc-item ${v.severity}" data-idx="${i}"><span class="erc-code">${v.code}</span><span class="erc-msg">${esc(v.message)}</span></div>`;
      });
      panel.innerHTML = html;
      panel.querySelectorAll('.erc-item').forEach(row => row.addEventListener('click', () => {
        const v = ercViolations[Number(row.dataset.idx)];
        ercLocate(v);
        panel.querySelectorAll('.erc-item').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
      }));
    }
    const close = panel.querySelector('.erc-close');
    if (close) close.addEventListener('click', () => panel.classList.add('hidden'));
  }

  // ---------- save/open/export ----------
  // Safe-save: validate the serialization before download and keep rotating
  // backups of the previously opened/saved text so an overwrite is reversible.
  const PCB_BAK_KEY = 'kipad.backup.pcb.v1';
  let lastSavedPcb = null;      // last opened / validated .kicad_pcb text
  function doSave() {
    if (!Pcb) { setStatus('kicad_pcb module not loaded'); return; }
    if (!SafeSave) { setStatus('safesave module not loaded'); return; }
    const text = Pcb.serializeBoard(board);
    const v = SafeSave.validate(text,
      t => Pcb.parseBoard(t),
      m => Pcb.serializeBoard(m));
    if (!v.ok) { setStatus('Save aborted: serialized board failed validation (' + v.error + ')'); return; }
    let backed = false;
    if (lastSavedPcb && lastSavedPcb !== text)
      backed = SafeSave.pushBackup(SafeSave.defaultStore(), PCB_BAK_KEY, lastSavedPcb) > 0;
    download('kipad.kicad_pcb', text, 'application/x-kicad-pcb');
    lastSavedPcb = text;
    setStatus('Saved .kicad_pcb' + (v.stable === false ? ' (round-trip differs)' : '') +
      (backed ? ' · previous version backed up' : ''));
  }
  function restorePcbBackup() {
    if (!Pcb) { setStatus('kicad_pcb module not loaded'); return; }
    const b = SafeSave.getBackup(SafeSave.defaultStore(), PCB_BAK_KEY, 0);
    if (!b) { setStatus('No .kicad_pcb backups yet'); return; }
    try {
      pushUndo();
      board = Pcb.parseBoard(b.s);
      B.ensureNetClasses(board);
      if (!Array.isArray(board.zones)) board.zones = [];
      if (!Array.isArray(board.texts)) board.texts = [];
      selId = null; hiNet = null; route = null; outlinePts = null;
      markZonesDirty(true);
      render(); refreshAll();
      setStatus('Restored previous .kicad_pcb backup (' + new Date(b.t).toLocaleString() + ') — undo returns to the current board');
    } catch (e) {
      undo();
      setStatus('Backup restore failed: ' + e.message);
    }
  }
  function doOpen(file) {
    if (!Pcb) return;
    const r = new FileReader();
    r.onerror = () => setStatus('Could not read ' + file.name);
    r.onload = () => {
      try {
        pushUndo();
        board = Pcb.parseBoard(r.result);
        B.ensureNetClasses(board);
        if (!Array.isArray(board.zones)) board.zones = [];
        if (!Array.isArray(board.texts)) board.texts = [];
        selId = null; hiNet = null; route = null; outlinePts = null;
        markZonesDirty(true);
        render(); refreshAll();
        lastSavedPcb = r.result;   // baseline for safe-save backups
        setStatus('Opened ' + file.name);
      } catch (e) { setStatus('Open failed: ' + e.message); }
    };
    r.readAsText(file);
  }
  function doGerber() {
    if (!Gerber) { setStatus('Gerber module not loaded'); return; }
    const out = Gerber.exportAll(board, FPs ? FPs.getFootprint : null);
    const n = Object.keys(out).length;
    for (const [l, g] of Object.entries(out)) {
      download(`kipad-${l.replace(/[^A-Za-z0-9]/g, '')}.gbr`, g, 'application/gerber');
    }
    setStatus(`Gerbers exported (${n} layers: copper, edge, silk, mask, paste)`);
  }
  function doDrill() {
    if (!Drill) { setStatus('Drill module not loaded'); return; }
    const text = Drill.exportDrill(board);
    if (!text) { setStatus('No holes to export'); return; }
    download('kipad.drl', text, 'text/plain');
    setStatus('Drill file exported (.drl)');
  }
  function doPos() {
    if (!Pos) { setStatus('Placement module not loaded'); return; }
    const out = Pos.exportPos(board);
    let n = 0;
    if (out.front) { download('kipad-top.pos', out.front, 'text/plain'); n++; }
    if (out.back) { download('kipad-bottom.pos', out.back, 'text/plain'); n++; }
    if (!n) { setStatus('No footprints to place'); return; }
    setStatus('Component placement exported (.pos)');
  }
  function doBom() {
    if (!Bom) { setStatus('BOM module not loaded'); return; }
    if (!sch || !sch.symbols.length) { setStatus('Schematic is empty'); return; }
    const out = Bom.exportBom(sch);
    if (!out.rows.length) { setStatus('No components for BOM'); return; }
    download('kipad-bom.csv', out.csv, 'text/csv');
    const qty = out.rows.reduce((n, r) => n + r.qty, 0);
    setStatus('BOM exported: ' + out.rows.length + ' part line' + (out.rows.length === 1 ? '' : 's') + ', ' + qty + ' component' + (qty === 1 ? '' : 's'));
  }
  function doNetlist() {
    if (!NetlistExp) { setStatus('Netlist module not loaded'); return; }
    if (!sch || !sch.symbols.length) { setStatus('Schematic is empty'); return; }
    const out = NetlistExp.exportNetlist(sch, Syms.getSymbol);
    if (!out.data.components.length) { setStatus('No components for netlist'); return; }
    download('kipad.net', out.text, 'text/plain');
    setStatus('Netlist exported: ' + out.data.nets.length + ' net' + (out.data.nets.length === 1 ? '' : 's') + ', ' + out.data.components.length + ' component' + (out.data.components.length === 1 ? '' : 's'));
  }
  function doFabZip() {
    if (!Zip) { setStatus('ZIP module not loaded'); return; }
    if (!Gerber) { setStatus('Gerber module not loaded'); return; }
    const files = [];
    const g = Gerber.exportAll(board, FPs ? FPs.getFootprint : null);
    for (const [l, txt] of Object.entries(g)) {
      files.push({ name: 'gerbers/kipad-' + l.replace(/[^A-Za-z0-9]/g, '') + '.gbr', data: txt });
    }
    if (Drill) {
      const d = Drill.exportDrill(board);
      if (d) files.push({ name: 'drill/kipad.drl', data: d });
    }
    if (Pos) {
      const p = Pos.exportPos(board);
      if (p.front) files.push({ name: 'placement/kipad-top.pos', data: p.front });
      if (p.back) files.push({ name: 'placement/kipad-bottom.pos', data: p.back });
    }
    let bomNote = '';
    if (Bom && sch && sch.symbols.length) {
      try {
        const b = Bom.exportBom(sch);
        if (b.rows.length) { files.push({ name: 'bom/kipad-bom.csv', data: b.csv }); bomNote = ' + BOM'; }
      } catch (e) { /* BOM is best-effort inside the package */ }
    }
    if (!files.length) { setStatus('Nothing to export — board is empty'); return; }
    const bytes = Zip.zipStore(files);
    downloadBytes('kipad-fab.zip', bytes, 'application/zip');
    const kb = Math.max(1, Math.round(bytes.length / 1024));
    setStatus('Fab package exported: ' + files.length + ' file' + (files.length === 1 ? '' : 's') + bomNote + ' (' + kb + ' KB)');
  }
  function downloadBytes(name, bytes, mime) {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function doImport(file) {
    const r = new FileReader();
    r.onerror = () => setStatus('Could not read ' + file.name);
    r.onload = () => {
      const name = file.name;
      try {
        if (name.endsWith('.kicad_mod')) {
          if (!KicadMod) { setStatus('kicad_mod importer not loaded'); return; }
          const fp = KicadMod.parseKicadMod(r.result);
          if (!fp) { setStatus('Import failed: bad .kicad_mod'); return; }
          FPs.loadLibrary([fp]);
          libSel = fp.name;
          refreshLibrary();
          setTool('footprint'); placeLib = fp.name; placeAngle = 0;
          setStatus('Imported ' + fp.name + ' — tap to place');
        } else if (name.endsWith('.kicad_sym')) {
          if (!KicadSym || !Syms) { setStatus('symbol importer not loaded'); return; }
          const syms = KicadSym.parseKicadSym(r.result);
          if (!syms || !syms.length) { setStatus('Import failed: bad .kicad_sym'); return; }
          Syms.loadLibrary(syms);
          symSel = syms[0].name;
          refreshSymbols();
          setStatus('Imported ' + syms.length + ' symbol(s)');
        } else {
          doOpen(file);
        }
      } catch (e) { setStatus('Import failed: ' + e.message); }
    };
    r.readAsText(file);
  }
