/* Kipad library editors — Symbol Editor & Footprint Editor (KiCad LibEdit style).
   Full-screen overlay: item list | interactive canvas | property tables.
   Custom items persist to localStorage and shadow built-in libraries after
   merge-on-boot (leMergeCustomLibs, called from app.part4 loadLibraries).
   Export uses KipadKicadSym.serializeKicadSym / KipadKicadMod.serializeKicadMod. */
'use strict';

const LE_KEY = { symbol: 'kipad.lib.custom.symbols.v1', footprint: 'kipad.lib.custom.footprints.v1' };
const LE_PIN_TYPES = ['input', 'output', 'bidirectional', 'tri_state', 'passive', 'power_in', 'power_out',
  'open_collector', 'open_emitter', 'no_connect', 'unspecified', 'free'];
const LE_PAD_TYPES = ['smd', 'tht', 'npth'];
const LE_PAD_SHAPES = ['rect', 'roundrect', 'circle', 'obround'];
const LE_SNAP = { symbol: 1.27, footprint: 0.5 };

let leKind = null;            // active editor kind ('symbol' | 'footprint')
let leItemKind = null;        // kind of the working copy
let leItem = null;            // working copy being edited
let leOrigName = null;        // registry name when loaded (rename detection)
let leDirty = false;
let leSelIdx = -1;            // selected pin/pad index
let leView = { cx: 0, cy: 0, ppm: 40 };
let leSearch = '';
let leBuilt = false;
let leNeedsDraw = false;
let leDrag = null;            // {kind:'pin'|'pad'|'pan', idx?, orig?, startCx?, startCy?, sx?, sy?}
const lePointers = new Map();
let lePinch = null;

function leEl(id) { return document.getElementById(id); }
function leVisible() { const el = leEl('lib-editor'); return !!el && !el.classList.contains('hidden'); }
function leDeep(o) { return JSON.parse(JSON.stringify(o)); }
function leSnap(v) { const s = LE_SNAP[leItemKind] || 0.5; return Math.round(v / s) * s; }

function leReg(kind) {
  return kind === 'symbol' ? window.KipadSymbols : window.KipadFootprints;
}
function leSer(kind) {
  return kind === 'symbol' ? window.KipadKicadSym : window.KipadKicadMod;
}
function leLoadCustom(kind) {
  try {
    const arr = JSON.parse(localStorage.getItem(LE_KEY[kind]) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function leMergeCustomLibs() {
  ['symbol', 'footprint'].forEach(kind => {
    const arr = leLoadCustom(kind);
    if (arr.length && leReg(kind)) leReg(kind).loadLibrary(arr);
  });
}
function leFlash(msg) {
  const el = leEl('le-status');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(leFlash.t);
  leFlash.t = setTimeout(() => { el.textContent = ''; }, 2800);
}
function leScheduleDraw() {
  if (leNeedsDraw) return;
  leNeedsDraw = true;
  requestAnimationFrame(() => { leNeedsDraw = false; if (leVisible()) leDraw(); });
}
function leMarkDirty() { leDirty = true; leScheduleDraw(); }

function leListNames() {
  if (!leKind || !leReg(leKind)) return [];
  const all = leKind === 'symbol' ? leReg(leKind).listSymbols() : leReg(leKind).listFootprints();
  const q = leSearch.toLowerCase();
  return q ? all.filter(n => n.toLowerCase().includes(q)) : all;
}
function leItems() { return leItem ? ((leKind === 'symbol') ? (leItem.pins || []) : (leItem.pads || [])) : []; }

// ---------------------------------------------------------------- UI shell

function leEnsureUI() {
  if (leBuilt) return;
  leBuilt = true;
  const root = document.createElement('div');
  root.id = 'lib-editor';
  root.className = 'hidden';
  root.innerHTML = `
    <div class="le-head">
      <b id="le-title">Symbol Editor</b>
      <span id="le-status" class="muted"></span>
      <span style="flex:1"></span>
      <button class="btn" id="le-new">New</button>
      <button class="btn" id="le-import">Import…</button>
      <button class="btn" id="le-export">Export</button>
      <button class="btn primary" id="le-save">Save</button>
      <button class="btn" id="le-close">Close</button>
    </div>
    <div class="le-body">
      <aside class="le-list">
        <input id="le-search" placeholder="Filter…">
        <div id="le-items" class="side-list"></div>
      </aside>
      <section class="le-canvas-wrap">
        <canvas id="le-canvas"></canvas>
        <div class="le-hint" id="le-hint"></div>
      </section>
      <aside class="le-props" id="le-props"></aside>
    </div>`;
  document.body.appendChild(root);
  const file = document.createElement('input');
  file.type = 'file';
  file.id = 'le-file';
  file.className = 'hidden';
  document.body.appendChild(file);

  leEl('le-new').addEventListener('click', () => leNew());
  leEl('le-import').addEventListener('click', () => file.click());
  leEl('le-export').addEventListener('click', () => leExport());
  leEl('le-save').addEventListener('click', () => leSave());
  leEl('le-close').addEventListener('click', () => leEl('lib-editor').classList.add('hidden'));
  leEl('le-search').addEventListener('input', e => { leSearch = e.target.value; leRefreshList(); });
  file.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) leReadFile(f);
    e.target.value = '';
  });
  leWireProps();
  leWireCanvas();
  window.addEventListener('resize', () => { if (leVisible()) leResize(); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && leVisible()) leEl('lib-editor').classList.add('hidden');
  });
}

