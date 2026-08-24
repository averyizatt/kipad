if (prot) prot.addEventListener('change', e => {
        pushUndo();
        const a = parseFloat(e.target.value);
        if (!isNaN(a)) { const d = ((a - fp.angle) % 360 + 360) % 360; B.rotateFootprint(board, fp.id, d); }
        render();
      });
      const plyr = $('p-layer');
      if (plyr) plyr.addEventListener('change', e => {
        pushUndo();
        fp.layer = e.target.value;
        for (const p of fp.pads) {
          const cu = p.layers[0];
          p.layers[0] = fp.layer;
          if (cu === 'F.Cu' || cu === 'B.Cu') p.layers = p.layers.map((l, i) => i === 0 ? fp.layer : (l === cu ? cu : l));
          else p.layers = [fp.layer].concat(p.layers.filter(l => l !== 'F.Cu' && l !== 'B.Cu'));
        }
        render();
      });
      const rb = $('p-rot-btn');
      if (rb) rb.addEventListener('click', () => { pushUndo(); B.rotateFootprint(board, fp.id, 90); refreshProps(); render(); });
      const db = $('p-del-btn');
      if (db) db.addEventListener('click', doDelete);
      return;
    }
    const tr = board.tracks.find(t => t.id === selId);
    if (tr) {
      el.innerHTML = `<div class="prop-group"><h5>Track</h5>
        <div class="prop-row"><label>Width</label><input id="p-w" value="${tr.width}"></div>
        <div class="prop-row"><label>Layer</label><span>${tr.layer}</span></div>
        <div class="prop-row"><label>Net</label><span>${esc(B.netName(board, tr.netId) || '—')}</span></div>
        <div class="lib-actions"><button class="btn danger" id="p-del-btn">Delete</button></div></div>`;
      const w = $('p-w');
      if (w) w.addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v > 0) { pushUndo(); tr.width = v; render(); }
      });
      const db = $('p-del-btn');
      if (db) db.addEventListener('click', () => { pushUndo(); board.tracks = board.tracks.filter(t => t.id !== selId); selId = null; selKind = null; refreshProps(); render(); });
      return;
    }
    const via = board.vias.find(v => v.id === selId);
    if (via) {
      el.innerHTML = `<div class="prop-group"><h5>Via</h5>
        <div class="prop-row"><label>Size</label><input id="p-s" value="${via.size}"></div>
        <div class="prop-row"><label>Drill</label><input id="p-d" value="${via.drill}"></div>
        <div class="prop-row"><label>Net</label><span>${esc(B.netName(board, via.netId) || '—')}</span></div>
        <div class="lib-actions"><button class="btn danger" id="p-del-btn">Delete</button></div></div>`;
      const s = $('p-s'), d = $('p-d');
      const apply = () => {
        const sv = parseFloat(s.value), dv = parseFloat(d.value);
        if (!isNaN(sv) && sv > 0) { pushUndo(); via.size = sv; }
        if (!isNaN(dv) && dv > 0 && dv < via.size) { pushUndo(); via.drill = dv; }
        render();
      };
      if (s) s.addEventListener('change', apply);
      if (d) d.addEventListener('change', apply);
      const db = $('p-del-btn');
      if (db) db.addEventListener('click', () => { pushUndo(); board.vias = board.vias.filter(v => v.id !== selId); selId = null; selKind = null; refreshProps(); render(); });
      return;
    }
    const txt = (board.texts || []).find(t => t.id === selId);
    if (txt) {
      el.innerHTML = `<div class="prop-group"><h5>Board Text</h5>
        <div class="prop-row"><label>Text</label><input id="p-txt" value="${esc(txt.text)}"></div>
        <div class="prop-row"><label>Layer</label><select id="p-tlayer"><option ${txt.layer==='F.SilkS'?'selected':''}>F.SilkS</option><option ${txt.layer==='B.SilkS'?'selected':''}>B.SilkS</option></select></div>
        <div class="prop-row"><label>Height</label><input id="p-tsize" type="number" step="0.1" min="0.1" value="${txt.size}"><span class="u">mm</span></div>
        <div class="prop-row"><label>Thickness</label><input id="p-tth" type="number" step="0.05" min="0.01" value="${txt.thickness}"><span class="u">mm</span></div>
        <div class="prop-row"><label>Rotation</label><input id="p-tangle" type="number" step="1" value="${txt.angle}"><span class="u">°</span></div>
        <div class="prop-row"><label>Align</label><select id="p-tjust"><option ${txt.justify==='left'?'selected':''}>left</option><option ${txt.justify==='center'?'selected':''}>center</option><option ${txt.justify==='right'?'selected':''}>right</option></select></div>
        <div class="lib-actions"><button class="btn" id="p-rot-btn">Rotate 90°</button><button class="btn danger" id="p-del-btn">Delete</button></div></div>`;
      const updateText = () => {
        pushUndo();
        txt.text = $('p-txt').value;
        txt.layer = $('p-tlayer').value;
        txt.size = Math.max(0.1, parseFloat($('p-tsize').value) || txt.size);
        txt.thickness = Math.max(0.01, parseFloat($('p-tth').value) || txt.thickness);
        txt.angle = ((parseFloat($('p-tangle').value) || 0) % 360 + 360) % 360;
        txt.justify = $('p-tjust').value;
        render();
      };
      ['p-txt','p-tlayer','p-tsize','p-tth','p-tangle','p-tjust'].forEach(id => $(id).addEventListener('change', updateText));
      $('p-rot-btn').addEventListener('click', () => { pushUndo(); txt.angle = (txt.angle + 90) % 360; refreshProps(); render(); });
      $('p-del-btn').addEventListener('click', doDelete);
      return;
    }
    const zn = (board.zones || []).find(z => z.id === selId);
    if (zn) {
      const fill = zoneFills.get(zn.id);
      el.innerHTML = `<div class="prop-group"><h5>Zone</h5>
        <div class="prop-row"><label>Net</label><span>${esc(zn.net || '—')}</span></div>
        <div class="prop-row"><label>Layer</label><span>${zn.layer}</span></div>
        <div class="prop-row"><label>Clearance</label><input id="p-zcl" type="number" step="0.05" min="0" value="${zn.clearance != null ? zn.clearance : ''}" placeholder="net class"></div>
        <div class="prop-row"><label>Filled area</label><span>${fill ? fill.area.toFixed(1) + ' mm²' : '—'}</span></div>
        <div class="lib-actions"><button class="btn" id="p-zrefill">Refill</button><button class="btn danger" id="p-del-btn">Delete</button></div></div>`;
      const zcl = $('p-zcl');
      if (zcl) zcl.addEventListener('change', e => {
        pushUndo();
        const v = parseFloat(e.target.value);
        if (isNaN(v)) delete zn.clearance; else zn.clearance = Math.max(0, v);
        markZonesDirty(true);
      });
      const zr = $('p-zrefill');
      if (zr) zr.addEventListener('click', () => { markZonesDirty(true); setStatus('Zones refilled'); });
      const db = $('p-del-btn');
      if (db) db.addEventListener('click', () => { pushUndo(); B.removeZone(board, zn.id); selId = null; selKind = null; refreshProps(); render(); });
    }
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

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
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    const map = { select: 'sch-select', symbol: 'sch-symbol', wire: 'sch-wire', label: 'sch-label', junction: 'sch-junction' };
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
      tracks.push({ ax: t.start[0], ay: t.start[1], bx: t.end[0], by: t.end[1], r: t.width / 2, net: B.netName(board, t.netId) });
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

  // routing
  function startRoute(x, y) {
    const hit = B.hitPad(board, x, y, pickTol());
    let netId = 0;
    if (hit) netId = hit.pad.netId;
    else if (hiNet != null) netId = hiNet;
    // default width comes from the net's class (W still cycles from there)
    trackWidth = B.netClassOfNet(board, netId).trackWidth;
    route = { pts: [[snap(x), snap(y)]], netId, layer, width: trackWidth };
    if (hit) route.pts = [[hit.pad.at[0], hit.pad.at[1]]];
    setStatus('Routing net "' + B.netName(board, netId) + '" — tap points, double-tap/Enter to finish, V = via+layer');
  }
  function extendRoute(x, y) {
    if (!route) return;
    const last = route.pts[route.pts.length - 1];
    const p = [snap(x), snap(y)];
    if (p[0] === last[0] && p[1] === last[1]) return;
    route.pts.push(p);
  }
  function finishRoute() {
    if (!route || route.pts.length < 2) { route = null; render(); return; }
    pushUndo();
    for (let i = 0; i < route.pts.length - 1; i++) {
      B.addTrack(board, route.pts[i], route.pts[i + 1], route.width, route.layer, route.netId);
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
        board.outline.push([[x0, y0], [x1, y0], [x1, y1], [x0, y0]]);
        outlinePts = null; gfxStart = null;
        render(); setStatus('Rectangle added to outline');
      }
    } else if (tool === 'circle') {