'use strict';

// Load-and-render regression suite.
//
// Goal (Avery, 2026-08-24): "load a KiCad file and make sure it shows up as
// it should". The parse half already lives in test_roundtrip_fixtures.js;
// this file adds the *render* half: it runs the real canvas renderer
// headlessly against a recording 2D-context mock and asserts on exactly what
// would be painted.
//
//   A. Real fixture: lib-build/raw/pic_programmer.kicad_pcb — element counts
//      scanned from the raw sexpr must survive parseBoard() AND reach the
//      canvas: background fill, one ref label per footprint, copper strokes
//      (full colour on the active layer, 0.38-alpha dimmed off-side), via
//      annuli, Edge.Cuts outline.
//   B. Synthetic minimal board: exact screen-coordinate math using the
//      module's own w2s, plus state gating — layer visibility, inactive-
//      layer dimming, net highlight and selection overlay colours.
//
// No browser, no pixel library: render() only ever touches the 2D context
// API surface, so a faithful call recorder IS a faithful headless canvas.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Pcb = require('../js/kicad_pcb.js');
const g = typeof globalThis !== 'undefined' ? globalThis : global;
g.KipadBoard = require('../js/board.js');
g.KipadFootprints = require('../js/footprints.js');
const Render = require('../js/render.js');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ok - ' + msg); }

// ---- recording canvas 2D context ------------------------------------------
function makeCtx() {
  const calls = [];
  const props = {};
  const ctx = { _calls: calls };
  ctx.measureText = (t) => { calls.push(['measureText', String(t)]); return { width: String(t).length * 7 }; };
  for (const m of ['save', 'restore', 'translate', 'rotate', 'beginPath', 'moveTo', 'lineTo',
    'closePath', 'arc', 'arcTo', 'rect', 'strokeRect', 'fillRect', 'roundRect', 'fill', 'stroke',
    'clip', 'setLineDash', 'fillText', 'strokeText']) {
    ctx[m] = (...args) => calls.push([m, ...args]);
  }
  for (const p of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign',
    'textBaseline', 'globalAlpha', 'lineCap']) {
    Object.defineProperty(ctx, p, {
      set(v) { props[p] = v; calls.push(['set:' + p, v]); },
      get() { return props[p]; },
    });
  }
  return ctx;
}
const did = (ctx, op, ...args) =>
  ctx._calls.some(c => c[0] === op && args.every((a, i) => c[i + 1] === a));
const didSet = (ctx, prop, val) => did(ctx, 'set:' + prop, val);
const countOp = (ctx, op) => ctx._calls.filter(c => c[0] === op).length;

// ---- Part A: real KiCad board export -> parse -> paint ---------------------
console.log('Part A — pic_programmer.kicad_pcb load & paint');

