'use strict';

/**
 * Kipad net classes & clearance tests — board model + per-class DRC.
 * Run: node test/test_netclasses.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
g.KipadBoard = require('../js/board.js');

const B = g.KipadBoard;

// ---- 1. default class exists ----
const b = B.makeBoard();
assert.ok(Array.isArray(b.netClasses), 'makeBoard has netClasses array');
assert.strictEqual(b.netClasses.length, 1, 'one class by default');
assert.strictEqual(b.netClasses[0].id, 0, 'default class id 0');
assert.strictEqual(b.netClasses[0].name, 'Default', 'default class named Default');
assert.strictEqual(b.netClasses[0].clearance, 0.2, 'default clearance 0.2mm');
assert.strictEqual(b.netClasses[0].trackWidth, 0.25, 'default track width 0.25mm');
assert.strictEqual(b.netClasses[0].viaSize, 0.6, 'default via size 0.6mm');
assert.strictEqual(b.netClasses[0].viaDrill, 0.3, 'default via drill 0.3mm');

// ---- 2. addNetClass ----
const cid = B.addNetClass(b, 'Power');
assert.strictEqual(cid, 1, 'first custom class gets id 1');
assert.strictEqual(b.netClasses.length, 2, 'class added');
assert.strictEqual(B.getNetClass(b, cid).name, 'Power', 'class name kept');
assert.strictEqual(B.getNetClass(b, cid).clearance, 0.2, 'new class inherits default clearance');
B.getNetClass(b, cid).clearance = 0.4;
assert.strictEqual(B.getNetClass(b, cid).clearance, 0.4, 'class clearance editable');

// ---- 3. netClassOfNet fallback to Default ----
const n1 = B.addNet(b, 'A');
const n2 = B.addNet(b, 'B');
assert.strictEqual(B.netClassOfNet(b, n1).id, 0, 'unassigned net falls back to Default');
assert.strictEqual(B.netClassOfNet(b, n1).name, 'Default', 'fallback name is Default');

// ---- 4. setNetClass ----
assert.ok(B.setNetClass(b, n1, cid), 'assign net A to Power class');
assert.strictEqual(b.nets.find(n => n.id === n1).classId, cid, 'classId stored on net object');
assert.strictEqual(B.netClassOfNet(b, n1).name, 'Power', 'netClassOfNet returns Power');
assert.strictEqual(B.netClassOfNet(b, n2).id, 0, 'net B still Default');
assert.ok(B.setNetClass(b, n1, 999), 'unknown class id is accepted');
assert.strictEqual(B.netClassOfNet(b, n1).id, 0, 'unknown class id falls back to Default');

// ---- 5. rename / remove ----
B.setNetClass(b, n1, cid);
assert.ok(B.renameNetClass(b, cid, 'Power+'), 'renameNetClass ok');
assert.strictEqual(B.getNetClass(b, cid).name, 'Power+', 'class renamed');
assert.strictEqual(B.removeNetClass(b, 0), false, 'Default class cannot be removed');
assert.ok(B.removeNetClass(b, cid), 'remove Power class');
assert.strictEqual(B.getNetClass(b, cid).id, 0, 'removed class resolves to Default');
assert.strictEqual(B.netClassOfNet(b, n1).id, 0, 'nets of removed class fall back to Default');

// ---- 6. DRC uses per-net-class clearance ----
function twoNetBoard(clearA, clearB, sameClass) {
  const board = B.makeBoard();
  const a = B.addNet(board, 'A');
  const b2 = B.addNet(board, 'B');
  const ca = B.addNetClass(board, 'Acls');
  const cb = B.addNetClass(board, 'Bcls');
  B.getNetClass(board, ca).clearance = clearA;
  B.getNetClass(board, cb).clearance = clearB;
  if (sameClass) { B.setNetClass(board, a, ca); B.setNetClass(board, b2, ca); }
  else { B.setNetClass(board, a, ca); B.setNetClass(board, b2, cb); }
  // parallel tracks, 0.2mm wide, center distance 0.3mm => 0.1mm copper gap
  B.addTrack(board, [0, 0], [10, 0], 0.2, 'F.Cu', a);
  B.addTrack(board, [0, 0.3], [10, 0.3], 0.2, 'F.Cu', b2);
  return board;
}

let board = twoNetBoard(0.4, 0.4, false);
let viol = B.runDRC(board);
assert.strictEqual(viol.length, 1, '0.1mm gap vs 0.4mm class clearance => violation');
assert.strictEqual(viol[0].clearance, 0.4, 'violation reports 0.4mm required clearance');
assert.strictEqual(viol[0].dist, 0.1, 'violation reports 0.1mm actual gap');
assert.strictEqual(viol[0].classA, 'Acls', 'classA name in violation');
assert.strictEqual(viol[0].classB, 'Bcls', 'classB name in violation');
assert.ok(viol[0].type === 'track-track', 'violation type');

board = twoNetBoard(0.05, 0.05, false);
viol = B.runDRC(board);
assert.strictEqual(viol.length, 0, '0.1mm gap vs 0.05mm class clearance => no violation');

// ---- 7. max-of-two-classes rule ----
board = twoNetBoard(0.4, 0.05, false);
viol = B.runDRC(board);
assert.strictEqual(viol.length, 1, 'max(0.4, 0.05) still flags the 0.1mm gap');
assert.strictEqual(viol[0].clearance, 0.4, 'required clearance is the larger of the two classes');

// same class for both nets (still max rule with itself)
board = twoNetBoard(0.05, 0.05, true);
viol = B.runDRC(board);
assert.strictEqual(viol.length, 0, 'two nets in one 0.05mm class: no violation');
board = twoNetBoard(0.4, 0.4, true);
viol = B.runDRC(board);
assert.strictEqual(viol.length, 1, 'two nets in one 0.4mm class: violation');

// ---- 8. default class clearance still applies to unclassified boards ----
const plain = B.makeBoard();
const p1 = B.addNet(plain, 'X');
const p2 = B.addNet(plain, 'Y');
B.addTrack(plain, [0, 0], [10, 0], 0.2, 'F.Cu', p1);
B.addTrack(plain, [0, 0.3], [10, 0.3], 0.2, 'F.Cu', p2);
assert.strictEqual(B.runDRC(plain).length, 1, 'Default 0.2mm clearance flags 0.1mm gap');
assert.strictEqual(B.runDRC(plain, 0.05).length, 0, 'explicit clearance override still supported');

// same net never violates itself
plain.tracks = plain.tracks.filter(t => t.netId !== p2);
B.addTrack(plain, [0, 0.3], [10, 0.3], 0.2, 'F.Cu', p1);
assert.strictEqual(B.runDRC(plain).length, 0, 'same-net close tracks are fine');

// ---- 9. persistence in JSON round-trip (localStorage save is JSON) ----
const persist = JSON.parse(JSON.stringify(board));
assert.ok(Array.isArray(persist.netClasses), 'netClasses survives JSON round-trip');
assert.strictEqual(persist.netClasses.length, board.netClasses.length, 'all classes persist');
assert.strictEqual(persist.netClasses[0].name, 'Default', 'Default class persists');
assert.strictEqual(persist.nets.find(n => n.id === 1).classId, 1, 'assigned classId persists on nets');
// explicit assignment survives too
const b3 = twoNetBoard(0.4, 0.05, false);
B.setNetClass(b3, 1, 1);
const b3r = JSON.parse(JSON.stringify(b3));
assert.strictEqual(b3r.nets.find(n => n.id === 1).classId, 1, 'assigned classId survives JSON round-trip');
assert.strictEqual(B.netClassOfNet(b3r, 1).name, 'Acls', 'class lookup works after round-trip');

// ---- 10. old boards without netClasses get seeded with Default ----
const old = { version: '20240108', nets: [{ id: 0, name: '' }], footprints: [], tracks: [], vias: [], outline: [] };
B.ensureNetClasses(old);
assert.strictEqual(old.netClasses.length, 1, 'legacy board seeded with Default class');
assert.strictEqual(B.netClassOfNet(old, 0).name, 'Default', 'legacy lookup works');

console.log('NETCLASS TESTS PASSED');
