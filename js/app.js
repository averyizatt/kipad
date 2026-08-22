/* Kipad — KiCad-like PCB editor for iPad. Main app. */
'use strict';

(function () {
  const B = window.KipadBoard;
  const R = window.KipadRender;
  const Pcb = window.KipadPcb;
  const Gerber = window.KipadGerber;
  const FPs = window.KipadFootprints;
  const KicadMod = window.KipadKicadMod || null;
  const KicadSym = window.KipadKicadSym || null;
  const Syms = window.KipadSymbols || null;

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  // ---------- State ----------
  let board = B.makeBoard();
  let view = R.makeView();
  let tool = 'select';        // select | highlight | footprint | track | via | line | rect | circle | arc | measure
  let layer = 'F.Cu';         // active copper layer
  let selId = null;           // selected footprint id
  let selKind = null;         // 'footprint' | 'track' | 'via'
  let hiNet = null;           // highlighted net id
  let route = null;           // {pts, netId, layer, width}
  let outlinePts = null;      // current outline polyline being drawn
  let placeLib = null;        // footprint lib name being placed
  let placeAngle = 0;
  let trackWidth = 0.25;
  let viaSize = 0.6, viaDrill = 0.3;
  let grid = 0.25;
  let showRats = true;
  let layerVis = {};          // layer -> bool (undefined = visible)
  let undoStack = [], redoStack = [];
  let dragging = null;        // {fpId, dx, dy} or {pan}
  let pinchDist = null;
  let panning = false, lastPan = null;
  let pointers = new Map();
  let lastTap = 0;
  let measureA = null;
  let crosshair = null;
  let currentTab = 'layers';
  let libQuery = '', symQuery = '';
  let libSel = null, symSel = null;

  const TRACK_WIDTHS = [0.2, 0.25, 0.5, 1.0];
  const GRIDS = [0.1, 0.25, 0.5, 1.0];
  const LAYERS = ['F.Cu', 'B.Cu', 'Edge.Cuts', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'F.Fab', 'B.Fab', 'F.CrtYd', 'B.CrtYd'];

  // ---------- persistence ----------
  const LS_KEY = 'kipad.board.v1';
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ board, view, layer, trackWidth, grid })); } catch (e) {}
  }
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY));
      if (d && d.board) { board = d.board; view = d.view || view; layer = d.layer || layer; trackWidth = d.trackWidth || trackWidth; grid = d.grid || grid; }
    } catch (e) {}
  }

  // ---------- coords ----------
  let cw = 0, ch = 0;
  function w2s(p) { return R.w2s(view, p[0], p[1], cw, ch); }
  function s2w(sx, sy) { return R.s2w(view, sx, sy, cw, ch); }
  function snap(v) { return Math.round(v / grid) * grid; }

  // ---------- undo ----------
  function snapshot() { return JSON.stringify(board); }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  function restore(s) {
    board = JSON.parse(s);
    selId = null; selKind = null; hiNet = null; route = null; outlinePts = null;
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    render(); refreshAll();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    render(); refreshAll();
  }

  // ---------- render ----------
  function render() {
    const state = {
      selId, hiNet, showRats, layerVis,
      activeLayer: layer,
      crosshair: crosshair,
      grid,
      route: route ? { ...route, cursor: routeCursor } : null,
      measure: measureA ? { a: measureA, b: measureB, cur: measureCur } : null
    };
    R.render(ctx, cw, ch, board, view, state);
    $('hud-pos').textContent = fmt(view.x) + ', ' + fmt(view.y) + ' mm';
    $('hud-zoom').textContent = Math.round(view.zoom * 100 / 3) + '%';
    $('hud-tool').textContent = toolName();
    $('st-pos').textContent = 'X: ' + fmt(view.x) + ' Y: ' + fmt(view.y) + ' mm';
    $('st-grid').textContent = 'Grid: ' + grid;
    $('st-zoom').textContent = 'Zoom: ' + Math.round(view.zoom * 100 / 3) + '%';
    $('st-tool').textContent = toolName();
    $('st-layer').textContent = layer;
  }
  let routeCursor = null, measureB = null, measureCur = null;
  function toolName() {
    const m = { select: 'Select', highlight: 'Net Highlight', footprint: 'Footprint', track: 'Route Track', via: 'Via', line: 'Draw Line', rect: 'Draw Rectangle', circle: 'Draw Circle', arc: 'Draw Arc', measure: 'Measure' };
    return m[tool] || tool;
  }
  function fmt(n) { return (Math.round(n * 1000) / 1000).toString(); }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  // ---------- panels ----------
  function setTab(t) {
    currentTab = t;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    ['layers', 'library', 'symbols', 'nets', 'props'].forEach(n => $('tab-' + n).classList.toggle('hidden', n !== t));
    refreshAll();
  }

  function refreshAll() {
    refreshLayers();
    refreshLibrary();
    refreshSymbols();
    refreshNets();
    refreshProps();
  }

  function refreshLayers() {
    const el = $('tab-layers');
    el.innerHTML = '';
    for (const l of LAYERS) {
      const row = document.createElement('div');
      row.className = 'layer-row' + (l === layer ? ' active' : '');
      const vis = layerVis[l] !== false;
      row.innerHTML = `<span class="swatch" style="background:${R.LAYER_COLOR[l] || '#888'}"></span>
        <span class="lname">${l}</span>
        <span class="eye ${vis ? '' : 'off'}">${vis ? '◉' : '○'}</span>`;
      row.addEventListener('click', e => {
        if (e.target.classList.contains('eye')) {
          layerVis[l] = vis ? false : true;
          render(); refreshLayers();
          return;
        }
        if (l === 'F.Cu' || l === 'B.Cu') { layer = l; $('st-layer').textContent = l; }
        render(); refreshLayers();
      });
      el.appendChild(row);
    }
  }

  function refreshLibrary() {
    const el = $('tab-library');
    if (!FPs) { el.innerHTML = '<div class="prop-empty">Library not loaded</div>'; return; }
    const q = libQuery.toLowerCase();
    const names = FPs.listFootprints().filter(n => n.toLowerCase().includes(q));
    let html = `<input class="lib-search" id="lib-q" placeholder="Search footprints…" value="${esc(libQuery)}">
      <div class="lib-actions">
        <button class="btn" id="lib-place" ${libSel ? '' : 'disabled'}>Place</button>
        <button class="btn" id="lib-import">Import .kicad_mod</button>
      </div>
      <canvas class="lib-preview" id="lib-preview"></canvas>
      <div class="side-list">`;
    for (const n of names.slice(0, 200)) {
      const fp = FPs.getFootprint(n);
      html += `<div class="lib-item${n === libSel ? ' active' : ''}" data-name="${esc(n)}">
        <span class="ref">${esc(fp.ref || 'U')}</span> ${esc(n)}<br><span class="desc">${esc((fp.desc || '').slice(0, 60))}</span></div>`;
    }
    html += '</div>';
    el.innerHTML = html;
    const qin = $('lib-q');
    if (qin) qin.addEventListener('input', e => { libQuery = e.target.value; refreshLibrary(); });
    el.querySelectorAll('.lib-item').forEach(it => it.addEventListener('click', () => {
      libSel = it.dataset.name;
      refreshLibrary();
      drawFpPreview($('lib-preview'), FPs.getFootprint(libSel));
    }));
    const place = $('lib-place');
    if (place) place.addEventListener('click', () => {
      if (!libSel) return;
      setTool('footprint'); placeLib = libSel; placeAngle = 0;
      setStatus('Tap board to place ' + libSel + ' (R rotate, Esc stop)');
    });
    const imp = $('lib-import');
    if (imp) imp.addEventListener('click', () => $('file-import').click());
    if (libSel) drawFpPreview($('lib-preview'), FPs.getFootprint(libSel));
  }

  function refreshSymbols() {
    const el = $('tab-symbols');
    if (!Syms) { el.innerHTML = '<div class="prop-empty">Symbol library not loaded</div>'; return; }
    const q = symQuery.toLowerCase();
    const names = Syms.listSymbols().filter(n => n.toLowerCase().includes(q));
    let html = `<input class="lib-search" id="sym-q" placeholder="Search symbols…" value="${esc(symQuery)}">
      <div class="lib-actions"><button class="btn" id="sym-import">Import .kicad_sym</button></div>
      <canvas class="lib-preview" id="sym-preview"></canvas>
      <div class="side-list">`;
    for (const n of names.slice(0, 300)) {
      const s = Syms.getSymbol(n);
      html += `<div class="lib-item${n === symSel ? ' active' : ''}" data-name="${esc(n)}">
        <span class="ref">${esc(s.ref || 'U')}</span> ${esc(n)}${s.desc ? `<br><span class="desc">${esc(s.desc.slice(0, 60))}</span>` : ''}</div>`;
    }
    html += '</div>';
    el.innerHTML = html;
    const qin = $('sym-q');
    if (qin) qin.addEventListener('input', e => { symQuery = e.target.value; refreshSymbols(); });
    el.querySelectorAll('.lib-item').forEach(it => it.addEventListener('click', () => {
      symSel = it.dataset.name;
      refreshSymbols();
      drawSymbolPreview($('sym-preview'), Syms.getSymbol(symSel));
    }));
    const imp = $('sym-import');
    if (imp) imp.addEventListener('click', () => $('file-import').click());
    if (symSel) drawSymbolPreview($('sym-preview'), Syms.getSymbol(symSel));
  }

  function refreshNets() {
    const el = $('tab-nets');
    let html = `<div class="net-add"><input id="net-name" placeholder="New net name…"><button class="btn" id="net-add">+</button></div>`;
    for (const n of board.nets) {
      if (n.id === 0) continue;
      let count = 0;
      for (const fp of board.footprints) for (const p of fp.pads) if (p.netId === n.id) count++;
      html += `<div class="net-row${hiNet === n.id ? ' hi' : ''}" data-id="${n.id}"><span>${esc(n.name)}</span><span style="margin-left:auto;color:var(--fg-dim)">${count} pad${count === 1 ? '' : 's'}</span></div>`;
    }
    el.innerHTML = html || '<div class="prop-empty">No nets yet</div>';
    el.querySelectorAll('.net-row').forEach(r => r.addEventListener('click', () => {
      const id = Number(r.dataset.id);
      hiNet = (hiNet === id) ? null : id;
      refreshNets(); render();
    }));
    const add = $('net-add');
    if (add) add.addEventListener('click', () => {
      const inp = $('net-name');
      const name = inp.value.trim();
      if (name) { B.addNet(board, name); refreshNets(); }
      inp.value = '';
    });
  }

  function refreshProps() {
    const el = $('tab-props');
    if (!selId) {
      el.innerHTML = '<div class="prop-empty">Select a footprint, track or via</div>';
      return;
    }
    const fp = board.footprints.find(f => f.id === selId);
    if (fp) {
      el.innerHTML = `<div class="prop-group"><h5>Footprint</h5>
        <div class="prop-row"><label>Ref</label><input id="p-ref" value="${esc(fp.ref)}"></div>
        <div class="prop-row"><label>Value</label><input id="p-val" value="${esc(fp.value)}"></div>
        <div class="prop-row"><label>X</label><input id="p-x" value="${fmt(fp.at[0])}"></div>
        <div class="prop-row"><label>Y</label><input id="p-y" value="${fmt(fp.at[1])}"></div>
        <div class="prop-row"><label>Rotation</label><input id="p-rot" value="${fp.angle}"></div>
        <div class="prop-row"><label>Layer</label><select id="p-layer"><option ${fp.layer==='F.Cu'?'selected':''}>F.Cu</option><option ${fp.layer==='B.Cu'?'selected':''}>B.Cu</option></select></div>
        <div class="lib-actions"><button class="btn" id="p-rot-btn">Rotate 90°</button><button class="btn danger" id="p-del-btn">Delete</button></div>
      </div>`;
      const ref = $('p-ref');
      if (ref) ref.addEventListener('change', e => { pushUndo(); fp.ref = e.target.value || fp.ref; render(); });
      const val = $('p-val');
      if (val) val.addEventListener('change', e => { pushUndo(); fp.value = e.target.value; render(); });
      const px = $('p-x'), py = $('p-y');
      const applyPos = () => {
        pushUndo();
        const x = parseFloat(px.value), y = parseFloat(py.value);
        if (!isNaN(x) && !isNaN(y)) B.moveFootprint(board, fp.id, [x, y]);
        render();
      };
      if (px) px.addEventListener('change', applyPos);
      if (py) py.addEventListener('change', applyPos);
      const prot = $('p-rot');
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
    if (t !== 'footprint') placeLib = null;
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    const map = { select: 'tool-select', highlight: 'tool-highlight', footprint: 'tool-footprint', track: 'tool-track', via: 'tool-via', line: 'tool-line', rect: 'tool-rect', circle: 'tool-circle', arc: 'tool-arc', measure: 'tool-measure' };
    if (map[t]) $(map[t]).classList.add('active');
    if (t === 'measure') { measureA = null; measureB = null; measureCur = null; }
    render();
  }

  // ---------- actions ----------
  function doDelete() {
    if (selId) {
      pushUndo();
      const fp = board.footprints.find(f => f.id === selId);
      if (fp) board.footprints = board.footprints.filter(f => f.id !== selId);
      else if (board.tracks.find(t => t.id === selId)) board.tracks = board.tracks.filter(t => t.id !== selId);
      else if (board.vias.find(v => v.id === selId)) board.vias = board.vias.filter(v => v.id !== selId);
      selId = null; selKind = null;
      render(); refreshAll();
    }
  }
  function doRotateSel() {
    if (selId) { pushUndo(); B.rotateFootprint(board, selId, 90); render(); refreshProps(); }
    else if (tool === 'footprint') { placeAngle = (placeAngle + 90) % 360; render(); }
  }
  function switchLayer() {
    layer = layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
    $('st-layer').textContent = layer;
    refreshLayers(); render();
  }

  // routing
  function startRoute(x, y) {
    const hit = B.hitPad(board, x, y, 0.3);
    let netId = 0;
    if (hit) netId = hit.pad.netId;
    else if (hiNet != null) netId = hiNet;
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
    const v = B.addVia(board, [snap(x), snap(y)], viaSize, viaDrill, netId);
    if (route) route.layer = route.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
    render(); refreshAll();
    return v;
  }

  // outline graphics (line/rect/circle/arc → Edge.Cuts polylines)
  let gfxStart = null;
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
  function runDRC() {
    const panel = $('drc-panel');
    const viol = B.runDRC(board);
    panel.classList.remove('hidden');
    if (!viol.length) {
      panel.innerHTML = '<h4>DRC</h4><div class="drc-clear">✓ No clearance violations</div>';
    } else {
      panel.innerHTML = '<h4>DRC — ' + viol.length + ' violation(s)</h4>' +
        viol.slice(0, 40).map(v =>
          `<div class="drc-item">${v.type} <b>${v.netA}↔${v.netB}</b> gap ${v.dist}mm (min ${v.clearance}) @${v.x},${v.y} ${v.layer}</div>`
        ).join('');
    }
  }

  // ---------- save/open/export ----------
  function doSave() {
    if (!Pcb) { setStatus('kicad_pcb module not loaded'); return; }
    const text = Pcb.serializeBoard(board);
    download('kipad.kicad_pcb', text, 'application/x-kicad-pcb');
    setStatus('Saved .kicad_pcb');
  }
  function doOpen(file) {
    if (!Pcb) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        pushUndo();
        board = Pcb.parseBoard(r.result);
        selId = null; hiNet = null; route = null; outlinePts = null;
        render(); refreshAll(); setStatus('Opened ' + file.name);
      } catch (e) { setStatus('Open failed: ' + e.message); }
    };
    r.readAsText(file);
  }
  function doGerber() {
    if (!Gerber) { setStatus('Gerber module not loaded'); return; }
    const out = Gerber.exportAll(board);
    for (const [l, g] of Object.entries(out)) {
      download(`kipad-${l.replace(/[^A-Za-z0-9]/g, '')}.gbr`, g, 'application/gerber');
    }
    setStatus('Gerber exported (F.Cu, B.Cu, Edge.Cuts)');
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

  // ---------- pointer handling ----------
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [wx, wy] = s2w(e.clientX, e.clientY);
    crosshair = [wx, wy];

    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      return;
    }

    if (tool === 'footprint' && placeLib) {
      pushUndo();
      B.placeFootprint(board, placeLib, [snap(wx), snap(wy)], placeAngle, layer);
      selId = board.footprints[board.footprints.length - 1].id;
      selKind = 'footprint';
      render(); refreshAll();
      return;
    }
    if (tool === 'track') {
      if (!route) startRoute(wx, wy);
      else extendRoute(wx, wy);
      render();
      return;
    }
    if (tool === 'via') {
      addViaHere(wx, wy);
      return;
    }
    if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc') {
      if (!gfxStart) startGfx(wx, wy);
      else extendGfx(wx, wy);
      render();
      return;
    }
    if (tool === 'measure') {
      if (!measureA) {
        measureA = [wx, wy]; measureB = null; measureCur = null;
        setStatus('Measure: tap second point');
      } else {
        measureB = [wx, wy];
        const d = Math.hypot(measureB[0] - measureA[0], measureB[1] - measureA[1]);
        setStatus('Distance: ' + d.toFixed(3) + ' mm (ΔX ' + Math.abs(measureB[0] - measureA[0]).toFixed(3) + ', ΔY ' + Math.abs(measureB[1] - measureA[1]).toFixed(3) + ')');
        measureA = null; measureB = null;
      }
      render();
      return;
    }
    if (tool === 'highlight') {
      const hit = B.hitPad(board, wx, wy, 0.3);
      hiNet = hit ? hit.pad.netId : null;
      refreshNets(); render();
      return;
    }

    // select tool
    const padHit = B.hitPad(board, wx, wy, 0.3);
    const fpHit = B.hitFootprint(board, wx, wy, 0.3);
    const trHit = B.hitTrack(board, wx, wy, 0.2);
    const viaHit = B.hitVia(board, wx, wy, 0.2);
    if (padHit) {
      selId = padHit.fp.id; selKind = 'footprint';
      hiNet = padHit.pad.netId;
      dragging = { fpId: padHit.fp.id, dx: wx - padHit.fp.at[0], dy: wy - padHit.fp.at[1] };
    } else if (fpHit) {
      selId = fpHit.id; selKind = 'footprint';
      dragging = { fpId: fpHit.id, dx: wx - fpHit.at[0], dy: wy - fpHit.at[1] };
    } else if (trHit) {
      selId = trHit.id; selKind = 'track';
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    } else if (viaHit) {
      selId = viaHit.id; selKind = 'via';
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    } else {
      selId = null; selKind = null; hiNet = null;
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    }
    render(); refreshAll();
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [wx, wy] = s2w(e.clientX, e.clientY);
    crosshair = [wx, wy];
    routeCursor = (tool === 'track' && route) ? [wx, wy] : null;
    if (measureA) measureCur = [wx, wy];

    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (pinchDist) {
        const mid = [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
        const factor = d / pinchDist;
        const [mw, mwy] = s2w(mid[0], mid[1]);
        view.zoom = Math.max(0.5, Math.min(50, view.zoom * factor));
        const [nw, nwy] = s2w(mid[0], mid[1]);
        view.x += mw - nw; view.y += mwy - nwy;
        pinchDist = d;
      }
      render();
      return;
    }

    if (dragging && dragging.pan) {
      const dx = (e.clientX - lastPan.x) / view.zoom;
      const dy = (e.clientY - lastPan.y) / view.zoom;
      view.x -= dx; view.y -= dy;
      lastPan = { x: e.clientX, y: e.clientY };
      render();
      return;
    }
    if (dragging && dragging.fpId) {
      const fp = board.footprints.find(f => f.id === dragging.fpId);
      if (fp) {
        B.moveFootprint(board, fp.id, [snap(wx - dragging.dx), snap(wy - dragging.dy)]);
        render();
      }
    } else {
      render();
    }
  });

  canvas.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    const wasDragging = dragging;
    dragging = null; lastPan = null;

    const now = Date.now();
    if ((tool === 'track' && route) || ((tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc') && gfxStart)) {
      if (now - lastTap < 350) {
        if (tool === 'track') finishRoute();
        else { outlinePts = null; gfxStart = null; render(); }
        lastTap = 0;
        return;
      }
    }
    lastTap = now;
    if (wasDragging && wasDragging.fpId) pushUndo();
  });

  canvas.addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    dragging = null; lastPan = null;
  });

  canvas.addEventListener('pointerleave', () => { crosshair = null; });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const [mx, my] = [e.clientX, e.clientY];
    const [mw, mwy] = s2w(mx, my);
    view.zoom = Math.max(0.5, Math.min(50, view.zoom * factor));
    const [nw, nwy] = s2w(mx, my);
    view.x += mw - nw; view.y += mwy - nwy;
    render();
  }, { passive: false });

  // ---------- keyboard ----------
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 's': case 'S': setTool('select'); break;
      case 'h': case 'H': setTool('highlight'); break;
      case 'f': case 'F': setTool('footprint'); break;
      case 'x': case 'X': setTool('track'); break;
      case 'v': case 'V':
        if (tool === 'track' && route && route.pts.length) {
          addViaHere(route.pts[route.pts.length - 1][0], route.pts[route.pts.length - 1][1]);
        } else setTool('via');
        break;
      case 'l': case 'L': setTool('line'); break;
      case 'm': case 'M': setTool('measure'); break;
      case 'g': case 'G': cycleGrid(); break;
      case 'n': case 'N': showRats = !showRats; $('btn-rats').classList.toggle('active', showRats); render(); break;
      case 'r': case 'R': doRotateSel(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); doDelete(); break;
      case 'Enter':
        if (tool === 'track') finishRoute();
        else if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc') { outlinePts = null; gfxStart = null; render(); }
        break;
      case 'Escape':
        route = null; outlinePts = null; gfxStart = null; placeLib = null; measureA = null; measureB = null;
        setTool('select'); break;
      case 'w':
        trackWidth = TRACK_WIDTHS[(TRACK_WIDTHS.indexOf(trackWidth) + 1) % TRACK_WIDTHS.length];
        setStatus('Track width: ' + trackWidth + ' mm'); break;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
  });

  function cycleGrid() {
    grid = GRIDS[(GRIDS.indexOf(grid) + 1) % GRIDS.length];
    setStatus('Grid: ' + grid + ' mm');
    render();
  }

  // ---------- toolbar / rail wiring ----------
  $('tool-select').addEventListener('click', () => setTool('select'));
  $('tool-highlight').addEventListener('click', () => setTool('highlight'));
  $('tool-footprint').addEventListener('click', () => setTool('footprint'));
  $('tool-track').addEventListener('click', () => setTool('track'));
  $('tool-via').addEventListener('click', () => setTool('via'));
  $('tool-line').addEventListener('click', () => setTool('line'));
  $('tool-rect').addEventListener('click', () => setTool('rect'));
  $('tool-circle').addEventListener('click', () => setTool('circle'));
  $('tool-arc').addEventListener('click', () => setTool('arc'));
  $('tool-measure').addEventListener('click', () => setTool('measure'));
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-zoomin').addEventListener('click', () => { view.zoom = Math.min(50, view.zoom * 1.25); render(); });
  $('btn-zoomout').addEventListener('click', () => { view.zoom = Math.max(0.5, view.zoom / 1.25); render(); });
  $('btn-zoomfit').addEventListener('click', zoomFit);
  $('btn-grid').addEventListener('click', cycleGrid);
  $('btn-rats').addEventListener('click', () => { showRats = !showRats; $('btn-rats').classList.toggle('active', showRats); render(); });
  $('btn-drc').addEventListener('click', () => { runDRC(); render(); });
  $('btn-gerber').addEventListener('click', doGerber);
  $('btn-new').addEventListener('click', () => {
    if (board.footprints.length && !confirm('Clear board?')) return;
    pushUndo();
    board = B.makeBoard(); selId = null; hiNet = null; route = null; outlinePts = null;
    render(); refreshAll();
  });
  $('btn-open').addEventListener('click', () => $('file-open').click());
  $('btn-save').addEventListener('click', doSave);
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-open').addEventListener('change', e => { if (e.target.files[0]) doOpen(e.target.files[0]); e.target.value = ''; });
  $('file-import').addEventListener('change', e => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ''; });

  // tabs
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---------- menus ----------
  const MENUS = {
    file: [
      ['New board', () => $('btn-new').click(), ''],
      ['Open .kicad_pcb…', () => $('btn-open').click(), ''],
      ['Save .kicad_pcb', doSave, ''],
      ['Import .kicad_mod/.kicad_sym…', () => $('btn-import').click(), ''],
      ['Export Gerber', doGerber, '']
    ],
    edit: [
      ['Undo', undo, '⌘Z'],
      ['Redo', redo, '⌘Y'],
      ['Delete selection', doDelete, '⌫'],
      ['Rotate 90°', doRotateSel, 'R']
    ],
    view: [
      ['Zoom in', () => $('btn-zoomin').click(), ''],
      ['Zoom out', () => $('btn-zoomout').click(), ''],
      ['Zoom to fit', zoomFit, ''],
      ['Grid: ' + grid + ' mm', cycleGrid, 'G'],
      ['Ratsnest: ' + (showRats ? 'on' : 'off'), () => $('btn-rats').click(), 'N'],
      ['Layer: ' + layer, switchLayer, 'L']
    ],
    place: [
      ['Footprint…', () => { setTab('library'); setTool('footprint'); }, 'F'],
      ['Track', () => setTool('track'), 'X'],
      ['Via', () => setTool('via'), 'V']
    ],
    route: [
      ['Finish track', () => { if (tool === 'track') finishRoute(); }, 'Enter'],
      ['Via + switch layer', () => { if (tool === 'track' && route && route.pts.length) addViaHere(route.pts[route.pts.length - 1][0], route.pts[route.pts.length - 1][1]); }, 'V'],
      ['Track width: ' + trackWidth + ' mm', () => { trackWidth = TRACK_WIDTHS[(TRACK_WIDTHS.indexOf(trackWidth) + 1) % TRACK_WIDTHS.length]; setStatus('Track width: ' + trackWidth + ' mm'); }, 'W']
    ],
    inspect: [
      ['Run DRC', () => $('btn-drc').click(), ''],
      ['Measure', () => setTool('measure'), 'M']
    ],
    help: [
      ['How to use', showHelp, ''],
      ['Shortcuts', showShortcuts, '']
    ]
  };
  document.querySelectorAll('.menu').forEach(m => {
    m.addEventListener('click', e => {
      e.stopPropagation();
      const pop = $('menu-popup');
      const open = pop.classList.contains('hidden');
      document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
      if (!open) { pop.classList.add('hidden'); return; }
      m.classList.add('open');
      const items = MENUS[m.dataset.menu] || [];
      pop.innerHTML = items.map(([label, , kbd]) =>
        `<div class="mi">${label}${kbd ? `<span class="kbd">${kbd}</span>` : ''}</div>`).join('');
      pop.querySelectorAll('.mi').forEach((mi, i) => mi.addEventListener('click', () => {
        pop.classList.add('hidden');
        document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
        items[i][1]();
      }));
      pop.classList.remove('hidden');
    });
  });
  document.addEventListener('click', () => {
    $('menu-popup').classList.add('hidden');
    document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
  });

  function showHelp() {
    showModal('Kipad — PCB Layout Editor', `
      <b>Tools (left rail)</b><br>
      ➤ Select — tap pad/footprint to select (tap pad = highlight net), drag to move<br>
      ⌁ Net Highlight — tap a pad to highlight its net<br>
      ▣ Footprint — pick from Library panel, tap board to place, R rotates<br>
      ╱ Route Track — tap pad to start (uses its net), tap for corners, double-tap/Enter to finish, V = via + layer<br>
      ◎ Via — tap to place a via<br>
      ╲ ▭ ◯ ◠ — draw line / rectangle / circle / arc on the board outline (Edge.Cuts)<br>
      📏 Measure — tap two points to read distance<br><br>
      <b>Right panel</b>: Layers (visibility + active layer) · Library (real KiCad footprints, search, place, import .kicad_mod) · Symbols (real KiCad symbols, search, import .kicad_sym) · Nets (highlight, add) · Properties (edit selection)<br><br>
      <b>Shortcuts</b>: S select · H highlight · F footprint · X route · V via · L line · M measure · G grid · N ratsnest · R rotate · W width · Del delete · Ctrl+Z/Y undo/redo<br><br>
      <b>File</b>: Save = .kicad_pcb · Open = .kicad_pcb · Gerber = F.Cu/B.Cu/Edge.Cuts RS-274X · DRC = clearance (0.2mm)<br>
      Works offline. Add to Home Screen for fullscreen.
    `);
  }
  function showShortcuts() {
    showModal('Shortcuts', `
      S select · H net highlight · F footprint · X route · V via · L line · M measure<br>
      G grid cycle · N ratsnest · R rotate · W track width · Del delete<br>
      Enter finish · Esc cancel · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo<br>
      Pinch to zoom · drag empty area to pan
    `);
  }
  $('modal-cancel').addEventListener('click', hideModal);
  $('modal-ok').addEventListener('click', hideModal);

  function zoomFit() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const fp of board.footprints) for (const p of fp.pads) {
      x0 = Math.min(x0, p.at[0]); x1 = Math.max(x1, p.at[0]);
      y0 = Math.min(y0, p.at[1]); y1 = Math.max(y1, p.at[1]);
    }
    for (const t of board.tracks) {
      x0 = Math.min(x0, t.start[0], t.end[0]); x1 = Math.max(x1, t.start[0], t.end[0]);
      y0 = Math.min(y0, t.start[1], t.end[1]); y1 = Math.max(y1, t.start[1], t.end[1]);
    }
    for (const poly of board.outline) for (const p of poly) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    if (!isFinite(x0)) { view = R.makeView(); render(); return; }
    const w = (x1 - x0) || 10, h = (y1 - y0) || 10;
    view.zoom = Math.max(0.5, Math.min(20, Math.min(canvas.width / w, canvas.height / h) * 0.9));
    view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
    render();
  }

  // ---------- library loading ----------
  function loadLibraries() {
    const jobs = [];
    if (FPs && FPs.loadLibrary) {
      jobs.push(fetch('lib/footprints.json').then(r => r.ok ? r.json() : null).then(data => {
        if (data && data.length) { FPs.loadLibrary(data); setStatus('Loaded ' + data.length + ' footprints'); }
      }).catch(() => {}));
    }
    if (Syms && Syms.loadLibrary) {
      jobs.push(fetch('lib/symbols.json').then(r => r.ok ? r.json() : null).then(data => {
        if (data && data.length) { Syms.loadLibrary(data); setStatus('Loaded ' + data.length + ' symbols'); }
      }).catch(() => {}));
    }
    Promise.all(jobs).then(() => { refreshLibrary(); refreshSymbols(); });
  }

  // ---------- init ----------
  loadLocal();
  setTab('layers');
  setTool('select');
  refreshAll();
  window.addEventListener('resize', resize);
  resize();
  render();
  loadLibraries();

  setInterval(saveLocal, 3000);
  window.addEventListener('beforeunload', saveLocal);

  // demo board if empty
  if (!board.footprints.length) {
    try {
      B.addNet(board, 'GND');
      B.addNet(board, 'VCC');
      const r1 = B.placeFootprint(board, 'R_0603_1608Metric', [0, 0], 0, 'F.Cu', 'R');
      const c1 = B.placeFootprint(board, 'C_0603_1608Metric', [3, 0], 90, 'F.Cu', 'C');
      const u1 = B.placeFootprint(board, 'SOIC-8_3.9x4.9mm_P1.27mm', [1.5, 3.5], 0, 'F.Cu', 'U');
      r1.pads[0].netId = 1; r1.pads[1].netId = 2;
      c1.pads[0].netId = 1; c1.pads[1].netId = 2;
      u1.pads.forEach((p, i) => { p.netId = (i % 4 === 0) ? 1 : 0; });
      board.outline.push([[-2, -1], [6.5, -1], [6.5, 6], [-2, 6], [-2, -1]]);
      zoomFit();
    } catch (e) { /* footprints module may not be ready */ }
  }
})();