function leOpen(name) {
  if (!leKind || !leReg(leKind)) return;
  const src = leKind === 'symbol'
    ? leReg(leKind).getSymbol(name)
    : leReg(leKind).getFootprint(name);
  if (!src) return;
  if (leDirty && !confirm('Discard unsaved changes to "' + (leItem && leItem.name) + '"?')) return;
  leItem = leDeep(src);
  if (!leItem.name) leItem.name = name;
  if (leKind === 'symbol' && !Array.isArray(leItem.pins)) leItem.pins = [];
  if (leKind === 'symbol' && !Array.isArray(leItem.graphics)) leItem.graphics = [];
  leItemKind = leKind;
  leOrigName = name;
  leDirty = false;
  leSelIdx = -1;
  leRenderProps();
  leFitView();
  leEl('le-hint').textContent = leKind === 'symbol'
    ? 'Tap a pin to select · drag to move (1.27 mm grid) · edit details on the right'
    : 'Tap a pad to select · drag to move (0.5 mm grid) · edit details on the right';
}

function leUniqueName(base) {
  const names = leListNames();
  let n = base, i = 2;
  while (names.indexOf(n) !== -1) n = base + '_' + (i++);
  return n;
}

function leNew() {
  if (leDirty && !confirm('Discard unsaved changes to "' + (leItem && leItem.name) + '"?')) return;
  if (leKind === 'symbol') {
    leItem = {
      name: leUniqueName('NEW_SYM'), ref: 'U', value: '', desc: '', footprint: '',
      pins: [
        { number: '1', name: '~', type: 'passive', at: [-2.54, 0], angle: 180, length: 2.54 },
        { number: '2', name: '~', type: 'passive', at: [2.54, 0], angle: 0, length: 2.54 }
      ],
      graphics: [{ type: 'rect', start: [-2.54, -2.54], end: [2.54, 2.54] }]
    };
  } else {
    leItem = {
      name: leUniqueName('NEW_FP'), desc: '', ref: 'U', value: '',
      courtyard: { min: [-3, -2], max: [3, 2] },
      silk: [
        { type: 'line', pts: [[-2.5, -1.5], [-2.5, 1.5]] },
        { type: 'line', pts: [[2.5, -1.5], [2.5, 1.5]] }
      ],
      pads: [
        { number: '1', type: 'smd', shape: 'rect', at: [-1.27, 0], size: [1.2, 0.8], layers: ['F.Cu', 'F.Paste', 'F.Mask'] },
        { number: '2', type: 'smd', shape: 'rect', at: [1.27, 0], size: [1.2, 0.8], layers: ['F.Cu', 'F.Paste', 'F.Mask'] }
      ]
    };
  }
  leItemKind = leKind;
  leOrigName = null;
  leDirty = true;
  leSelIdx = -1;
  leRenderProps();
  leFitView();
  leFlash('New ' + leKind + ' — press Save to keep it');
}

function leReadFile(f) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      let item = null;
      if (leKind === 'symbol') {
        const arr = window.KipadKicadSym.parseKicadSym(rd.result);
        if (!arr.length) throw new Error('no symbols found in file');
        item = arr[0];
      } else {
        item = window.KipadKicadMod.parseKicadMod(rd.result);
        if (!item) throw new Error('could not parse footprint file');
      }
      if (leDirty && !confirm('Discard unsaved changes to "' + (leItem && leItem.name) + '"?')) return;
      leItem = leDeep(item);
      leItemKind = leKind;
      leOrigName = null;
      leDirty = true;
      leSelIdx = -1;
      leRenderProps();
      leFitView();
      leFlash('Imported "' + leItem.name + '" — press Save to keep it');
    } catch (err) {
      leFlash('Import failed: ' + err.message);
    }
  };
  rd.readAsText(f);
}

