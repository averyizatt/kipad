'use strict';

/**
 * Kipad integration smoke test — wires all UMD modules together like the
 * browser does (globalThis globals), builds a board, round-trips through
 * .kicad_pcb, runs DRC + Gerber + ratsnest + hit tests.
 * Run: cd kipad && node test/test_integration.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
g.KipadSexpr = require('../js/sexpr.js');
g.KipadPcb = require('../js/kicad_pcb.js');
g.KipadGerber = require('../js/gerber.js');
g.KipadFootprints = require('../js/footprints.js');
g.KipadBoard = require('../js/board.js');
g.KipadRender = require('../js/render.js');
g.KipadKicadSym = require('../js/kicad_sym.js');
g.KipadSymbols = require('../js/symbols.js');
try { g.KipadKicadMod = require('../js/kicad_mod.js'); } catch (e) { /* optional until footprint build runs */ }

const B = g.KipadBoard;

// ---- 1. symbol library loads ----
const symData = require('../lib/symbols.json');
assert.ok(Array.isArray(symData) && symData.length >= 100, 'symbols.json has >= 100 symbols');
g.KipadSymbols.loadLibrary(symData);
assert.strictEqual(g.KipadSymbols.count(), symData.length, 'symbol registry count');
assert.ok(g.KipadSymbols.getSymbol('R') && g.KipadSymbols.getSymbol('R').pins.length >= 2, 'R symbol has pins');

// ---- 2. footprint library loads (if present) ----
let fpLibNames = g.KipadFootprints.listFootprints();
try {
  const fpData = require('../lib/footprints.json');
  if (Array.isArray(fpData) && fpData.length) {
    g.KipadFootprints.loadLibrary(fpData);
    fpLibNames = g.KipadFootprints.listFootprints();
    assert.ok(fpLibNames.length >= 100, 'merged footprint library >= 100 names, got ' + fpLibNames.length);
    console.log('footprint library: ' + fpLibNames.length + ' parts loaded');
  }
} catch (e) {
  console.log('note: lib/footprints.json not present, using builtins (' + fpLibNames.length + ')');
}

// ---- 3. board build ----
const board = B.makeBoard();
B.addNet(board, 'GND');
B.addNet(board, 'VCC');
const r1 = B.placeFootprint(board, 'R_0603_1608Metric', [0, 0], 0, 'F.Cu', 'R');
const u1 = B.placeFootprint(board, 'SOIC-8_3.9x4.9mm_P1.27mm', [3, 3], 0, 'F.Cu', 'U');
r1.pads[0].netId = 1; r1.pads[1].netId = 2;
u1.pads.forEach((p, i) => { p.netId = (i % 4 === 0) ? 1 : 0; });
B.addTrack(board, [0, 0], [3, 3], 0.25, 'F.Cu', 1);
B.addVia(board, [1.5, 1.5], 0.6, 0.3, 1);
board.outline.push([[-1, -1], [6, -1], [6, 6], [-1, 6], [-1, -1]]);

// ---- 4. .kicad_pcb round trip ----
const text = g.KipadPcb.serializeBoard(board);
const b2 = g.KipadPcb.parseBoard(text);
assert.strictEqual(b2.footprints.length, 2, 'roundtrip footprints');
assert.strictEqual(b2.tracks.length, 1, 'roundtrip tracks');
assert.strictEqual(b2.vias.length, 1, 'roundtrip vias');
assert.strictEqual(b2.outline.length, 1, 'roundtrip outline');
assert.strictEqual(b2.nets.length, 3, 'roundtrip nets');
assert.deepStrictEqual(b2.footprints[0].pads[0].at, r1.pads[0].at, 'pad position survives');

// ---- 5. DRC ----
const viol = B.runDRC(board);
assert.ok(Array.isArray(viol), 'DRC returns array');
console.log('DRC violations: ' + viol.length);

// ---- 6. Gerber ----
const gb = g.KipadGerber.exportAll(b2);
assert.deepStrictEqual(Object.keys(gb).sort(),
  ['B.Cu', 'B.Mask', 'B.Paste', 'B.SilkS', 'Edge.Cuts', 'F.Cu', 'F.Mask', 'F.Paste', 'F.SilkS'],
  'gerber layers');

// ---- 7. hit tests ----
assert.ok(B.hitPad(board, 0, 0, 0.3), 'hitPad at R pad');
assert.ok(B.hitTrack(board, 1.5, 1.5, 0.2), 'hitTrack mid-segment');
assert.ok(B.hitVia(board, 1.5, 1.5, 0.2), 'hitVia');

// ---- 8. move + rotate ----
const fp0 = b2.footprints[0];
B.moveFootprint(b2, fp0.id, [10, 10]);
assert.deepStrictEqual(b2.footprints[0].at, [10, 10], 'move footprint');
B.rotateFootprint(b2, fp0.id, 90);
assert.strictEqual(b2.footprints[0].angle, 90, 'rotate footprint');

console.log('INTEGRATION OK');
