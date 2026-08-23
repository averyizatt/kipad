/* Kipad — KiCad-like PCB editor for iPad. Main app. */
'use strict';

(function () {
  const B = window.KipadBoard;
  const R = window.KipadRender;
  const Pcb = window.KipadPcb;
  const Gerber = window.KipadGerber;
  const Drill = window.KipadDrill || null;
  const FPs = window.KipadFootprints;
  const KicadMod = window.KipadKicadMod || null;
  const KicadSym = window.KipadKicadSym || null;
  const Syms = window.KipadSymbols || null;
  const Z = window.KipadZones || null;

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  // ---------- State ----------
  let board = B.makeBoard();
  let view = R.makeView();
  let tool = 'select';        // select | highlight | footprint | track | via | zone | text | line | rect | circle | arc | measure
  let layer = 'F.Cu';         // active copper layer
  let selId = null;           // selected footprint id
  let selKind = null;         // 'footprint' | 'track' | 'via'
  let hiNet = null;           // highlighted net id
  let route = null;           // {pts, netId, layer, width}
  let outlinePts = null;      // current outline polyline being drawn
  let zonePts = null;         // copper zone outline being placed {pts, netId}
  const zoneFills = new Map(); // zone.id -> KipadZones fill result (not saved)
  let zonesDirty = true;      // refill needed before fills are trustworthy
  let zoneTimer = null;
  let textPlace = null;       // board text preview/settings while placing
  let placeLib = null;        // footprint lib name being placed
  let placeAngle = 0;
  let trackWidth = 0.25;
  let grid = 0.25;
  let showRats = true;
  let layerVis = {};          // layer -> bool (undefined = visible)
  let undoStack = [], redoStack = [];
  let dragging = null;        // {fpId, dx, dy} or {pan}
  let pinchDist = null;
  let panning = false, lastPan = null;
  let pointers = new Map();
  let penDown = null;       // active Apple Pencil pointerId (for palm rejection)
  let lastPenTap = 0;       // for pencil double-tap → Select
  let lastTap = 0;
  let measureA = null;
  let crosshair = null;
  let currentTab = 'layers';
  let libQuery = '', symQuery = '';
  let libSel = null, symSel = null;

  // ---------- mode + schematic state ----------
  const Sch = window.KipadSchematic;
  const Erc = window.KipadErc || null;
  let mode = 'launcher';        // 'launcher' | 'schematic' | 'pcb'
  let sch = null;               // schematic model
  let schTool = 'select';       // select | symbol | wire | label | junction
  let schSelId = null;          // selected symbol id
  let schWirePts = [];          // in-progress wire
  let schPlaceName = null;      // symbol being placed
  let schAngle = 0;
  let schUndo = [], schRedo = [];
  let schDrag = null;           // {symId, dx, dy}
  let schWireCur = null;
  let ercViolations = [];       // cached ERC results (recomputed on change)
  let ercDirty = true;
  const PLUGINS_KEY = 'kipad.plugins.v1';
  let plugins = {};             // name -> {name, enabled}
  let installedPlugins = [];    // {name, fn} loaded from files

  const TRACK_WIDTHS = [0.2, 0.25, 0.5, 1.0];
  const GRIDS = [0.1, 0.25, 0.5, 1.0];
  const LAYERS = ['F.Cu', 'B.Cu', 'Edge.Cuts', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'F.Fab', 'B.Fab', 'F.CrtYd', 'B.CrtYd'];

  // ---------- persistence ----------
  const LS_KEY = 'kipad.board.v1';
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ board, view, layer, grid })); } catch (e) {}
  }
  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY));
      if (d && d.board) { board = d.board; view = d.view || view; layer = d.layer || layer; grid = d.grid || grid; }
    } catch (e) {}
    B.ensureNetClasses(board);
    // the net class of the default net is the source of truth for the
    // starting track width (W still cycles from there)
    trackWidth = B.netClassOfNet(board, 0).trackWidth;
    if (!Array.isArray(board.zones)) board.zones = [];
    if (!Array.isArray(board.texts)) board.texts = [];
    markZonesDirty(true);
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
    markZonesDirty();   // any board mutation may change copper connectivity
  }
  function restore(s) {
    board = JSON.parse(s);
    B.ensureNetClasses(board);
    selId = null; selKind = null; hiNet = null; route = null; outlinePts = null;
    zonePts = null;
    markZonesDirty(true);
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
    if (mode === 'schematic') { renderSchematicView(); return; }
    const state = {
      selId, selKind, hiNet, showRats, layerVis,
      activeLayer: layer,
      crosshair: crosshair,
      grid,
      route: route ? { ...route, cursor: routeCursor } : null,
      measure: measureA ? { a: measureA, b: measureB, cur: measureCur } : null,
      zoneDraft: (tool === 'zone' && zonePts) ? zonePts.pts : null,
      zoneFills,
      textPreview: (tool === 'text' && textPlace && crosshair)
        ? { ...textPlace, at: [snap(crosshair[0]), snap(crosshair[1])] } : null
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
    $('st-zones').textContent = 'Zones: ' + ((board.zones || []).length);
  }
  let routeCursor = null, measureB = null, measureCur = null;
  function toolName() {
    const m = { select: 'Select', highlight: 'Net Highlight', footprint: 'Footprint', track: 'Route Track', via: 'Via', zone: 'Add Zone', text: 'Add Text', line: 'Draw Line', rect: 'Draw Rectangle', circle: 'Draw Circle', arc: 'Draw Arc', measure: 'Measure' };
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
    // refresh only the active pane — rebuilding all five panels on every tab
    // switch was the main source of the slow schematic/editor open
    if (t === 'layers') refreshLayers();
    else if (t === 'library') refreshLibrary();
    else if (t === 'symbols') refreshSymbols();
    else if (t === 'nets') refreshNets();
    else if (t === 'props') refreshProps();
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
    for (const n of names.slice(0, 100)) {
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
    for (const n of names.slice(0, 150)) {
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
    B.ensureNetClasses(board);
    let html = `<div class="net-add"><input id="net-name" placeholder="New net name…"><button class="btn" id="net-add">+</button></div>
      <div class="lib-actions"><button class="btn" id="net-classes">Net Classes…</button></div>`;
    for (const n of board.nets) {
      if (n.id === 0) continue;
      let count = 0;
      for (const fp of board.footprints) for (const p of fp.pads) if (p.netId === n.id) count++;
      const cls = B.netClassOfNet(board, n.id);
      html += `<div class="net-row${hiNet === n.id ? ' hi' : ''}" data-id="${n.id}"><span>${esc(n.name)}</span><span class="net-class">${esc(cls.name)}</span><span style="margin-left:auto;color:var(--fg-dim)">${count} pad${count === 1 ? '' : 's'}</span></div>`;
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
    const nc = $('net-classes');
    if (nc) nc.addEventListener('click', showNetClasses);
  }

  // ---------- net classes modal (KiCad "Edit Net Classes" dialog) ----------
  function buildNetClassesBody() {
    B.ensureNetClasses(board);
    const nets = board.nets.filter(n => n.id !== 0);
    let html = `<div class="netclass-list">`;
    for (const c of board.netClasses) {
      const inClass = nets.filter(n => B.netClassOfNet(board, n.id).id === c.id);
      const avail = nets.filter(n => B.netClassOfNet(board, n.id).id !== c.id);
      const chips = inClass.map(n =>
        `<span class="nc-chip" data-nid="${n.id}" title="Tap to move to Default">${esc(n.name || '—')} ✕</span>`).join('') || '<span class="desc">No nets assigned</span>';
      const opts = avail.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('');
      html += `<div class="prop-group netclass-card" data-cid="${c.id}">
        <h5>${c.id === 0 ? 'Default Class' : 'Class ' + c.id}${c.id === 0 ? ' <span class="desc">(always present)</span>' : ''}</h5>
        <div class="prop-row"><label>Name</label><input class="nc-name" value="${esc(c.name)}"></div>
        <div class="prop-row"><label>Track W</label><input class="nc-tw" type="number" step="0.05" min="0.01" value="${c.trackWidth}"><span class="u">mm</span></div>
        <div class="prop-row"><label>Clearance</label><input class="nc-cl" type="number" step="0.05" min="0" value="${c.clearance}"><span class="u">mm</span></div>
        <div class="prop-row"><label>Via size</label><input class="nc-vs" type="number" step="0.1" min="0.1" value="${c.viaSize}"><span class="u">mm</span></div>
        <div class="prop-row"><label>Via drill</label><input class="nc-vd" type="number" step="0.05" min="0.05" value="${c.viaDrill}"><span class="u">mm</span></div>
        <div class="prop-row"><label>Nets</label>
          <span class="nc-nets">${chips}</span>
          <select class="nc-add" ${avail.length ? '' : 'disabled'}><option value="">Add net…</option>${opts}</select>
        </div>
        <div class="lib-actions">${c.id === 0 ? '<span class="desc">Nets with no class use Default</span>' : '<button class="btn danger nc-rm">Remove class</button>'}</div>
      </div>`;
    }
    html += `</div><div class="lib-actions"><button class="btn primary" id="nc-add-class">+ Add Class</button></div>`;
    return html;
  }
  function rebuildNetClasses() {
    const body = $('modal-body');
    if (body) { body.innerHTML = buildNetClassesBody(); wireNetClasses(); }
    refreshNets();
  }
  function wireNetClasses() {
    const body = $('modal-body');
    if (!body) return;
    const upd = (el, fn) => { if (el) el.addEventListener('input', () => fn(el)); };
    body.querySelectorAll('.netclass-card').forEach(card => {
      const cid = Number(card.dataset.cid);
      const cls = B.getNetClass(board, cid);
      const num = (el, fallback) => { const v = parseFloat(el.value); return isNaN(v) ? fallback : v; };
      upd(card.querySelector('.nc-name'), el => { B.renameNetClass(board, cid, el.value); });
      upd(card.querySelector('.nc-tw'), el => { cls.trackWidth = Math.max(0.01, num(el, cls.trackWidth)); });
      upd(card.querySelector('.nc-cl'), el => { cls.clearance = Math.max(0, num(el, cls.clearance)); });
      upd(card.querySelector('.nc-vs'), el => { cls.viaSize = Math.max(0.1, num(el, cls.viaSize)); });
      upd(card.querySelector('.nc-vd'), el => { cls.viaDrill = Math.max(0.05, num(el, cls.viaDrill)); });
      const add = card.querySelector('.nc-add');
      if (add) add.addEventListener('change', () => {
        const nid = Number(add.value);
        if (nid) { B.setNetClass(board, nid, cid); setStatus('Net "' + B.netName(board, nid) + '" → class ' + cls.name); rebuildNetClasses(); }
        add.value = '';
      });
      card.querySelectorAll('.nc-chip').forEach(chip => chip.addEventListener('click', () => {
        const nid = Number(chip.dataset.nid);
        B.setNetClass(board, nid, 0);
        setStatus('Net "' + B.netName(board, nid) + '" → Default');
        rebuildNetClasses();
      }));
      const rm = card.querySelector('.nc-rm');
      if (rm) rm.addEventListener('click', () => {
        if (B.removeNetClass(board, cid)) { setStatus('Class removed — nets moved to Default'); rebuildNetClasses(); }
      });
    });
    const addCls = $('nc-add-class');
    if (addCls) addCls.addEventListener('click', () => {
      const id = B.addNetClass(board, '');
      setStatus('Added class "' + B.getNetClass(board, id).name + '"');
      rebuildNetClasses();
    });
  }
  function showNetClasses() {
    B.ensureNetClasses(board);
    showModal('Net Classes', buildNetClassesBody());
    wireNetClasses();
  }

  function refreshProps() {
    const el = $('tab-props');
    if (!selId) {
      el.innerHTML = '<div class="prop-empty">Select a footprint, track, via, zone or text</div>';
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
    setTool('text');
    // setTool clears textPlace when switching away only; restore after the switch
    textPlace = { text: value.trim(), layer: layer === 'B.Cu' ? 'B.SilkS' : 'F.SilkS', size: 1.5, thickness: 0.3, angle: 0, justify: 'center' };
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
  function runDRC() {
    const panel = $('drc-panel');
    const viol = B.runDRC(board);
    panel.classList.remove('hidden');
    if (!viol.length) {
      panel.innerHTML = '<h4>DRC</h4><div class="drc-clear">✓ No clearance violations</div>';
    } else {
      panel.innerHTML = '<h4>DRC — ' + viol.length + ' violation(s)</h4>' +
        viol.slice(0, 40).map(v =>
          `<div class="drc-item">${v.type} <b>${v.netA}↔${v.netB}</b> gap ${v.dist}mm (min ${v.clearance}mm ${v.classA}↔${v.classB}) @${v.x},${v.y} ${v.layer}</div>`
        ).join('');
    }
  }

  // ---------- ERC (schematic electrical rules check) ----------
  function refreshErc() {
    ercViolations = (Erc && sch) ? Erc.runERC(sch, Syms.getSymbol) : [];
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
        B.ensureNetClasses(board);
        if (!Array.isArray(board.zones)) board.zones = [];
        if (!Array.isArray(board.texts)) board.texts = [];
        selId = null; hiNet = null; route = null; outlinePts = null;
        markZonesDirty(true);
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
  function doDrill() {
    if (!Drill) { setStatus('Drill module not loaded'); return; }
    const text = Drill.exportDrill(board);
    if (!text) { setStatus('No holes to export'); return; }
    download('kipad.drl', text, 'text/plain');
    setStatus('Drill file exported (.drl)');
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

  // ---------- mode / launcher ----------

  function setMode(m) {
    mode = m;
    $('launcher').classList.toggle('hidden', m !== 'launcher');
    $('menubar').classList.toggle('hidden', m === 'launcher');
    $('toolbar').classList.toggle('hidden', m === 'launcher');
    $('statusbar').classList.toggle('hidden', m === 'launcher');
    $('main').classList.toggle('hidden', m === 'launcher');
    document.querySelectorAll('.pcb-only').forEach(el => el.classList.toggle('hidden', m !== 'pcb'));
    document.querySelectorAll('.sch-only').forEach(el => el.classList.toggle('hidden', m !== 'schematic'));
    if (m === 'schematic' && !sch) { sch = Sch.makeSchematic(); schTool = 'select'; }
    if (m === 'schematic') { setTab('symbols'); ercDirty = true; }
    if (m === 'pcb') { setTab('layers'); }
    const ercPanel = $('erc-panel');
    if (ercPanel && m !== 'schematic') ercPanel.classList.add('hidden');
    setTool('select');
    resize();
  }

  function renderSchematicView() {
    // ERC results are cached; recompute only after a schematic change
    // (schPushUndo / undo / redo / open / new mark ercDirty).
    if (ercDirty) refreshErc();
    const state = {
      dpr: window.devicePixelRatio || 1,
      grid,
      crosshair,
      selSymId: schSelId,
      wirePts: schWirePts.length ? schWirePts : null,
      wireCur: schWireCur,
      previewSym: (schTool === 'symbol' && schPlaceName && crosshair)
        ? { name: schPlaceName, at: [snap(crosshair[0]), snap(crosshair[1])], angle: schAngle } : null
    };
    R.renderSchematic(ctx, cw, ch, sch, view, state, Syms);
    $('hud-pos').textContent = fmt(view.x) + ', ' + fmt(view.y) + ' mm';
    $('hud-zoom').textContent = Math.round(view.zoom * 100 / 3) + '%';
    $('hud-tool').textContent = schToolName();
    $('st-pos').textContent = 'X: ' + fmt(view.x) + ' Y: ' + fmt(view.y) + ' mm';
    $('st-grid').textContent = 'Grid: ' + grid;
    $('st-zoom').textContent = 'Zoom: ' + Math.round(view.zoom * 100 / 3) + '%';
    $('st-tool').textContent = schToolName();
    $('st-layer').textContent = 'Schematic';
  }

  function schToolName() {
    const m = { select: 'Select', symbol: 'Place Symbol', wire: 'Wire', label: 'Net Label', junction: 'Junction' };
    return m[schTool] || schTool;
  }

  function schSnapshot() { return JSON.stringify(sch); }
  function schPushUndo() { schUndo.push(schSnapshot()); if (schUndo.length > 50) schUndo.shift(); schRedo = []; ercDirty = true; }
  function schUndoStep() {
    if (!schUndo.length) return;
    schRedo.push(schSnapshot());
    sch = JSON.parse(schUndo.pop());
    ercDirty = true;
    render(); refreshAll();
  }
  function schRedoStep() {
    if (!schRedo.length) return;
    schUndo.push(schSnapshot());
    sch = JSON.parse(schRedo.pop());
    ercDirty = true;
    render(); refreshAll();
  }

  function schDoDelete() {
    if (!schSelId) return;
    schPushUndo();
    sch.symbols = sch.symbols.filter(s => s.id !== schSelId);
    schSelId = null;
    render(); refreshAll();
  }
  function schDoRotate() {
    if (!schSelId) return;
    const s = sch.symbols.find(x => x.id === schSelId);
    if (!s) return;
    schPushUndo();
    s.angle = (s.angle + 90) % 360;
    render();
  }

  function schHitSymbol(wx, wy) {
    for (let i = sch.symbols.length - 1; i >= 0; i--) {
      const s = sch.symbols[i];
      if (Math.hypot(wx - s.at[0], wy - s.at[1]) < 2) return s;
    }
    return null;
  }

  function doUpdatePCB() {
    if (!sch || !sch.symbols.length) { setStatus('Schematic is empty'); return; }
    try {
      const board2 = B.makeBoard();
      const getFootprint = name => !!FPs.getFootprint(name);
      const fallback = ref => {
        const p = ref.replace(/[0-9#]+$/, '');
        const map = { R: 'R_0603_1608Metric', C: 'C_0805_2012Metric', D: 'D_SOD-123', Q: 'SOT-23', U: 'SOIC-8_3.9x4.9mm_P1.27mm', J: 'PinHeader_1x04_P2.54mm_Vertical', L: 'L_0603_1608Metric', SW: 'SW_SPST_PTS645' };
        return map[p] || null;
      };
      Sch.updatePCB(sch, board2, { getFootprint, fallbackFootprint: fallback });
      if (!board2.footprints.length) { setStatus('No footprints could be resolved from schematic'); return; }
      pushUndo();
      board = board2;
      B.ensureNetClasses(board);
      selId = null; hiNet = null; route = null;
      markZonesDirty(true);
      setMode('pcb');
      zoomFit();
      refreshAll();
      setStatus('Updated PCB from schematic: ' + board.footprints.length + ' footprints, ' + board.nets.length + ' nets');
    } catch (e) { setStatus('Update PCB failed: ' + e.message); }
  }

  function schSave() {
    if (!Sch) { setStatus('schematic module not loaded'); return; }
    download('kipad.kicad_sch', Sch.serializeSch(sch, Syms.getSymbol), 'application/x-kicad-schematic');
    setStatus('Saved .kicad_sch');
  }
  function schOpen(file) {
    if (!Sch) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        schPushUndo();
        sch = Sch.parseSch(r.result, Syms.getSymbol);
        schSelId = null; schWirePts = [];
        setMode('schematic');
        zoomFit();
        render(); refreshAll();
        setStatus('Opened ' + file.name);
      } catch (e) { setStatus('Open failed: ' + e.message); }
    };
    r.readAsText(file);
  }

  function schNew() {
    schPushUndo();
    sch = Sch.makeSchematic();
    schSelId = null; schWirePts = [];
    setMode('schematic');
    zoomFit(); render(); refreshAll();
    setStatus('New schematic');
  }

  // ---------- plugin manager ----------
  function loadPlugins() {
    try { plugins = JSON.parse(localStorage.getItem(PLUGINS_KEY)) || {}; } catch (e) { plugins = {}; }
  }
  function savePlugins() {
    localStorage.setItem(PLUGINS_KEY, JSON.stringify(plugins));
  }
  const BUILTIN_PLUGINS = [];
  function showPlugins() {
    loadPlugins();
    const rows = BUILTIN_PLUGINS.map(p => {
      const on = plugins[p.name] && plugins[p.name].enabled;
      return `<div class="plugin-row"><div><b>${p.label}</b><br><span class="desc">${p.desc}</span></div>
        <button class="btn ${on ? 'primary' : ''}" data-plug="${p.name}">${on ? 'Enabled' : 'Install'}</button></div>`;
    }).join('');
    const custom = installedPlugins.map(p =>
      `<div class="plugin-row"><div><b>${p.name}</b><br><span class="desc">custom .js plugin</span></div>
       <span class="desc">loaded</span></div>`).join('');
    showModal('Plugin and Content Manager', `
      <div class="plugin-list">${rows}${custom}</div>
      <p class="desc">Kipad plugins are lightweight JS extensions. Built-in modules listed above; more coming.
      Install a custom plugin (.js file) to extend tools.</p>`);
    $('modal-body').querySelectorAll('[data-plug]').forEach(b => b.addEventListener('click', () => {
      const name = b.dataset.plug;
      const cur = plugins[name] || {};
      plugins[name] = { enabled: !cur.enabled };
      savePlugins();
      setStatus((plugins[name].enabled ? 'Enabled ' : 'Disabled ') + name);
      showPlugins();
    }));
    $('modal-ok').addEventListener('click', hideModal);
  }

  // ---------- Gerber Viewer (per-layer preview) ----------
  function showGerberViewer() {
    const layers = ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'];
    let cur = 'F.Cu';
    const body = `<div class="gv-layers">${layers.map(l => `<button class="btn ${l === cur ? 'primary' : ''}" data-gv="${l}">${l}</button>`).join('')}</div>
      <canvas class="lib-preview" id="gv-canvas" style="height:45vh"></canvas>`;
    showModal('Gerber Viewer', body);
    const draw = () => {
      const cv = $('gv-canvas');
      if (!cv) return;
      const c = cv.getContext('2d');
      cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
      cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
      c.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      const layerVis = {};
      for (const l of layers) layerVis[l] = false;
      if (cur !== 'Edge.Cuts') layerVis[cur] = true;
      // fit view to board
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const fp of board.footprints) for (const p of fp.pads) {
        x0 = Math.min(x0, p.at[0]); x1 = Math.max(x1, p.at[0]); y0 = Math.min(y0, p.at[1]); y1 = Math.max(y1, p.at[1]);
      }
      for (const t of board.tracks) {
        x0 = Math.min(x0, t.start[0], t.end[0]); x1 = Math.max(x1, t.start[0], t.end[0]);
        y0 = Math.min(y0, t.start[1], t.end[1]); y1 = Math.max(y1, t.start[1], t.end[1]);
      }
      for (const poly of board.outline) for (const p of poly) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      }
      const fit = isFinite(x0);
      const v2 = fit
        ? (() => { const w = (x1 - x0) || 10, h = (y1 - y0) || 10;
            const zoom = Math.max(0.5, Math.min(20, Math.min(cv.clientWidth / w, cv.clientHeight / h) * 0.9));
            return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom }; })()
        : R.makeView();
      R.render(c, cv.clientWidth, cv.clientHeight, board, v2, { layerVis, showRats: false, activeLayer: cur, selId: null, hiNet: null, crosshair: null });
    };
    $('modal-body').querySelectorAll('[data-gv]').forEach(b => b.addEventListener('click', () => { cur = b.dataset.gv; showGerberViewer(); }));
    draw();
    $('modal-ok').addEventListener('click', hideModal);
  }

  // ---------- PCB Calculator (IPC-2221 track width) ----------
  function showCalc() {
    showModal('PCB Calculator — Track Width (IPC-2221)', `
      <div class="prop-group"><h5>Inputs</h5>
        <div class="prop-row"><label>Current</label><input id="cal-i" value="1" type="number" step="0.1" min="0"><span>A</span></div>
        <div class="prop-row"><label>ΔT rise</label><input id="cal-t" value="10" type="number" step="1" min="1"><span>°C</span></div>
        <div class="prop-row"><label>Copper</label><select id="cal-oz"><option value="1">1 oz (35 µm)</option><option value="2">2 oz (70 µm)</option><option value="0.5">0.5 oz (18 µm)</option></select></div>
      </div>
      <div class="drc-item" id="cal-out"></div>`);
    const calc = () => {
      const I = parseFloat($('cal-i').value) || 0;
      const dT = parseFloat($('cal-t').value) || 10;
      const oz = parseFloat($('cal-oz').value) || 1;
      // IPC-2221 external layer: A(mil²) = (I / (k · ΔT^b))^(1/c)
      const k = 0.024, b = 0.44, c = 0.725;
      let widthMil = 0;
      if (I > 0) {
        const A = Math.pow(I / (k * Math.pow(dT, b)), 1 / c);
        widthMil = A / (oz * 1.378);
      }
      const widthMm = widthMil * 0.0254;
      $('cal-out').innerHTML = `Required width: <b>${widthMm.toFixed(3)} mm</b> (${widthMil.toFixed(2)} mil) at ${I} A, ΔT ${dT}°C, ${oz} oz`;
    };
    ['cal-i', 'cal-t'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', calc); });
    const oz = $('cal-oz');
    if (oz) oz.addEventListener('change', calc);
    calc();
    $('modal-ok').addEventListener('click', hideModal);
  }

  // ---------- Image Converter (bitmap → silkscreen footprint) ----------
  function showBitmapConv() {
    let img = null;
    showModal('Image Converter → Footprint', `
      <input type="file" id="bc-file" accept="image/*" class="lib-search">
      <div class="prop-row"><label>Threshold</label><input id="bc-th" type="range" min="0" max="255" value="128"></div>
      <div class="prop-row"><label>Pixel size</label><select id="bc-ps"><option value="0.254">0.254 mm</option><option value="0.5">0.5 mm</option><option value="1">1 mm</option></select></div>
      <canvas class="lib-preview" id="bc-pv" style="height:28vh"></canvas>
      <div class="lib-actions"><button class="btn primary" id="bc-add">Add footprint to board</button></div>`);
    const file = $('bc-file');
    if (file) file.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => { img = im; drawPreview(); };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    const drawPreview = () => {
      const cv = $('bc-pv');
      if (!cv || !img) return;
      const c = cv.getContext('2d');
      cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
      cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
      c.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      const w = cv.clientWidth, h = cv.clientHeight;
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
      const sc = Math.min(w / img.width, h / img.height);
      c.drawImage(img, (w - img.width * sc) / 2, (h - img.height * sc) / 2, img.width * sc, img.height * sc);
    };
    const th = $('bc-th');
    if (th) th.addEventListener('input', () => { if (img) drawPreview(); });
    const add = $('bc-add');
    if (add) add.addEventListener('click', () => {
      if (!img) { setStatus('Choose an image first'); return; }
      const T = parseInt($('bc-th').value) || 128;
      const ps = parseFloat($('bc-ps').value) || 0.254;
      const off = document.createElement('canvas');
      off.width = img.width; off.height = img.height;
      const oc = off.getContext('2d');
      oc.drawImage(img, 0, 0);
      const d = oc.getImageData(0, 0, img.width, img.height).data;
      const silk = [];
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum < T) {
            silk.push({ type: 'rect', layer: 'F.SilkS',
              start: [(x - img.width / 2) * ps, (img.height / 2 - y) * ps],
              end: [(x + 1 - img.width / 2) * ps, (img.height / 2 - y - 1) * ps] });
          }
        }
      }
      if (!silk.length) { setStatus('Nothing below threshold — raise the value and retry'); return; }
      pushUndo();
      const maxId = board.footprints.reduce((m, f) => Math.max(m, f.id || 0), 0) + 1;
      board.footprints.push({ id: maxId, name: 'LOGO_IMAGE', ref: 'LOGO', value: '', at: [0, 0], angle: 0,
        layer: 'F.SilkS', pads: [], silk,
        fab: [], courtyard: { layer: 'F.CrtYd', min: [-img.width * ps / 2, -img.height * ps / 2], max: [img.width * ps / 2, img.height * ps / 2] } });
      render(); refreshAll(); hideModal();
      setStatus('Added image footprint: ' + silk.length + ' silkscreen cells');
    });
    $('modal-ok').addEventListener('click', hideModal);
  }

  // ---------- pointer handling ----------
  canvas.addEventListener('pointerdown', e => {
    const penHud = $('hud-pen');
    if (e.pointerType === 'pen') {
      penDown = e.pointerId;
      if (penHud) penHud.classList.remove('hidden');
      const now = Date.now();
      const drawing = mode === 'schematic'
        ? (schTool === 'wire' && schWirePts.length > 0) || schTool === 'symbol'
        : tool === 'track' ? !!route : !!(gfxStart || measureA) || tool === 'footprint' || (tool === 'zone' && !!zonePts);
      if (now - lastPenTap < 350 && !drawing) {
        lastPenTap = 0;
        if (mode === 'schematic') { if (schTool !== 'select') { setSchTool('select'); setStatus('Pencil double-tap → Select'); } }
        else if (tool !== 'select') { setTool('select'); setStatus('Pencil double-tap → Select'); }
        render(); refreshAll();
        return;
      }
      lastPenTap = now;
    }
    // palm rejection: ignore fingers while the pencil is down
    if (e.pointerType === 'touch' && penDown !== null) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [wx, wy] = s2w(e.clientX, e.clientY);
    crosshair = [wx, wy];

    if (mode === 'schematic') { schPointerDown(wx, wy); return; }

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
    if (tool === 'text' && textPlace) {
      pushUndo();
      const t = B.addText(board, { ...textPlace, at: [snap(wx), snap(wy)] });
      selId = t.id; selKind = 'text';
      textPlace = null;
      setTool('select');
      refreshAll(); render();
      setStatus('Text placed — edit it in Properties');
      return;
    }
    if (tool === 'zone') {
      const p = [snap(wx), snap(wy)];
      if (!zonePts) {
        // same net assignment flow as routing: pad under the start point,
        // else the highlighted net
        let netId = 0;
        const hit = B.hitPad(board, wx, wy, 0.3);
        if (hit) netId = hit.pad.netId;
        else if (hiNet != null) netId = hiNet;
        zonePts = { pts: [p], netId };
        setStatus('Zone on ' + layer + ' net "' + B.netName(board, netId) + '" — tap points, tap near the ring / double-tap to close');
      } else if (zonePts.pts.length >= 3 && Math.hypot(p[0] - zonePts.pts[0][0], p[1] - zonePts.pts[0][1]) < Math.max(0.5, grid)) {
        finishZone();
      } else {
        const last = zonePts.pts[zonePts.pts.length - 1];
        if (last[0] !== p[0] || last[1] !== p[1]) zonePts.pts.push(p);
      }
      render();
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
    const textHit = B.hitText(board, wx, wy, 0.25);
    if (padHit) {
      selId = padHit.fp.id; selKind = 'footprint';
      hiNet = padHit.pad.netId;
      dragging = { fpId: padHit.fp.id, dx: wx - padHit.fp.at[0], dy: wy - padHit.fp.at[1], moved: false };
    } else if (fpHit) {
      selId = fpHit.id; selKind = 'footprint';
      dragging = { fpId: fpHit.id, dx: wx - fpHit.at[0], dy: wy - fpHit.at[1], moved: false };
    } else if (trHit) {
      selId = trHit.id; selKind = 'track';
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    } else if (viaHit) {
      selId = viaHit.id; selKind = 'via';
      dragging = { pan: true };
      lastPan = { x: e.clientX, y: e.clientY };
    } else if (textHit) {
      selId = textHit.id; selKind = 'text';
      dragging = { textId: textHit.id, dx: wx - textHit.at[0], dy: wy - textHit.at[1], moved: false };
    } else {
      const zHit = hitZone(wx, wy);
      if (zHit) {
        selId = zHit.id; selKind = 'zone';
        dragging = { pan: true };
        lastPan = { x: e.clientX, y: e.clientY };
      } else {
        selId = null; selKind = null; hiNet = null;
        dragging = { pan: true };
        lastPan = { x: e.clientX, y: e.clientY };
      }
    }
    render(); refreshAll();
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [wx, wy] = s2w(e.clientX, e.clientY);
    crosshair = [wx, wy];

    if (mode === 'schematic') {
      schWireCur = (schTool === 'wire' && schWirePts.length) ? [snap(wx), snap(wy)] : null;
      if (schDrag && schDrag.pan) {
        const dx = (e.clientX - lastPan.x) / view.zoom;
        const dy = (e.clientY - lastPan.y) / view.zoom;
        view.x -= dx; view.y -= dy;
        lastPan = { x: e.clientX, y: e.clientY };
      } else if (schDrag && schDrag.symId) {
        const s = sch.symbols.find(x => x.id === schDrag.symId);
        if (s) { Sch.moveSymbol(sch, s.id, [snap(wx - schDrag.dx), snap(wy - schDrag.dy)]); }
      }
      render();
      return;
    }

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
        if (!dragging.moved) { pushUndo(); dragging.moved = true; }
        B.moveFootprint(board, fp.id, [snap(wx - dragging.dx), snap(wy - dragging.dy)]);
        render();
      }
    } else if (dragging && dragging.textId) {
      if (!dragging.moved) { pushUndo(); dragging.moved = true; }
      B.moveText(board, dragging.textId, [snap(wx - dragging.dx), snap(wy - dragging.dy)]);
      render();
    } else {
      render();
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (e.pointerType === 'pen' && e.pointerId === penDown) { penDown = null; const h = $('hud-pen'); if (h) h.classList.add('hidden'); }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    const wasDragging = dragging;
    dragging = null; lastPan = null;

    if (mode === 'schematic') {
      const now2 = Date.now();
      if (schTool === 'wire' && schWirePts.length >= 2 && now2 - lastTap < 350) {
        finishSchWire();
        lastTap = 0;
        render();
        return;
      }
      lastTap = now2;
      if (schDrag && schDrag.symId) schPushUndo();
      schDrag = null;
      schWireCur = null;
      render();
      return;
    }

    const now = Date.now();
    if ((tool === 'track' && route) || ((tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc') && gfxStart) || (tool === 'zone' && zonePts && zonePts.pts.length >= 3)) {
      if (now - lastTap < 350) {
        if (tool === 'track') finishRoute();
        else if (tool === 'zone') finishZone();
        else { outlinePts = null; gfxStart = null; render(); }
        lastTap = 0;
        return;
      }
    }
    lastTap = now;
  });

  canvas.addEventListener('pointercancel', e => {
    if (e.pointerType === 'pen' && e.pointerId === penDown) { penDown = null; const h = $('hud-pen'); if (h) h.classList.add('hidden'); }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = null;
    dragging = null; lastPan = null;
  });

  canvas.addEventListener('pointerleave', () => { crosshair = null; if (penDown !== null) { const h = $('hud-pen'); if (h) h.classList.add('hidden'); } });

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

  function schPointerDown(wx, wy) {
    const sx = snap(wx), sy = snap(wy);
    if (schTool === 'symbol' && schPlaceName) {
      schPushUndo();
      const s = Sch.placeSymbol(sch, schPlaceName, [sx, sy], schAngle);
      schSelId = s.id;
      render(); refreshAll();
      setStatus('Placed ' + s.ref + ' — tap to place more, R rotates');
      return;
    }
    if (schTool === 'wire') {
      if (!schWirePts.length) {
        schWirePts = [[sx, sy]];
        setStatus('Wire: tap to add corner, double-tap to finish');
      } else {
        // finish on double-tap (handled in pointerup) or continue
        const last = schWirePts[schWirePts.length - 1];
        if (Math.abs(last[0] - sx) > 1e-9 || Math.abs(last[1] - sy) > 1e-9) {
          schWirePts.push([sx, sy]);
        }
        // junction when landing on existing wire/pin
        maybeJunction(sx, sy);
      }
      render();
      return;
    }
    if (schTool === 'label') {
      const text = prompt('Net label text:');
      if (text && text.trim()) {
        schPushUndo();
        Sch.addLabel(sch, text.trim(), [sx, sy], 0);
        render(); refreshAll();
        setStatus('Label ' + text.trim());
      }
      return;
    }
    if (schTool === 'junction') {
      schPushUndo();
      Sch.addJunction(sch, [sx, sy]);
      render();
      return;
    }
    // select tool
    const hit = schHitSymbol(wx, wy);
    if (hit) {
      schSelId = hit.id;
      schDrag = { symId: hit.id, dx: wx - hit.at[0], dy: wy - hit.at[1] };
    } else {
      schSelId = null;
      schDrag = { pan: true };
      lastPan = { x: lastPointerX, y: lastPointerY };
    }
    render(); refreshAll();
  }

  let lastPointerX = 0, lastPointerY = 0;
  function maybeJunction(x, y) {
    // add junction if another wire/pin point coincides
    for (const w of sch.wires) {
      for (const p of w.pts) {
        if (Math.hypot(p[0] - x, p[1] - y) < 0.01) { Sch.addJunction(sch, [x, y]); return; }
      }
    }
  }

  function finishSchWire() {
    if (schWirePts.length < 2) { schWirePts = []; render(); return; }
    schPushUndo();
    Sch.addWire(sch, schWirePts);
    schWirePts = [];
    render(); refreshAll();
    setStatus('Wire placed');
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (mode === 'schematic') {
      switch (e.key) {
        case 's': case 'S': setSchTool('select'); break;
        case 'w': case 'W': setSchTool('wire'); break;
        case 'l': case 'L': setSchTool('label'); break;
        case 'j': case 'J': setSchTool('junction'); break;
        case 'r': case 'R': schDoRotate(); break;
        case 'g': case 'G': cycleGrid(); break;
        case 'Delete': case 'Backspace': e.preventDefault(); schDoDelete(); break;
        case 'Enter': if (schTool === 'wire' && schWirePts.length) finishSchWire(); break;
        case 'Escape':
          schWirePts = []; schPlaceName = null; setSchTool('select'); break;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? schRedoStep() : schUndoStep(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); schRedoStep(); }
      return;
    }
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
      case 'z': case 'Z': setTool('zone'); break;
      case 't': case 'T': startTextTool(); break;
      case 'l': case 'L': setTool('line'); break;
      case 'm': case 'M': setTool('measure'); break;
      case 'g': case 'G': cycleGrid(); break;
      case 'n': case 'N': showRats = !showRats; $('btn-rats').classList.toggle('active', showRats); render(); break;
      case 'r': case 'R': doRotateSel(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); doDelete(); break;
      case 'Enter':
        if (tool === 'track') finishRoute();
        else if (tool === 'zone' && zonePts) finishZone();
        else if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc') { outlinePts = null; gfxStart = null; render(); }
        break;
      case 'Escape':
        route = null; outlinePts = null; gfxStart = null; placeLib = null; measureA = null; measureB = null; zonePts = null;
        setTool('select'); break;
      case 'w': cycleTrackWidth(); break;
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
  $('sch-select').addEventListener('click', () => setSchTool('select'));
  $('sch-symbol').addEventListener('click', () => setSchTool('symbol'));
  $('sch-wire').addEventListener('click', () => setSchTool('wire'));
  $('sch-label').addEventListener('click', () => setSchTool('label'));
  $('sch-junction').addEventListener('click', () => setSchTool('junction'));
  $('launch-sch').addEventListener('click', () => setMode('schematic'));
  $('launch-pcb').addEventListener('click', () => setMode('pcb'));
  // launcher PM toolbar + tree + cards (defensive: no-op if an element is missing)
  const wire = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  wire('pm-new', schNew);
  wire('pm-open', () => { const b = $('btn-open'); if (b) b.click(); });
  wire('pm-save', () => { if (mode !== 'launcher') { const b = $('btn-save'); if (b) b.click(); } });
  wire('pm-refresh', () => location.reload());
  document.querySelectorAll('.pm-file[data-open], .pm-app[data-open]').forEach(el =>
    el.addEventListener('click', () => setMode(el.dataset.open)));
  wire('launch-gerb', showGerberViewer);
  wire('launch-gerb2', showGerberViewer);
  wire('launch-calc', showCalc);
  wire('launch-calc2', showCalc);
  wire('launch-bitmap', showBitmapConv);
  wire('launch-pcm', showPlugins);
  $('tool-highlight').addEventListener('click', () => setTool('highlight'));
  $('tool-footprint').addEventListener('click', () => setTool('footprint'));
  $('tool-track').addEventListener('click', () => setTool('track'));
  $('tool-via').addEventListener('click', () => setTool('via'));
  $('tool-zone').addEventListener('click', () => setTool('zone'));
  $('tool-text').addEventListener('click', startTextTool);
  $('tool-line').addEventListener('click', () => setTool('line'));
  $('tool-rect').addEventListener('click', () => setTool('rect'));
  $('tool-circle').addEventListener('click', () => setTool('circle'));
  $('tool-arc').addEventListener('click', () => setTool('arc'));
  $('tool-measure').addEventListener('click', () => setTool('measure'));
  $('btn-undo').addEventListener('click', () => mode === 'schematic' ? schUndoStep() : undo());
  $('btn-redo').addEventListener('click', () => mode === 'schematic' ? schRedoStep() : redo());
  $('btn-zoomin').addEventListener('click', () => { view.zoom = Math.min(50, view.zoom * 1.25); render(); });
  $('btn-zoomout').addEventListener('click', () => { view.zoom = Math.max(0.5, view.zoom / 1.25); render(); });
  $('btn-zoomfit').addEventListener('click', zoomFit);
  $('btn-grid').addEventListener('click', cycleGrid);
  $('btn-rats').addEventListener('click', () => { showRats = !showRats; $('btn-rats').classList.toggle('active', showRats); render(); });
  $('btn-drc').addEventListener('click', () => { runDRC(); render(); });
  $('btn-erc').addEventListener('click', () => { showErc(); render(); });
  $('btn-gerber').addEventListener('click', doGerber);
  $('btn-drill').addEventListener('click', doDrill);
  $('btn-new').addEventListener('click', () => {
    if (mode === 'schematic') { schNew(); return; }
    if (board.footprints.length && !confirm('Clear board?')) return;
    pushUndo();
    board = B.makeBoard(); selId = null; hiNet = null; route = null; outlinePts = null;
    zoneFills.clear(); markZonesDirty(true);
    render(); refreshAll();
  });
  $('btn-open').addEventListener('click', () => $('file-open').click());
  $('btn-save').addEventListener('click', () => mode === 'schematic' ? schSave() : doSave());
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-open').addEventListener('change', e => { if (e.target.files[0]) { const f = e.target.files[0]; if (f.name.endsWith('.kicad_sch')) schOpen(f); else doOpen(f); } e.target.value = ''; });
  $('file-import').addEventListener('change', e => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = ''; });

  // tabs
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---------- menus ----------
  function currentMenus() {
    if (mode === 'launcher') return {
      file: [
        ['New Schematic', schNew, ''],
        ['New PCB', () => setMode('pcb'), ''],
        ['Open…', () => $('btn-open').click(), ''],
        ['Save', () => { if (mode !== 'launcher') $('btn-save').click(); }, '']
      ],
      view: [
        ['Zoom to fit', zoomFit, ''],
        ['Grid: ' + grid + ' mm', cycleGrid, 'G']
      ],
      tools: [
        ['Plugin and Content Manager…', showPlugins, '']
      ],
      help: [
        ['How to use', showHelp, ''],
        ['Shortcuts', showShortcuts, '']
      ]
    };
    if (mode === 'schematic') return {
      file: [
        ['New schematic', schNew, ''],
        ['Open .kicad_sch…', () => $('btn-open').click(), ''],
        ['Save .kicad_sch', schSave, ''],
        ['Update PCB from Schematic', doUpdatePCB, ''],
        ['Switch to PCB Editor', () => setMode('pcb'), '']
      ],
      edit: [
        ['Undo', schUndoStep, '⌘Z'],
        ['Redo', schRedoStep, '⌘Y'],
        ['Delete selection', schDoDelete, '⌫'],
        ['Rotate 90°', schDoRotate, 'R']
      ],
      view: [
        ['Zoom in', () => $('btn-zoomin').click(), ''],
        ['Zoom out', () => $('btn-zoomout').click(), ''],
        ['Zoom to fit', zoomFit, ''],
        ['Grid: ' + grid + ' mm', cycleGrid, 'G']
      ],
      place: [
        ['Symbol…', () => { setTab('symbols'); setSchTool('symbol'); }, 'S'],
        ['Wire', () => setSchTool('wire'), 'W'],
        ['Net Label', () => setSchTool('label'), 'L'],
        ['Junction', () => setSchTool('junction'), 'J']
      ],
      inspect: [
        ['Electrical Rules Check…', showErc, ''],
        ['Netlist', showSchNetlist, ''],
        ['Measure', () => setSchTool('select'), 'M']
      ],
      tools: [
        ['Plugin and Content Manager…', showPlugins, ''],
        ['Switch to PCB Editor', () => setMode('pcb'), '']
      ],
      help: [
        ['How to use', showSchHelp, ''],
        ['Shortcuts', showShortcuts, '']
      ]
    };
    return {
      file: [
        ['New board', () => $('btn-new').click(), ''],
        ['Open .kicad_pcb…', () => $('btn-open').click(), ''],
        ['Save .kicad_pcb', doSave, ''],
        ['Import .kicad_mod/.kicad_sym…', () => $('btn-import').click(), ''],
        ['Export Gerber', doGerber, ''],
        ['Export Drill file', doDrill, ''],
        ['Switch to Schematic Editor', () => setMode('schematic'), '']
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
        ['Via', () => setTool('via'), 'V'],
        ['Zone', () => setTool('zone'), 'Z'],
        ['Add Text…', startTextTool, 'T']
      ],
      route: [
        ['Finish track', () => { if (tool === 'track') finishRoute(); }, 'Enter'],
        ['Via + switch layer', () => { if (tool === 'track' && route && route.pts.length) addViaHere(route.pts[route.pts.length - 1][0], route.pts[route.pts.length - 1][1]); }, 'V'],
        ['Track width: ' + trackWidth + ' mm', cycleTrackWidth, 'W']
      ],
      inspect: [
        ['Run DRC', () => $('btn-drc').click(), ''],
        ['Measure', () => setTool('measure'), 'M']
      ],
      tools: [
        ['Plugin and Content Manager…', showPlugins, '']
      ],
      help: [
        ['How to use', showHelp, ''],
        ['Shortcuts', showShortcuts, '']
      ]
    };
  }
  function showSchNetlist() {
    if (!sch || !sch.symbols.length) { setStatus('Schematic is empty'); return; }
    const nets = Sch.extractNets(sch, Syms.getSymbol);
    const rows = nets.map(n => `<div class="net-row"><span>${esc(n.name)}</span><span style="margin-left:auto;color:var(--fg-dim)">${n.pins.length} pin${n.pins.length === 1 ? '' : 's'}</span></div>`).join('');
    showModal('Netlist (' + nets.length + ' nets)', `<div class="plugin-list">${rows}</div>`);
  }
  function showSchHelp() {
    showModal('Kipad — Schematic Editor', `
      <b>Tools</b><br>
      ➤ Select — tap symbol to select, drag to move, R rotates, Del deletes<br>
      ▤ Symbol — pick from Symbols panel, tap canvas to place<br>
      ╱ Wire — tap to start, tap for corners, double-tap/Enter to finish<br>
      🏷 Label — tap to place a net label (names the net)<br>
      • Junction — tap to add a wire junction dot<br><br>
      <b>Flow</b>: place symbols → wire them → add labels → <b>Inspect → Electrical Rules Check…</b> to find unconnected pins, duplicate refs, label conflicts and more, then <b>File → Update PCB from Schematic</b> to continue in the PCB editor.
    `);
  }
  document.querySelectorAll('.menu').forEach(m => {
    m.addEventListener('click', e => {
      e.stopPropagation();
      const pop = $('menu-popup');
      const open = pop.classList.contains('hidden');
      document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
      if (!open) { pop.classList.add('hidden'); return; }
      m.classList.add('open');
      const r = m.getBoundingClientRect();
      const popPos = $('menu-popup');
      popPos.style.left = r.left + 'px';
      popPos.style.top = (r.bottom + 2) + 'px';
      const items = currentMenus()[m.dataset.menu] || [];
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
      ⬟ Zone — draw a copper pour: tap points on the active layer/net, tap near the start ring / double-tap / Enter to close; fills only where it reaches same-net copper, keeps clearance from other nets, auto-refills after edits; select it to delete or override clearance (Properties)<br>
      T Text — place editable text on F.SilkS/B.SilkS; select it to edit content, size, stroke, rotation, alignment or layer<br>
      ╲ ▭ ◯ ◠ — draw line / rectangle / circle / arc on the board outline (Edge.Cuts)<br>
      📏 Measure — tap two points to read distance<br><br>
      <b>Right panel</b>: Layers (visibility + active layer) · Library (real KiCad footprints, search, place, import .kicad_mod) · Symbols (real KiCad symbols, search, import .kicad_sym) · Nets (highlight, add) · Properties (edit selection)<br><br>
      <b>Shortcuts</b>: S select · H highlight · F footprint · X route · V via · Z zone · T text · L line · M measure · G grid · N ratsnest · R rotate · W width · Del delete · Ctrl+Z/Y undo/redo<br><br>
      <b>Pencil</b>: palm rejection on (resting fingers won't draw/pan) · double-tap pencil to return to Select<br><br>
      <b>File</b>: Save = .kicad_pcb · Open = .kicad_pcb · Gerber = F.Cu/B.Cu/Edge.Cuts RS-274X · DRC = per-net-class clearance (Nets → Net Classes…)<br>
      Works offline. Add to Home Screen for fullscreen.
    `);
  }
  function showShortcuts() {
    showModal('Shortcuts', `
      S select · H net highlight · F footprint · X route · V via · Z zone · T text · L line · M measure<br>
      G grid cycle · N ratsnest · R rotate · W track width · Del delete<br>
      Enter finish · Esc cancel · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo<br>
      Pinch to zoom · drag empty area to pan<br>
      Pencil: double-tap → Select · palm rejection active
    `);
  }
  $('modal-cancel').addEventListener('click', hideModal);
  $('modal-ok').addEventListener('click', hideModal);

  function zoomFit() {
    if (mode === 'schematic') {
      if (!sch || !sch.symbols.length) { view = R.makeView(); render(); return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of sch.symbols) { x0 = Math.min(x0, s.at[0]); x1 = Math.max(x1, s.at[0]); y0 = Math.min(y0, s.at[1]); y1 = Math.max(y1, s.at[1]); }
      for (const w of sch.wires) for (const p of w.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      if (!isFinite(x0)) { view = R.makeView(); render(); return; }
      const w = (x1 - x0) || 10, h = (y1 - y0) || 10;
      view.zoom = Math.max(0.5, Math.min(20, Math.min(canvas.width / w, canvas.height / h) * 0.9));
      view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
      render();
      return;
    }
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
  async function fetchJSON(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const type = r.headers.get('content-type') || '';
      if (url.split('?')[0].endsWith('.gz')) {
        const buf = await r.arrayBuffer();
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([buf]).stream().pipeThrough(ds);
        const text = await new Response(stream).text();
        return JSON.parse(text);
      }
      return await r.json();
    } catch (e) { return null; }
  }
  function loadLibraries() {
    const jobs = [];
    if (FPs && FPs.loadLibrary) {
      jobs.push(fetchJSON('lib/footprints.json.gz?v=13').then(data => {
        if (data && data.length) { FPs.loadLibrary(data); setStatus('Loaded ' + data.length + ' footprints'); return true; }
        return fetchJSON('lib/footprints.json?v=13').then(d2 => {
          if (d2 && d2.length) { FPs.loadLibrary(d2); setStatus('Loaded ' + d2.length + ' footprints'); }
        });
      }).catch(() => {}));
    }
    if (Syms && Syms.loadLibrary) {
      jobs.push(fetchJSON('lib/symbols.json.gz?v=13').then(data => {
        if (data && data.length) { Syms.loadLibrary(data); setStatus('Loaded ' + data.length + ' symbols'); return true; }
        return fetchJSON('lib/symbols.json?v=13').then(d2 => {
          if (d2 && d2.length) { Syms.loadLibrary(d2); setStatus('Loaded ' + d2.length + ' symbols'); }
        });
      }).catch(() => {}));
    }
    Promise.all(jobs).then(() => { refreshLibrary(); refreshSymbols(); });
  }

  // ---------- init ----------
  loadLocal();
  setTab('layers');
  setTool('select');
  // build the side panels after first paint so the launcher shows instantly
  setTimeout(refreshAll, 0);
  window.addEventListener('resize', resize);
  resize();
  render();
  loadLibraries();
  loadPlugins();

  // start in launcher mode
  setMode('launcher');

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