function leSave() {
  if (!leItem || leItemKind !== leKind) { leFlash('Nothing to save'); return; }
  const name = String(leItem.name || '').trim();
  if (!name) { leFlash('Give the ' + leKind + ' a name first'); return; }
  leItem.name = name;
  if (leKind === 'symbol') {
    leReg('symbol').loadLibrary([leItem]);
  } else {
    leReg('footprint').addFootprint(leItem);
  }
  let arr = leLoadCustom(leKind);
  if (leOrigName && leOrigName !== name) arr = arr.filter(x => x.name !== leOrigName);
  const i = arr.findIndex(x => x.name === name);
  const copy = leDeep(leItem);
  if (i >= 0) arr[i] = copy; else arr.push(copy);
  try { localStorage.setItem(LE_KEY[leKind], JSON.stringify(arr)); } catch (e) {}
  leOrigName = name;
  leDirty = false;
  leRefreshList(true);
  leFlash('Saved "' + name + '" — available in both editors');
}

function leExport() {
  if (!leItem || leItemKind !== leKind) { leFlash('Nothing to export'); return; }
  const ser = leSer(leKind);
  if (!ser) return;
  const text = leKind === 'symbol'
    ? ser.serializeKicadSym(leItem)
    : ser.serializeKicadMod(leItem);
  const fname = String(leItem.name || 'item').replace(/[^\w.-]+/g, '_') +
    (leKind === 'symbol' ? '.kicad_sym' : '.kicad_mod');
  download(fname, text, 'text/plain');
  leFlash('Exported ' + fname);
}

function leRefreshList(keepCurrent) {
  const box = leEl('le-items');
  if (!box) return;
  const names = leListNames();
  box.innerHTML = names.map(n =>
    `<div class="lib-item${n === leOrigName && leItemKind === leKind ? ' active' : ''}" data-name="${n.replace(/"/g, '&quot;')}">${n}</div>`
  ).join('') || '<div class="prop-empty">No matches</div>';
  box.querySelectorAll('.lib-item').forEach(it =>
    it.addEventListener('click', () => leOpen(it.dataset.name)));
  if (!keepCurrent && !leItem && names.length) leOpen(names[0]);
  if (keepCurrent && leOrigName && names.indexOf(leOrigName) >= 0) {
    // selection already highlighted via markup
  }
}

// ------------------------------------------------------------ props pane

function leOpt(list, cur) {
  return list.map(v => `<option${v === cur ? ' selected' : ''}>${v}</option>`).join('');
}
function leRow(i, it) {
  if (leKind === 'symbol') {
    const ang = [0, 90, 180, 270].indexOf(Number(it.angle)) >= 0 ? Number(it.angle) : 0;
    return `<tr data-i="${i}"${i === leSelIdx ? ' class="sel"' : ''}>
      <td><input data-f="number" value="${String(it.number || '')}"></td>
      <td><input data-f="name" value="${String(it.name || '').replace(/"/g, '&quot;')}"></td>
      <td><input data-f="x" type="number" step="1.27" value="${it.at[0]}"></td>
      <td><input data-f="y" type="number" step="1.27" value="${it.at[1]}"></td>
      <td><select data-f="angle">${leOpt(['0', '90', '180', '270'], String(ang))}</select></td>
      <td><input data-f="length" type="number" step="1.27" value="${it.length != null ? it.length : 2.54}"></td>
      <td><select data-f="type">${leOpt(LE_PIN_TYPES, it.type || 'passive')}</select></td>
      <td><button class="btn danger le-delrow" title="Delete pin">×</button></td></tr>`;
  }
  return `<tr data-i="${i}"${i === leSelIdx ? ' class="sel"' : ''}>
    <td><input data-f="number" value="${String(it.number || '')}"></td>
    <td><input data-f="x" type="number" step="0.5" value="${it.at[0]}"></td>
    <td><input data-f="y" type="number" step="0.5" value="${it.at[1]}"></td>
    <td><input data-f="w" type="number" step="0.1" value="${it.size[0]}"></td>
    <td><input data-f="h" type="number" step="0.1" value="${it.size[1]}"></td>
    <td><input data-f="drill" type="number" step="0.1" value="${it.drill != null ? it.drill : ''}"></td>
    <td><select data-f="type">${leOpt(LE_PAD_TYPES, it.type || 'smd')}</select></td>
    <td><select data-f="shape">${leOpt(LE_PAD_SHAPES, it.shape || 'rect')}</select></td>
    <td><button class="btn danger le-delrow" title="Delete pad">×</button></td></tr>`;
}

