/* Kipad — KiCad-like PCB editor for iPad. Main app, part 1: state, panels, tools, DRC/ERC, file IO. */
'use strict';
  const B = window.KipadBoard;
  const R = window.KipadRender;
  const Pcb = window.KipadPcb;
  const Gerber = window.KipadGerber;
  const Drill = window.KipadDrill || null;
  const Pos = window.KipadPos || null;
  const Bom = window.KipadBom || null;
  const NetlistExp = window.KipadNetlist || null;
  const SymFields = window.KipadSymFields || null;
  const Zip = window.KipadZip || null;
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
  const eraserPointers = new Set(); // consume eraser-end up/cancel without triggering tap tools
  let lastPenTap = 0;       // for pencil double-tap → Select
  let lastTap = 0;
  let measureA = null;
  let crosshair = null;
  let currentTab = 'layers';
  let libQuery = '', symQuery = '';
  let libSel = null, symSel = null;

  // selection tolerance in world mm that stays ~4 px on screen at any zoom
  function pickTol(px) { return Math.max(0.2, (px || 4) / view.zoom); }

  // ---------- mode + schematic state ----------
  const Sch = window.KipadSchematic;
  const Erc = window.KipadErc || null;
  let mode = 'launcher';        // 'launcher' | 'schematic' | 'pcb'
  let sch = null;               // schematic model
  let schTool = 'select';       // select | symbol | wire | label | junction | noconn
  let schSelId = null;          // selected symbol id
  let schSelNc = null;          // selected no-connect flag id
  let schWirePts = [];          // in-progress wire
  let schPlaceName = null;      // symbol being placed
  let schAngle = 0;
  let schUndo = [], schRedo = [];
  let schDrag = null;           // {symId, dx, dy}
  let schWireCur = null;
  let ercViolations = [];       // cached ERC results (recomputed on change)
  let ercDirty = true;
  let showErcMarkers = true;    // View-menu toggle for on-canvas ERC markers
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
        if (l === 'F.Cu' || l === 'B.Cu') {
          if (zonePts && tool === 'zone') { zonePts = null; setStatus('Layer switched — zone draft cancelled'); }
          layer = l; $('st-layer').textContent = l;
        }
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

  // ---------- symbol fields editor (KiCad "Edit Symbol Fields" dialog) ----------
  function showSymFields() {
    if (!SymFields) return;
    if (!sch || !sch.symbols.length) { setStatus('Schematic is empty'); return; }
    schPushUndo();
    const fpNames = FPs.listFootprints('').map(n => `<option value="${esc(n)}">`).join('');
    let html = `<datalist id="sf-fp-list">${fpNames}</datalist>
      <div class="fields-table">`;
    for (const r of SymFields.rows(sch)) {
      html += `<div class="fields-row" data-sid="${esc(r.id)}">
        <input class="sf-ref" value="${esc(r.ref)}" title="Reference" placeholder="R1">
        <input class="sf-val" value="${esc(r.value)}" title="Value" placeholder="10k">
        <input class="sf-fp" list="sf-fp-list" value="${esc(r.footprint)}" title="Footprint" placeholder="— none —">
      </div>`;
    }
    html += `</div><div class="desc">Edits apply live · footprint names autocomplete from the library · power and # symbols are hidden</div>`;
    showModal('Symbol Fields (' + SymFields.rows(sch).length + ' parts)', html);
    const body = $('modal-body');
    body.querySelectorAll('.fields-row').forEach(row => {
      const sym = sch.symbols.find(s => s.id === row.dataset.sid);
      if (!sym) return;
      const wire = (cls, key) => {
        const el = row.querySelector(cls);
        if (el) el.addEventListener('change', () => {
          const changed = SymFields.applyRow(sym, { [key]: el.value });
          if (changed.includes('ref')) el.value = sym.ref; // blank input keeps old ref
          if (changed.length) {
            render(); refreshErc(); refreshAll();
            setStatus(sym.ref + ' updated (' + changed.join(', ') + ')');
          }
        });
      };
      wire('.sf-ref', 'ref'); wire('.sf-val', 'value'); wire('.sf-fp', 'footprint');
    });
    $('modal-ok').addEventListener('click', hideModal);
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
        const to = e.target.value === 'B.Cu' ? 'B.Cu' : 'F.Cu';
        if (to !== fp.layer) {
          fp.layer = to;
          // proper side flip: copper/paste/mask/fab/courtyard swap sides;
          // through-hole pads span both sides and stay unchanged
          const FLIP = { 'F.Cu':'B.Cu','B.Cu':'F.Cu','F.Paste':'B.Paste','B.Paste':'F.Paste',
            'F.Mask':'B.Mask','B.Mask':'F.Mask','F.Fab':'B.Fab','B.Fab':'F.Fab',
            'F.CrtYd':'B.CrtYd','B.CrtYd':'F.CrtYd','F.SilkS':'B.SilkS','B.SilkS':'F.SilkS' };
          const flip = l => FLIP[l] || l;
          for (const p of fp.pads) {
            const tht = p.type === 'tht' ||
              (p.layers.indexOf('F.Cu') !== -1 && p.layers.indexOf('B.Cu') !== -1);
            if (!tht) p.layers = p.layers.map(flip);
          }
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