const RAW = path.join(__dirname, '..', 'lib-build', 'raw', 'pic_programmer.kicad_pcb');
const src = fs.readFileSync(RAW, 'utf8');
const rxCount = (re) => (src.match(re) || []).length;
const truth = {
  fps: rxCount(/\(\s*(?:footprint|module)[\s(]/g),
  segs: rxCount(/\(\s*segment[\s(]/g),
  vias: rxCount(/\(\s*via[\s)]/g),
};

const board = Pcb.parseBoard(src);
ok(truth.fps > 50 && board.footprints.length === truth.fps,
  `parse keeps all ${truth.fps} footprints`);
ok(truth.segs > 100 && board.tracks.length === truth.segs,
  `parse keeps all ${truth.segs} segments`);
ok(board.vias.length === truth.vias, `parse keeps all ${truth.vias} vias`);

const CW = 800, CH = 600;
const view = Render.makeView(); // { x:0, y:0, zoom:3 }
const ctxA = makeCtx();
Render.render(ctxA, CW, CH, board, view, {});

ok(ctxA._calls.length > 2 && ctxA._calls[0][0] === 'set:fillStyle' && ctxA._calls[0][1] === Render.BG,
  'paints canvas background first');
ok(did(ctxA, 'fillRect', 0, 0, CW, CH), 'background covers the full viewport');

const refs = board.footprints.map(f => f.ref).filter(Boolean);
const texts = new Set(ctxA._calls.filter(c => c[0] === 'fillText').map(c => c[1]));
ok(refs.every(r => texts.has(r)), `all ${refs.length} footprint ref labels are drawn`);
ok(countOp(ctxA, 'fillText') >= refs.length, 'no fewer text draws than footprints');

ok(didSet(ctxA, 'strokeStyle', Render.LAYER_COLOR['Edge.Cuts']),
  'board outline stroked in Edge.Cuts colour');

const viaStrokes = ctxA._calls.filter(c => c[0] === 'set:strokeStyle' && c[1] === '#c0c0c0').length;
ok(viaStrokes >= truth.vias, `all ${truth.vias} vias paint their annulus`);

const layers = new Set(board.tracks.map(t => t.layer));
if (layers.has('F.Cu')) {
  ok(didSet(ctxA, 'strokeStyle', Render.LAYER_COLOR['F.Cu']),
    'F.Cu segments painted at full copper colour (active layer)');
}
if (layers.has('B.Cu')) {
  ok(didSet(ctxA, 'strokeStyle', 'rgba(77,127,196,0.38)'),
    'B.Cu segments painted dimmed (inactive side)');
}

// ---- Part B: synthetic board — exact geometry + state gating ----------------
console.log('Part B — exact geometry & render-state gating');

const b2 = {
  nets: [],
  outline: [[[0, 0], [40, 0], [40, 30], [0, 30]]],
  texts: [],
  zones: [],
  footprints: [{
    id: 'fp1', ref: 'U1', lib: '', layer: 'F.Cu', angle: 0, at: [20, 15], pads: [
      // pads carry absolute board coords (parser bakes fp.at/fp.angle in)
      { number: '1', at: [20, 15], size: [1.5, 1.5], drill: 0, angle: 0, shape: 'circle' },
    ], silk: [],
  }],
  tracks: [
    { id: 't1', layer: 'F.Cu', netId: 1, width: 0.25, start: [5, 5], end: [15, 5] },
    { id: 't2', layer: 'B.Cu', netId: 2, width: 0.25, start: [5, 10], end: [15, 10] },
  ],
  vias: [],
};
// Quiet ratsnest + push the grid off-canvas so recorded primitives are only
// the ones under test.
const S = () => ({ showRats: false, grid: 1000 });

const ctxB = makeCtx();
Render.render(ctxB, CW, CH, b2, view, S());
const w = (px, py) => Render.w2s(view, px, py, CW, CH);

ok(did(ctxB, 'moveTo', ...w(5, 5)) && did(ctxB, 'lineTo', ...w(15, 5)),
  'F.Cu segment drawn corner-to-corner at projected coordinates');
ok(did(ctxB, 'translate', ...w(20, 15)),
  'pad centre lands on its rotated world position');
ok(ctxB._calls.some(c => c[0] === 'arc' && c[1] === 0 && c[2] === 0 && c[3] === 1.5 * view.zoom / 2),
  'circular pad paints at radius size/2 after zoom');
const refAt = ctxB._calls.find(c => c[0] === 'fillText' && c[1] === 'U1');
ok(!!refAt && Math.abs(refAt[3] - w(20, 13.2)[1]) < 1e-6,
  'ref label sits above the footprint centre');
ok(did(ctxB, 'closePath'),
  'outline polygon closed before stroking');
ok(!didSet(ctxB, 'strokeStyle', Render.NET_HI) && !didSet(ctxB, 'strokeStyle', Render.SEL),
  'unselected, un-highlighted elements stay in theme colours');

let ctxC = makeCtx();
Render.render(ctxC, CW, CH, b2, view, Object.assign(S(), { layerVis: { 'F.Cu': false } }));
ok(!did(ctxC, 'moveTo', ...w(5, 5)), 'hiding F.Cu skips its segments entirely');
ok(didSet(ctxC, 'strokeStyle', Render.LAYER_COLOR['Edge.Cuts']),
  'Edge.Cuts stays visible regardless of copper toggles');
ok(didSet(ctxC, 'strokeStyle', 'rgba(77,127,196,0.38)'),
  'visible-side-off leaves B.Cu rendered (dimmed, inactive)');

ctxC = makeCtx();
Render.render(ctxC, CW, CH, b2, view, Object.assign(S(), { activeLayer: 'B.Cu' }));
ok(didSet(ctxC, 'strokeStyle', Render.LAYER_COLOR['B.Cu']),
  'B.Cu segments full colour when B.Cu is the active layer');
ok(didSet(ctxC, 'strokeStyle', 'rgba(200,52,52,0.38)'),
  'F.Cu segments dimmed when inactive');

ctxC = makeCtx();
Render.render(ctxC, CW, CH, b2, view, Object.assign(S(), { hiNet: 1 }));
ok(didSet(ctxC, 'strokeStyle', Render.NET_HI),
  'highlighted net repaints in ratsnest cyan');

ctxC = makeCtx();
Render.render(ctxC, CW, CH, b2, view, Object.assign(S(), { selIds: new Set(['t1']) }));
ok(didSet(ctxC, 'strokeStyle', Render.SEL),
  'selected track repaints in selection green');

console.log(`\ntest_load_render: ${passed} checks passed`);