function leRenderProps() {
  const el = leEl('le-props');
  if (!el) return;
  if (!leItem || leItemKind !== leKind) {
    el.innerHTML = '<div class="prop-empty">Select an item on the left, or press New.</div>';
    return;
  }
  const common = `<div class="prop-group"><h5>${leKind === 'symbol' ? 'Symbol' : 'Footprint'}</h5>
    <div class="prop-row"><label>Name</label><input data-pf="name" value="${String(leItem.name || '').replace(/"/g, '&quot;')}"></div>
    <div class="prop-row"><label>Description</label><input data-pf="desc" value="${String(leItem.desc || '').replace(/"/g, '&quot;')}"></div>
    ${leKind === 'symbol' ? `
    <div class="prop-row"><label>Ref prefix</label><input data-pf="ref" value="${String(leItem.ref || 'U')}"></div>
    <div class="prop-row"><label>Value</label><input data-pf="value" value="${String(leItem.value || '')}"></div>
    <div class="prop-row"><label>Footprint</label><input data-pf="footprint" value="${String(leItem.footprint || '')}" placeholder="e.g. R_0603_1608Metric"></div>` : ''}
  </div>`;
  const its = leItems();
  const head = leKind === 'symbol'
    ? '<th>#</th><th>Name</th><th>X</th><th>Y</th><th>Dir</th><th>Len</th><th>Type</th><th></th>'
    : '<th>#</th><th>X</th><th>Y</th><th>W</th><th>H</th><th>Drill</th><th>Type</th><th>Shape</th><th></th>';
  const table = `<div class="prop-group"><h5>${leKind === 'symbol' ? 'Pins' : 'Pads'} (${its.length})</h5>
    <div style="overflow-x:auto"><table class="le-table" id="le-table"><thead><tr>${head}</tr></thead>
    <tbody>${its.map((it, i) => leRow(i, it)).join('')}</tbody></table></div>
    <div class="le-actions">
      <button class="btn" id="le-addrow">+ Add ${leKind === 'symbol' ? 'pin' : 'pad'}</button>
      ${leKind === 'footprint' ? '<button class="btn" id="le-courtyard">Auto-courtyard</button>' : ''}
      <button class="btn" id="le-fit">Fit view</button>
    </div></div>
  <p class="muted" style="font-size:11px">Changes stay local until <b>Save</b>. Saved ${leKind}s are available everywhere in Kipad and survive reloads.</p>`;
  el.innerHTML = common + table;
  const add = leEl('le-addrow');
  if (add) add.addEventListener('click', () => {
    if (leKind === 'symbol') {
      leItem.pins.push({ number: String(leItem.pins.length + 1), name: '~', type: 'passive', at: [0, 0], angle: 90, length: 2.54 });
    } else {
      const n = leItem.pads.filter(p => p.type === 'smd').length;
      leItem.pads.push({
        number: String(leItem.pads.length + 1), type: 'smd', shape: 'rect',
        at: [0, 0], size: [1.2, 0.8], drill: null,
        layers: ['F.Cu', 'F.Paste', 'F.Mask']
      });
      void n;
    }
    leSelIdx = leItems().length - 1;
    leMarkDirty(); leRenderProps();
  });
  const crd = leEl('le-courtyard');
  if (crd) crd.addEventListener('click', leAutoCourtyard);
  const fit = leEl('le-fit');
  if (fit) fit.addEventListener('click', () => leFitView());
}

function leAutoCourtyard() {
  if (!leItem) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (a, b) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b); };
  for (const p of leItem.pads || []) {
    const hw = (p.size ? p.size[0] : 1) / 2 + 0.25, hh = (p.size ? p.size[1] : 1) / 2 + 0.25;
    add(p.at[0] - hw, p.at[1] - hh); add(p.at[0] + hw, p.at[1] + hh);
  }
  for (const s of leItem.silk || []) {
    if (s.type === 'line') s.pts.forEach(pt => add(pt[0], pt[1]));
    else if (s.type === 'circle') { add(s.at[0] - s.r, s.at[1] - s.r); add(s.at[0] + s.r, s.at[1] + s.r); }
    else if (s.type === 'rect') { add(Math.min(s.start[0], s.end[0]), Math.min(s.start[1], s.end[1])); add(Math.max(s.start[0], s.end[0]), Math.max(s.start[1], s.end[1])); }
  }
  if (!isFinite(x0)) { leFlash('Nothing to fit a courtyard around'); return; }
  leItem.courtyard = {
    min: [Math.round((x0 - 0.25) * 100) / 100, Math.round((y0 - 0.25) * 100) / 100],
    max: [Math.round((x1 + 0.25) * 100) / 100, Math.round((y1 + 0.25) * 100) / 100]
  };
  leMarkDirty();
  leFlash('Courtyard updated');
}

