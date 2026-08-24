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
  let drcViolations = [];
  function runDRC() {
    const panel = $('drc-panel');
    drcViolations = B.runDRC(board);
    panel.classList.remove('hidden');
    if (!drcViolations.length) {
      panel.innerHTML = '<h4>DRC</h4><div class="drc-clear">✓ No violations — clearances, holes, edges, silkscreen all pass</div>';
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
[TRUNCATED_FOR_LENGTH]