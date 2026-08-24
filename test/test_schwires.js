'use strict';

/**
 * test_schwires.js — schematic wire-tool helpers (snap targets, elbows,
 * T-joints, junction rules).
 * Run: node test/test_schwires.js
 */

const assert = require('assert');
const W = require('../js/schwires.js');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function near(a, b) { return Math.abs(a - b) < 1e-9; }

// ---------- elbow(): orthogonal routing ----------
ok(JSON.stringify(W.elbow([0, 0], [4, 0])) === '[]', 'horizontal move needs no elbow');
ok(JSON.stringify(W.elbow([0, 0], [0, 3])) === '[]', 'vertical move needs no elbow');
let e = W.elbow([0, 0], [5, 2]);   // dominant x: bend at (5,0)
ok(e.length === 1 && e[0][0] === 5 && e[0][1] === 0, 'dominant-x diagonal bends horizontal-first');
e = W.elbow([0, 0], [2, 5]);       // dominant y: bend at (0,5)
ok(e.length === 1 && e[0][0] === 0 && e[0][1] === 5, 'dominant-y diagonal bends vertical-first');
e = W.elbow([1, 1], [3, 3]);       // equal deltas: horizontal-first
ok(e.length === 1 && e[0][0] === 3 && e[0][1] === 1, 'equal deltas route horizontal-first');
ok(JSON.stringify(W.elbow([0, 0], [1e-12, 0])) === '[]', 'sub-epsilon moves count as aligned');

// ---------- collectTargets() ----------
const sch = {
  symbols: [{ id: 's1', ref: 'R1', at: [10, 0], angle: 0 }],
  wires: [{ pts: [[0, 0], [2, 0], [2, 4]] }, { pts: [[8, 8], [9, 9]] }],
  junctions: [{ at: [2, 0] }]
};
const targets = W.collectTargets(sch, s => [{ number: '1', at: [9, 0] }, { number: '2', at: [11, 0] }]);
ok(targets.filter(t => t.kind === 'pin').length === 2, 'pin targets collected');
ok(targets.some(t => t.kind === 'pin' && t.label === 'R1.2' && t.at[0] === 11), 'pin target carries ref.number label');
ok(targets.filter(t => t.kind === 'wire').length === 4, 'both endpoints of every wire collected');
ok(targets.some(t => t.kind === 'wire' && t.at[0] === 2 && t.at[1] === 4), 'polyline far end collected as target');
ok(targets.filter(t => t.kind === 'junction').length === 1, 'junctions collected');

// ---------- pick(): nearest within threshold, pins win ties ----------
ok(W.pick(targets, 11.05, 0, 0.3).kind === 'pin', 'nearby pin picked');
ok(W.pick(targets, 50, 50, 0.3) === null, 'nothing within threshold -> null');
ok(near(W.pick(targets, 8.06, 8.02, 0.3).at[0], 8), 'snaps to exact stored wire-end coords');
// tie: pin at (2,0) vs junction at (2,0) — equidistant, pin priority
const tie = [{ at: [2, 0], kind: 'wire' }, { at: [2, 0], kind: 'junction' }, { at: [2, 0], kind: 'pin' }];
ok(W.pick(tie, 2.01, 0.01, 0.5).kind === 'pin', 'distance tie resolves to pin');

// ---------- hitsAnySegment(): landing on an existing wire run ----------
ok(W.hitsAnySegment([1, 0], sch.wires, 1e-6), 'mid-segment hit detected (T-joint spot)');
ok(W.hitsAnySegment([2.0000001, 1], sch.wires, 1e-6), 'vertical run hit within eps');
ok(!W.hitsAnySegment([1, 1], sch.wires, 1e-6), 'off-wire point not a hit');
ok(W.hitsAnySegment([0, 0], sch.wires, 1e-6), 'segment endpoint counts as hit');

// ---------- junctionNeeded(): KiCad dot semantics ----------
const others = sch.wires;
// my wire from (5,5) to (1,0): corner at index 1 sits ON other wire's interior -> T -> dot
let mine = [[5, 5], [1, 0]];
ok(W.junctionNeeded(mine, 1, others, 1e-6), 'endpoint landing mid-run of another wire needs junction');
// my endpoint meets exactly one other endpoint: plain join, no dot
mine = [[3, 0], [2, 0]]; // lands on vertex (2,0) of polyline 1
ok(!W.junctionNeeded(mine, 1, others, 1e-6), 'endpoint-to-endpoint join needs no dot');
// my CORNER on exactly one other vertex: dot
mine = [[7, 7], [7, 4], [2, 4]]; // corner idx1... wait corner is (7,4); endpoint (2,4) on vertex too
ok(!W.junctionNeeded(mine, 2, others, 1e-6), 'my ENDPOINT on one vertex still no dot');
mine = [[2, 4], [2, 0], [5, 0]]; // my corner idx1=(2,0) coincides with other vertex AND junction
ok(W.junctionNeeded(mine, 1, others, 1e-6), 'corner meeting >=2 other vertices needs dot');
// two separate other wires converge where my endpoint lands: dot
const convergeOthers = [{ pts: [[6, 6], [4, 4]] }, { pts: [[2, 6], [4, 4]] }];
mine = [[4, 4], [0, 4]];
ok(W.junctionNeeded(mine, 0, convergeOthers, 1e-6), 'third wire arriving at 2-way convergence gets dot');
// lone corner in empty space: never a dot
ok(!W.junctionNeeded([[0, 9], [1, 9]], 1, [], 1e-6), 'isolated corner gets no dot');
// through-run check ignores points that are vertices (handled by vertex logic)
const passThrough = [{ pts: [[0, 0], [10, 0]] }];
mine = [[5, 5], [5, 0]];
ok(W.junctionNeeded(mine, 1, passThrough, 1e-6), 'T into open run (no vertex there) gets dot');

console.log('test_schwires: ' + checks + ' checks passed');