function leWireProps() {
  const el = leEl('le-props');
  el.addEventListener('input', e => {
    const t = e.target;
    if (!leItem || leItemKind !== leKind) return;
    if (t.dataset.pf) {
      leItem[t.dataset.pf] = t.value;
      leMarkDirty();
      return;
    }
    const tr = t.closest('tr[data-i]');
    if (!tr || !t.dataset.f) return;
    const i = Number(tr.dataset.i);
    const it = leItems()[i];
    if (!it) return;
    const f = t.dataset.f;
    if (f === 'x' || f === 'y') {
      const v = parseFloat(t.value);
      if (!isNaN(v)) it.at[f === 'x' ? 0 : 1] = v;
      leMarkDirty();
      return;
    }
    if (f === 'w' || f === 'h' || f === 'length') {
      const v = parseFloat(t.value);
      if (!isNaN(v) && v > 0) {
        if (f === 'w') it.size[0] = v; else if (f === 'h') it.size[1] = v; else it.length = v;
      }
      leMarkDirty();
      return;
    }
    if (f === 'drill') {
      const v = parseFloat(t.value);
      it.drill = isNaN(v) || v <= 0 ? null : v;
      if (it.drill != null && it.type === 'smd') { it.type = 'tht'; leApplyPadLayers(it); leRenderProps(); }
      leMarkDirty();
      return;
    }
    if (f === 'angle') { it.angle = parseInt(t.value, 10) || 0; leMarkDirty(); return; }
    if (f === 'type') {
      it.type = t.value;
      if (leKind === 'footprint') {
        if (it.type !== 'smd' && !it.drill) it.drill = Math.min(it.size[0], it.size[1]) * 0.6;
        if (it.type === 'smd') it.drill = null;
        leApplyPadLayers(it);
        leRenderProps();
      }
      leMarkDirty();
      return;
    }
    if (f === 'shape') { it.shape = t.value; leMarkDirty(); return; }
    if (f === 'number') { it.number = t.value; leMarkDirty(); return; }
    if (f === 'name') { it.name = t.value; leMarkDirty(); return; }
  });
  el.addEventListener('click', e => {
    const del = e.target.closest('.le-delrow');
    if (del) {
      const tr = del.closest('tr[data-i]');
      const i = Number(tr.dataset.i);
      const arr = leItems();
      arr.splice(i, 1);
      if (leSelIdx === i) leSelIdx = -1; else if (leSelIdx > i) leSelIdx--;
      leMarkDirty(); leRenderProps();
      return;
    }
    const tr = e.target.closest('tr[data-i]');
    if (tr && !e.target.closest('input,select')) {
      leSelIdx = Number(tr.dataset.i);
      tr.parentElement.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel'));
      tr.classList.add('sel');
      leScheduleDraw();
    }
  });
}

function leApplyPadLayers(p) {
  if (p.type === 'tht') p.layers = ['*.Cu', '*.Mask'];
  else if (p.type === 'npth') p.layers = ['*.Mask'];
  else p.layers = ['F.Cu', 'F.Paste', 'F.Mask'];
}

// ------------------------------------------------------------ canvas view

