'use strict';

const assert = require('assert');
global.KipadFootprints = require('../js/footprints.js');
global.KipadSexpr = require('../js/sexpr.js');
const B = require('../js/board.js');
const Pcb = require('../js/kicad_pcb.js');

const board = B.makeBoard();
assert.deepStrictEqual(board.zones, []);

const gnd = B.addNet(board, 'GND');
B.addZone(board, { net: 'GND', layer: 'F.Cu', outline: [
  { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 15 }, { x: 0, y: 15 }
]});
B.addZone(board, { net: '', layer: 'B.Cu', outline: [
  { x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 20 }
], clearance: 0.4 });
// degenerate zone (<3 points) must be dropped on save
board.zones.push({ id: 'Z99', net: '', layer: 'F.Cu', outline: [{ x: 1, y: 1 }] });

const text = Pcb.serializeBoard(board);
assert(/\(zone\s/.test(text), 'serialized output contains a zone node');
assert(/\(net_name\s+"GND"/.test(text));
assert(/\(layer\s+"B\.Cu"/.test(text));

const reopened = Pcb.parseBoard(text);
assert.strictEqual(reopened.zones.length, 2);
const z1 = reopened.zones[0];
assert.strictEqual(z1.net, 'GND');
assert.strictEqual(z1.layer, 'F.Cu');
assert.strictEqual(z1.outline.length, 4);
assert.deepStrictEqual(z1.outline[2], { x: 20, y: 15 });
const z2 = reopened.zones[1];
assert.strictEqual(z2.layer, 'B.Cu');
assert.strictEqual(z2.outline.length, 3);

// second round-trip stays stable
const text2 = Pcb.serializeBoard(reopened);
const again = Pcb.parseBoard(text2);
assert.strictEqual(again.zones.length, 2);
assert.strictEqual(again.zones[0].net, 'GND');
assert.deepStrictEqual(again.zones[1].outline, reopened.zones[1].outline);

// zones without a nets entry still round-trip by name
const solo = Pcb.parseBoard('(kicad_pcb (version 20240108) (zone (net_name "SIG") (layer "F.Cu") (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5)))))');
assert.strictEqual(solo.zones.length, 1);
assert.strictEqual(solo.zones[0].net, 'SIG');

console.log('test_zone_rt: all tests passed');
