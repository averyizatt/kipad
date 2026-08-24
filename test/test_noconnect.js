'use strict';

/**
 * No-connect flag tests — model (js/schematic.js), ERC exemptions (js/erc.js),
 * and .kicad_sch round-trip of `(no_connect ...)`.
 * Run: cd kipad && node test/test_noconnect.js
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

// ---- 1. model ----
let sch = Sch.makeSchematic();
assert.ok(Array.isArray(sch.noConnects), 'makeSchematic has noConnects array');
assert.strictEqual(sch.noConnects.length, 0, 'starts empty');

const nc1 = Sch.addNoConnect(sch, [0, 3.81]);
assert.ok(nc1.id, 'flag gets an id');
assert.deepStrictEqual(nc1.at, [0, 3.81], 'flag stores its position');
assert.strictEqual(Sch.addNoConnect(sch, [5, 0]).id !== nc1.id, true, 'ids are unique');

// legacy schematics without the array still accept flags
const legacy = JSON.parse(JSON.stringify(sch));
delete legacy.noConnects;
Sch.addNoConnect(legacy, [1, 1]);
assert.strictEqual(legacy.noConnects.length, 1, 'addNoConnect lazily creates array');

assert.strictEqual(Sch.removeNoConnect(sch, nc1.id), true, 'removeNoConnect removes by id');
assert.strictEqual(Sch.removeNoConnect(sch, nc1.id), false, 'removeNoConnect is idempotent');
delete legacy.id;
assert.strictEqual(Sch.removeNoConnect({ noConnects: undefined }, 'x'), false, 'removeNoConnect safe without array');

// ---- 2. ERC: UNCONNECTED_PIN suppression ----
sch = Sch.makeSchematic();
Sch.placeSymbol(sch, 'R', [0, 0], 0);           // pins at (0, ±3.81), type passive
let viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN').length, 2, 'isolated R: both pins unconnected');

Sch.addNoConnect(sch, [0, 3.81]);               // flag pin 1 exactly on the tip
viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN').length, 1, 'flagged pin exempt, other still reported');
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN')[0].pinId, '2', 'remaining violation is pin 2');
assert.strictEqual(byCode(viol, 'SINGLE_PIN_NET').length, 0, 'no stray single-pin-net reports');

Sch.addNoConnect(sch, [0, -3.81]);
viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN').length, 0, 'both pins flagged → clean');

// radius tolerance: flag slightly off-tip still catches (within 0.635 mm)
sch.noConnects[1].at = [0.3, -3.81 + 0.3];
assert.strictEqual(byCode(Erc.runERC(sch, Syms.getSymbol), 'UNCONNECTED_PIN').length, 0, 'near-tip flag counts');
sch.noConnects[1].at = [0, -3.81 - 1.0];        // 1 mm away → too far
assert.strictEqual(byCode(Erc.runERC(sch, Syms.getSymbol), 'UNCONNECTED_PIN').length, 1, 'far flag does not count');

// ---- 3. ERC: SINGLE_PIN_NET suppression (wired but lone flagged pin) ----
sch = Sch.makeSchematic();
Sch.placeSymbol(sch, 'R', [0, 0], 0);
Sch.addWire(sch, [[0, 3.81], [5.08, 3.81]]);    // pin 1 wired to nowhere
viol = Erc.runERC(sch, Syms.getSymbol);
assert.ok(byCode(viol, 'SINGLE_PIN_NET').length >= 1 || byCode(viol, 'UNCONNECTED_PIN').length === 1, 'baseline has a violation');
Sch.addNoConnect(sch, [5.08, 3.81]);            // flag terminates the wire end
viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'DANGLING_WIRE').filter(v => Math.abs(v.x - 5.08) < 0.01).length, 0, 'wire end on a flag is not dangling');

// ---- 4. flags do not create electrical connectivity ----
sch = Sch.makeSchematic();
const rA = Sch.placeSymbol(sch, 'R', [0, 0], 0);
const rB = Sch.placeSymbol(sch, 'C', [10, 0], 0);
const netsBefore = JSON.stringify(Sch.extractNets(sch, Syms.getSymbol));
Sch.addNoConnect(sch, [0, 3.81]);
Sch.addNoConnect(sch, [10, 3.81]);
Sch.addNoConnect(sch, [55, 55]);               // nowhere near any pin
assert.strictEqual(JSON.stringify(Sch.extractNets(sch, Syms.getSymbol)), netsBefore,
  'adding flags does not change the netlist');
assert.strictEqual(Erc.pinHasNoConnect(sch, [0, 3.81]), true, 'pinHasNoConnect hit');
assert.strictEqual(Erc.pinHasNoConnect(sch, [50, 50]), false, 'pinHasNoConnect miss');
assert.strictEqual(Erc.NC_RADIUS > 0, true, 'NC_RADIUS exported');

// ---- 5. .kicad_sch round-trip ----
sch = Sch.makeSchematic();
Sch.placeSymbol(sch, 'R', [20, 20], 0);
Sch.placeSymbol(sch, 'R', [40, 20], 0);
Sch.addWire(sch, [[20, 16.19], [40, 16.19]]);
Sch.addLabel(sch, 'SIG', [30, 16.19], 0);
Sch.addNoConnect(sch, [20, 23.81]);
Sch.addNoConnect(sch, [40, 23.81]);

const txt = Sch.serializeSch(sch, null);
assert.ok(txt.includes('(no_connect (at 20 23.81)'), 'serialize emits no_connect sexpr');
assert.strictEqual((txt.match(/\(no_connect /g) || []).length, 2, 'both flags serialized');

const back = Sch.parseSch(txt, null);
assert.ok(Array.isArray(back.noConnects) && back.noConnects.length === 2, 'parse restores both flags');
const got = back.noConnects.map(n => n.at.map(v => Math.round(v * 100) / 100)).sort((a, b) => a[0] - b[0]);
assert.deepStrictEqual(got, [[20, 23.81], [40, 23.81]], 'positions round-trip');

// real-file shape with uuid attribute parses too
const kicadTxt = '(kicad_sch (version 20231120) (generator "eeschema") (paper "A4")\n' +
  '  (symbol (lib_id "Device:R") (at 20 20 0) (property "Reference" "R1" (at 0 0 0)) (property "Value" "1k" (at 0 0 0)))\n' +
  '  (no_connect (at 15.24 12.7) (uuid "6e5c2f8a-1111-2222-3333-444455556666"))\n' +
  ')';
const rt = Sch.parseSch(kicadTxt, null);
assert.strictEqual(rt.noConnects.length, 1, 'uuid-bearing no_connect parses');
assert.deepStrictEqual(rt.noConnects[0].at, [15.24, 12.7], 'uuid file coordinates preserved');

const again = Sch.parseSch(Sch.serializeSch(rt, null), null);
assert.deepStrictEqual(again.noConnects.map(n => n.at), rt.noConnects.map(n => n.at), 'double round-trip stable');

console.log('test_noconnect: all checks passed');