function leResize() {
  const cv = leEl('le-canvas');
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  leScheduleDraw();
}
function leW2S(x, y) {
  const cv = leEl('le-canvas');
  return [cv.clientWidth / 2 + (x - leView.cx) * leView.ppm,
          cv.clientHeight / 2 + (y - leView.cy) * leView.ppm];
}
function leS2W(sx, sy) {
  const cv = leEl('le-canvas');
  return [leView.cx + (sx - cv.clientWidth / 2) / leView.ppm,
          leView.cy + (sy - cv.clientHeight / 2) / leView.ppm];
}
function leBBox() {
  if (!leItem || leItemKind !== leKind) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  if (leItemKind === 'symbol') {
    for (const p of leItem.pins || []) {
      add(p.at[0], p.at[1]);
      const a = (p.angle || 0) * Math.PI / 180, L = p.length || 2.54;
      add(p.at[0] + Math.cos(a) * L, p.at[1] + Math.sin(a) * L);
    }
    for (const g of leItem.graphics || []) {
      if (g.type === 'rect') { add(g.start[0], g.start[1]); add(g.end[0], g.end[1]); }
      else if (g.type === 'circle') { add(g.center[0] - g.r, g.center[1] - g.r); add(g.center[0] + g.r, g.center[1] + g.r); }
      else if (g.type === 'polyline' || g.type === 'arc') (g.pts || []).forEach(p => add(p[0], p[1]));
      else if (g.type === 'text') add(g.at[0], g.at[1]);
    }
  } else {
    for (const p of leItem.pads || []) {
      const hw = p.size[0] / 2, hh = p.size[1] / 2;
      add(p.at[0] - hw, p.at[1] - hh); add(p.at[0] + hw, p.at[1] + hh);
    }
    for (const s of leItem.silk || []) {
      if (s.type === 'line') s.pts.forEach(pt => add(pt[0], pt[1]));
      else if (s.type === 'circle') { add(s.at[0] - s.r, s.at[1] - s.r); add(s.at[0] + s.r, s.at[1] + s.r); }
      else if (s.type === 'rect') { add(Math.min(s.start[0], s.end[0]), Math.min(s.start[1], s.end[1])); add(Math.max(s.start[0], s.end[0]), Math.max(s.start[1], s.end[1])); }
    }
    const c = leItem.courtyard;
    if (c) { add(c.min[0], c.min[1]); add(c.max[0], c.max[1]); }
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
function leFitView() {
  const b = leBBox();
  const cv = leEl('le-canvas');
  if (!cv) return;
  if (!b) { leView = { cx: 0, cy: 0, ppm: 40 }; leScheduleDraw(); return; }
  const spanX = Math.max(0.5, b.x1 - b.x0), spanY = Math.max(0.5, b.y1 - b.y0);
  leView.ppm = Math.max(4, Math.min(150, Math.min(cv.clientWidth / spanX, cv.clientHeight / spanY) * 0.72));
  leView.cx = (b.x0 + b.x1) / 2; leView.cy = (b.y0 + b.y1) / 2;
  leScheduleDraw();
}

function leDraw() {
  const cv = leEl('le-canvas');
  if (!cv || !leVisible()) return;
  const c = cv.getContext('2d');
  const w = cv.clientWidth, h = cv.clientHeight;
  c.fillStyle = '#17181c'; c.fillRect(0, 0, w, h);
  // grid
  const steps = [0.127, 0.254, 0.5, 1, 2.54, 5, 10, 25.4];
  let gs = steps[steps.length - 1];
  for (const s of steps) { if (s * leView.ppm >= 14) { gs = s; break; } }
  const tl = leS2W(0, 0), br = leS2W(w, h);
  c.fillStyle = '#26282e';
  for (let gx = Math.ceil(tl[0] / gs) * gs; gx <= br[0]; gx += gs) {
    for (let gy = Math.ceil(br[1] / gs) * gs; gy <= tl[1]; gy -= -gs) {
      const p = leW2S(gx, gy);
      c.fillRect(p[0] - 0.5, p[1] - 0.5, 1, 1);
    }
  }
  // origin marker
  const o = leW2S(0, 0);
  c.strokeStyle = '#4a4d55'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(o[0] - 8, o[1]); c.lineTo(o[0] + 8, o[1]); c.moveTo(o[0], o[1] - 8); c.lineTo(o[0], o[1] + 8); c.stroke();

  if (!leItem || leItemKind !== leKind) {
    c.fillStyle = '#7c828e'; c.font = '13px sans-serif'; c.textAlign = 'center';
    c.fillText('Select an item on the left, or press New.', w / 2, h / 2);
    return;
  }
  if (leItemKind === 'symbol') leDrawSymbol(c); else leDrawFootprint(c);
}

function leDrawSymbol(c) {
  const ppm = leView.ppm;
  c.strokeStyle = '#d8dade'; c.lineWidth = Math.max(1, 0.152 * ppm); c.lineJoin = 'round';
  c.font = `${Math.max(8, Math.min(14, 1.27 * ppm))}px sans-serif`;
  for (const g of leItem.graphics || []) {
    if (g.type === 'rect') {
      const a = leW2S(g.start[0], g.start[1]), b = leW2S(g.end[0], g.end[1]);
      c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    } else if (g.type === 'circle') {
      const ctr = leW2S(g.center[0], g.center[1]);
      c.beginPath(); c.arc(ctr[0], ctr[1], Math.max(1, g.r * ppm), 0, Math.PI * 2); c.stroke();
    } else if (g.type === 'polyline' || g.type === 'arc') {
      c.beginPath();
      (g.pts || []).forEach((pt, i) => { const s = leW2S(pt[0], pt[1]); if (i) c.lineTo(s[0], s[1]); else c.moveTo(s[0], s[1]); });
      c.stroke();
    } else if (g.type === 'text') {
      const p = leW2S(g.at[0], g.at[1]);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(g.text || '', p[0], p[1]);
    }
  }
  for (let i = 0; i < leItem.pins.length; i++) {
    const p = leItem.pins[i];
    const a = (p.angle || 0) * Math.PI / 180, L = p.length || 2.54;
    const s0 = leW2S(p.at[0], p.at[1]);
    const s1 = leW2S(p.at[0] + Math.cos(a) * L, p.at[1] + Math.sin(a) * L);
    const sel = i === leSelIdx;
    c.strokeStyle = sel ? '#ffd54d' : '#4db8ff';
    c.lineWidth = sel ? 3 : 2;
    c.beginPath(); c.moveTo(s0[0], s0[1]); c.lineTo(s1[0], s1[1]); c.stroke();
    c.fillStyle = c.strokeStyle;
    c.beginPath(); c.arc(s0[0], s0[1], sel ? 5 : 3.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9aa0ab'; c.textAlign = 'center';
    c.fillText(String(p.number || ''), (s0[0] + s1[0]) / 2 + 8, (s0[1] + s1[1]) / 2 - 6);
    if (p.name && p.name !== '~') {
      c.fillText(String(p.name), s0[0] - Math.cos(a) * 16, s0[1] - Math.sin(a) * 16 - 8);
    }
  }
}

function leDrawFootprint(c) {
  const ppm = leView.ppm;
  const cy = leItem.courtyard;
  if (cy) {
    const a = leW2S(cy.min[0], cy.min[1]), b = leW2S(cy.max[0], cy.max[1]);
    c.strokeStyle = 'rgba(220,220,80,.85)'; c.setLineDash([5, 4]); c.lineWidth = 1.5;
    c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    c.setLineDash([]);
  }
  c.strokeStyle = 'rgba(235,235,235,.9)'; c.lineWidth = Math.max(1, 0.12 * ppm); c.lineJoin = 'round';
  for (const s of leItem.silk || []) {
    if (s.type === 'line') {
      c.beginPath();
      s.pts.forEach((pt, i) => { const p = leW2S(pt[0], pt[1]); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
      c.stroke();
    } else if (s.type === 'circle') {
      const p = leW2S(s.at[0], s.at[1]);
      c.beginPath(); c.arc(p[0], p[1], Math.max(1, s.r * ppm), 0, Math.PI * 2); c.stroke();
    } else if (s.type === 'rect') {
      const a = leW2S(s.start[0], s.start[1]), b = leW2S(s.end[0], s.end[1]);
      c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    } else if (s.type === 'text') {
      const p = leW2S(s.at[0], s.at[1]);
      c.fillStyle = '#ddd'; c.font = `${Math.max(8, (s.size || 1) * ppm)}px sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(s.text || '', p[0], p[1]);
      c.strokeStyle = 'rgba(235,235,235,.9)';
    }
  }
  c.font = `${Math.max(8, Math.min(13, 1 * ppm))}px sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i < leItem.pads.length; i++) {
    const p = leItem.pads[i];
    const ctr = leW2S(p.at[0], p.at[1]);
    const pw = Math.max(2, p.size[0] * ppm), ph = Math.max(2, p.size[1] * ppm);
    const back = (p.layers || []).indexOf('B.Cu') !== -1 && (p.layers || []).indexOf('*.Cu') === -1 &&
      (p.layers || []).indexOf('F.Cu') === -1;
    const col = i === leSelIdx ? '#ffd54d' : (back ? '#4d78e8' : '#e8564d');
    c.fillStyle = col;
    const ang = (p.angle || 0) * Math.PI / 180;
    c.save(); c.translate(ctr[0], ctr[1]); c.rotate(-ang);
    if (p.shape === 'circle') { c.beginPath(); c.arc(0, 0, pw / 2, 0, Math.PI * 2); c.fill(); }
    else if (p.shape === 'obround') {
      c.beginPath();
      const r = Math.min(pw, ph) / 2;
      if (pw >= ph) c.roundRect(-pw / 2, -ph / 2, pw, ph, r);
      else c.roundRect(-pw / 2, -ph / 2, pw, ph, r);
      c.fill();
    } else if (p.shape === 'roundrect') {
      c.beginPath(); c.roundRect(-pw / 2, -ph / 2, pw, ph, Math.min(pw, ph) * 0.25); c.fill();
    } else {
      c.fillRect(-pw / 2, -ph / 2, pw, ph);
    }
    if (p.drill) {
      c.fillStyle = '#17181c';
      c.beginPath(); c.arc(0, 0, Math.max(1.5, p.drill * ppm / 2), 0, Math.PI * 2); c.fill();
    }
    c.restore();
    c.fillStyle = '#fff';
    c.fillText(String(p.number == null ? '' : p.number), ctr[0], ctr[1]);
  }
}

// ---------------------------------------------------------- canvas input

function leHit(wx, wy) {
  const tol = 14 / leView.ppm;
  if (leItemKind === 'symbol') {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < leItem.pins.length; i++) {
      const p = leItem.pins[i];
      const a = (p.angle || 0) * Math.PI / 180, L = p.length || 2.54;
      const ex = p.at[0] + Math.cos(a) * L, ey = p.at[1] + Math.sin(a) * L;
      // distance to pin segment
      const vx = ex - p.at[0], vy = ey - p.at[1];
      const t = Math.max(0, Math.min(1, ((wx - p.at[0]) * vx + (wy - p.at[1]) * vy) / (L * L || 1)));
      const px = p.at[0] + vx * t, py = p.at[1] + vy * t;
      const d = Math.hypot(wx - px, wy - py);
      if (d < tol && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  let best = -1, bestD = Infinity;
  for (let i = 0; i < leItem.pads.length; i++) {
    const p = leItem.pads[i];
    const d = Math.hypot(wx - p.at[0], wy - p.at[1]) - Math.max(p.size[0], p.size[1]) / 2;
    if (d < tol && d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function leUpdateRowInputs(i) {
  const it = leItems()[i];
  if (!it) return;
  const tr = document.querySelector(`#le-table tr[data-i="${i}"]`);
  if (!tr) return;
  const xi = tr.querySelector('input[data-f="x"]');
  const yi = tr.querySelector('input[data-f="y"]');
  if (xi) xi.value = Math.round(it.at[0] * 1000) / 1000;
  if (yi) yi.value = Math.round(it.at[1] * 1000) / 1000;
}

function leWireCanvas() {
  const cv = leEl('le-canvas');
  cv.addEventListener('pointerdown', e => {
    if (!leItem || leItemKind !== leKind) return;
    cv.setPointerCapture(e.pointerId);
    lePointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (lePointers.size === 2) {
      const pts = Array.from(lePointers.values());
      lePinch = { dist: Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]), ppm: leView.ppm };
      leDrag = null;
      return;
    }
    const wp = leS2W(e.offsetX, e.offsetY);
    const hit = leHit(wp[0], wp[1]);
    if (hit >= 0) {
      leSelIdx = hit;
      const it = leItems()[hit];
      leDrag = { kind: leItemKind === 'symbol' ? 'pin' : 'pad', idx: hit, orig: [it.at[0], it.at[1]], sx: e.offsetX, sy: e.offsetY };
      leRenderProps();
    } else {
      leDrag = { kind: 'pan', cx: leView.cx, cy: leView.cy, sx: e.offsetX, sy: e.offsetY };
    }
    leScheduleDraw();
  });
  cv.addEventListener('pointermove', e => {
    if (lePointers.has(e.pointerId)) lePointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (lePinch && lePointers.size === 2) {
      const pts = Array.from(lePointers.values());
      const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      leView.ppm = Math.max(2, Math.min(300, lePinch.ppm * d / (lePinch.dist || 1)));
      leScheduleDraw();
      return;
    }
    if (!leDrag) return;
    if (leDrag.kind === 'pan') {
      leView.cx = leDrag.cx - (e.offsetX - leDrag.sx) / leView.ppm;
      leView.cy = leDrag.cy - (e.offsetY - leDrag.sy) / leView.ppm;
      leScheduleDraw();
      return;
    }
    const it = leItems()[leDrag.idx];
    if (!it) return;
    const dx = (e.offsetX - leDrag.sx) / leView.ppm;
    const dy = (e.offsetY - leDrag.sy) / leView.ppm;
    it.at[0] = leSnap(leDrag.orig[0] + dx);
    it.at[1] = leSnap(leDrag.orig[1] + dy);
    leUpdateRowInputs(leDrag.idx);
    leMarkDirty();
  });
  const up = e => {
    lePointers.delete(e.pointerId);
    if (lePointers.size < 2) lePinch = null;
    if (lePointers.size === 0) leDrag = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const before = leS2W(e.offsetX, e.offsetY);
    leView.ppm = Math.max(2, Math.min(300, leView.ppm * factor));
    const after = leS2W(e.offsetX, e.offsetY);
    leView.cx += before[0] - after[0];
    leView.cy += before[1] - after[1];
    leScheduleDraw();
  }, { passive: false });
}

/** Open the library editor overlay. kind: 'symbol' | 'footprint'. */
function showLibEditor(kind) {
  kind = kind === 'footprint' ? 'footprint' : 'symbol';
  if (!window.KipadSymbols || !window.KipadFootprints) return;
  leEnsureUI();
  if (leItemKind !== kind) {
    leItem = null; leOrigName = null; leDirty = false; leSelIdx = -1;
  }
  leKind = kind;
  leEl('lib-editor').classList.remove('hidden');
  leEl('le-title').textContent = kind === 'symbol' ? 'Symbol Editor' : 'Footprint Editor';
  leEl('le-file').accept = kind === 'symbol' ? '.kicad_sym,text/plain' : '.kicad_mod,text/plain';
  leResize();
  leRefreshList();
  leRenderProps();
  leScheduleDraw();
}
