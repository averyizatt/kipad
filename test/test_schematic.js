'use strict';

/**
 * Tests for the schematic capture module (js/schematic.js).
 * Run: cd kipad && node test/test_schematic.js
 */

const assert = require('assert');
global.window = global;
global.KipadSexpr = require('../js/sexpr.js');
const Syms = require('../js/symbols.js');
Syms.loadLibrary(require('../lib/symbols.json'));
global.KipadSymbols = Syms;
const Sch = require('../js/schematic.js');
global.KipadSchematic = Sch;

// ---- 1. placement ----
const sch = Sch.makeSchematic();
Sch.placeSymbol(sch, 'R', [0, 0], 0);
Sch.placeSymbol(sch, 'C', [5.08, 0], 0);
Sch.placeSymbol(sch, 'GND', [2.54, -3.81], 0);
assert.strictEqual(sch.symbols.length, 3, 'three symbols placed');
assert.strictEqual(sch.symbols[0].ref, 'R1', 'auto ref numbering');
assert.strictEqual(sch.symbols[1].ref, 'C1', 'auto ref numbering C');
assert.strictEqual(sch.symbols[2].ref, '#PWR1', 'power symbol ref prefix');

const rPins = Sch.pinPositions(sch.symbols[0], Syms.getSymbol);
assert.strictEqual(rPins.length, 2, 'R has 2 pins');
assert.ok(Math.abs(rPins[0].at[0]) < 1e-9 && Math.abs(rPins[0].at[1] - 3.81) < 1e-9, 'R pin1 at (0, 3.81)');
assert.ok(Math.abs(rPins[1].at[1] + 3.81) < 1e-9, 'R pin2 at (0, -3.81)');

// ---- 2. wires + labels + nets ----
Sch.addWire(sch, [[0, 3.81], [2.54, 3.81], [5.08, 3.81]]);
Sch.addLabel(sch, 'VCC', [1.27, 3.81], 0);
Sch.addWire(sch, [[5.08, -3.81], [2.54, -3.81]]);
const nets = Sch.extractNets(sch, Syms.getSymbol);
const byName = {};
nets.forEach(n => { byName[n.name] = n; });
assert.ok(byName.VCC, 'VCC net named by label');
assert.strictEqual(byName.VCC.pins.length, 2, 'VCC connects R1 pin1 + C1 pin1');
assert.ok(byName.GND, 'GND net from power symbol');
assert.strictEqual(byName.GND.pins.length, 2, 'GND connects C1 pin2 + GND symbol');
assert.ok(byName['N-1'], 'floating pin gets auto net name');
assert.strictEqual(byName['N-1'].pins.length, 1, 'N-1 is R1 pin2 alone');

// ---- 3. .kicad_sch round-trip ----
const text = Sch.serializeSch(sch, Syms.getSymbol);
assert.ok(text.startsWith('(kicad_sch'), 'serializes kicad_sch header');
assert.ok(text.includes('(lib_symbols'), 'embeds lib_symbols');
assert.ok(text.includes('(label "VCC"'), 'serializes labels');
const sch2 = Sch.parseSch(text, Syms.getSymbol);
assert.strictEqual(sch2.symbols.length, 3, 'parse restores 3 symbols');
assert.strictEqual(sch2.wires.length, 2, 'parse restores 2 wires');
assert.strictEqual(sch2.labels.length, 1, 'parse restores 1 label');
assert.deepStrictEqual(sch2.symbols.map(s => s.ref), ['R1', 'C1', '#PWR1'], 'refs survive round-trip');
assert.deepStrictEqual(sch2.symbols[0].at, [0, 0], 'position survives');

// ---- 4. updatePCB bridge ----
global.KipadBoard = require('../js/board.js');
const FPs = require('../js/footprints.js');
FPs.loadLibrary(require('../lib/footprints.json'));
global.KipadFootprints = FPs;
const B = global.KipadBoard;
const board = B.makeBoard();
const getFootprint = name => !!FPs.listFootprints().includes(name);
const fallback = ref => ({ R: 'R_0603_1608Metric', C: 'C_0805_2012Metric' }[ref.replace(/[0-9]+$/, '')] || null);
Sch.updatePCB(sch, board, { getFootprint, fallbackFootprint: fallback });
assert.strictEqual(board.footprints.length, 2, 'R and C placed on PCB (GND has no footprint)');
const rFp = board.footprints.find(f => f.ref === 'R1');
assert.ok(rFp, 'R1 placed');
const netNames = board.nets.map(n => n.name);
assert.ok(netNames.includes('VCC'), 'VCC net on board');
const vccNet = board.nets.find(n => n.name === 'VCC');
assert.ok(rFp.pads.some(p => p.netId === vccNet.id), 'R1 pad on VCC net');

console.log('SCHEMATIC TESTS PASSED');
