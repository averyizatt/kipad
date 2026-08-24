'use strict';

/**
 * Power-pin conflict ERC tests — js/erc.js POWERPIN_CONFLICT.
 * Two different power nets shorted on one electrical node (e.g. a GND symbol
 * wired to a VCC symbol) must be an error; same-name repeats are fine.
 * Run: cd kipad && node test/test_powerconflict.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
g.KipadSexpr = require('../js/sexpr.js');
const Syms = require('../js/symbols.js');
Syms.loadLibrary(require('../lib/symbols.json'));
g.KipadSymbols = Syms;
const Sch = require('../js/schematic.js');
g.KipadSchematic = Sch;
const Erc = require('../js/erc.js');
g.KipadErc = Erc;

function byCode(viol, code) { return viol.filter(v => v.code === code); }

// GND / VCC symbols: single power_in pin at the symbol origin
assert.strictEqual(Sch.pinPositions({ libId: 'GND', at: [0, 0], angle: 0 }, Syms.getSymbol).length, 1, 'GND has 1 pin');

// ---- 1. GND symbol wired to VCC symbol → one error naming both nets ----
const shorted = Sch.makeSchematic();
Sch.placeSymbol(shorted, 'GND', [0, 0], 0);
Sch.placeSymbol(shorted, 'VCC', [2.54, 0], 0);
Sch.addWire(shorted, [[0, 0], [2.54, 0]]);
let viol = Erc.runERC(shorted, Syms.getSymbol);
const pc = byCode(viol, 'POWERPIN_CONFLICT');
assert.strictEqual(pc.length, 1, 'GND↔VCC short is exactly one POWERPIN_CONFLICT, got: ' + JSON.stringify(byCode(viol, 'POWERPIN_CONFLICT')));
assert.strictEqual(pc[0].severity, 'error', 'power-pin conflict is an error');
assert.ok(pc[0].message.indexOf('VCC') >= 0 && pc[0].message.indexOf('GND') >= 0,
  'message names both nets, got: ' + pc[0].message);
assert.ok(typeof pc[0].x === 'number' && typeof pc[0].y === 'number', 'conflict carries coordinates');
assert.ok(pc[0].netName === 'VCC' || pc[0].netName === 'GND', 'netName is one of the two nets');

// ---- 2. two GND symbols tied together → no conflict ----
const sameNet = Sch.makeSchematic();
Sch.placeSymbol(sameNet, 'GND', [0, 0], 0);
Sch.placeSymbol(sameNet, 'GND', [2.54, 0], 0);
Sch.addWire(sameNet, [[0, 0], [2.54, 0]]);
viol = Erc.runERC(sameNet, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'POWERPIN_CONFLICT').length, 0, 'two GND symbols on one node are fine');

// ---- 3. separate nodes with different powers → no conflict ----
const separate = Sch.makeSchematic();
Sch.placeSymbol(separate, 'GND', [0, 0], 0);
Sch.placeSymbol(separate, 'VCC', [10, 0], 0);
viol = Erc.runERC(separate, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'POWERPIN_CONFLICT').length, 0, 'unwired different powers do not conflict');

// ---- 4. three-way short (GND + VCC + synthetic +5V) → two errors ----
Syms.loadLibrary([{ name: 'TEST_PWR5V', ref: '#PWR', value: '+5V', footprint: '', desc: '',
  pins: [{ number: '1', name: '', type: 'power_in', at: [0, 0], angle: 0, length: 2.54 }], graphics: [] }]);
const threeWay = Sch.makeSchematic();
Sch.placeSymbol(threeWay, 'GND', [0, 0], 0);
Sch.placeSymbol(threeWay, 'VCC', [2.54, 0], 0);
Sch.placeSymbol(threeWay, 'TEST_PWR5V', [5.08, 0], 0);
Sch.addWire(threeWay, [[0, 0], [2.54, 0], [5.08, 0]]);   // each pin sits on a wire vertex
viol = Erc.runERC(threeWay, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'POWERPIN_CONFLICT').length, 2, 'three-way short reports each extra net once');
const names = byCode(viol, 'POWERPIN_CONFLICT').map(v => v.netName).sort();
assert.deepStrictEqual(names, ['+5V', 'VCC'], 'extra nets beyond the first are reported');

// ---- 5. conflict still fires when ordinary pins share the node ----
// R pin 1 bridged to GND and VCC on one wire (R pin 2 left dangling).
const mixed = Sch.makeSchematic();
Sch.placeSymbol(mixed, 'R', [0, 3.81], 0);        // pin 1 at (0, 3.81)
Sch.placeSymbol(mixed, 'GND', [0, 7.62], 0);
Sch.placeSymbol(mixed, 'VCC', [5.08, 7.62], 0);
Sch.addWire(mixed, [[0, 7.62], [5.08, 7.62]]);
viol = Erc.runERC(mixed, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'POWERPIN_CONFLICT').length, 1, 'ordinary copper on the node does not mask the short');

// ---- 6. power_in + power_out of the SAME name → no false positive ----
Syms.loadLibrary([{ name: 'TEST_DRV_GND', ref: '#PWR', value: 'GND', footprint: '', desc: '',
  pins: [{ number: '1', name: '', type: 'power_out', at: [0, 0], angle: 0, length: 2.54 }], graphics: [] }]);
const drvPair = Sch.makeSchematic();
Sch.placeSymbol(drvPair, 'TEST_DRV_GND', [0, 0], 0);   // power_out "GND"
Sch.placeSymbol(drvPair, 'GND', [2.54, 0], 0);         // power_in "GND"
Sch.addWire(drvPair, [[0, 0], [2.54, 0]]);
viol = Erc.runERC(drvPair, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'POWERPIN_CONFLICT').length, 0, 'same-name power_out + power_in is not a conflict');

// ---- 7. no-connect flag on a power pin does not suppress a real short ----
// Flag sits on VCC's pin tip; the wire still connects both pins.
const flagged = Sch.makeSchematic();
Sch.placeSymbol(flagged, 'GND', [0, 0], 0);
Sch.placeSymbol(flagged, 'VCC', [2.54, 0], 0);
Sch.addWire(flagged, [[0, 0], [2.54, 0]]);
Sch.addNoConnect(flagged, [2.54, 0]);
viol = Erc.runERC(flagged, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'POWERPIN_CONFLICT').length, 1, 'a flag cannot excuse a wired short');

// ---- 8. determinism: repeated runs agree ----
const again = Erc.runERC(shorted, Syms.getSymbol);
assert.deepStrictEqual(JSON.stringify(again), JSON.stringify(viol = Erc.runERC(shorted, Syms.getSymbol)), 'runERC is deterministic');

console.log('test_powerconflict: all checks passed');
