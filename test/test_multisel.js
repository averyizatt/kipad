'use strict';
/* KipadMultisel tests — group selection set ops, group move/rotate/delete plan. */
const assert = require('assert');
const M = require('../js/multisel.js');

let pass = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✓ ' + name); } else { console.log('  ✗ FAIL: ' + name); process.exitCode = 1; } }
const near = (a, b) => Math.abs(a - b) < 1e-9;
const nearPt = (p, x, y) => near(p[0], x) && near(p[1], y);

function makeBoard() {
  return {
    nets: [{ id: 0, name: 'GND' }],
    footprints: [
      { id: 'FP1', ref: 'R1', at: [0, 0], angle: 0, layer: 'F.Cu', pads: [{ number: '1', at: [2, 0], angle: 0, size: [0.6, 0.6], layers: ['F.Cu'], netId: 0 }] },
      { id: 'FP2', ref: 'R2', at: [10, 0], angle: 0, layer: 'F.Cu', pads: [{ number: '1', at: [12, 0], angle: 0, size: [0.6, 0.6], layers: ['F.Cu'], netId: 0 }] }
    ],
    tracks: [{ id: 'T1', start: [2, 0], end: [12, 0], width: 0.25, layer: 'F.Cu', netId: 0 }],
    vias: [{ id: 'V1', at: [7, 0], size: 0.6, drill: 0.3, netId: 0 }],
    texts: [{ id: 'TXT1', text: 'hi', at: [5, 5], layer: 'F.SilkS', angle: 0, size: 1.5, thickness: 0.3 }],
    zones: [{ id: 'Z1', net: 'GND', layer: 'F.Cu', outline: [{ x: -5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 10 }, { x: -5, y: 10 }] }]
  };
}

// ---------- toggle / has (pure) ----------
let sel = [];
const s2 = M.toggle(sel, 'FP1', 'footprint');
ok(s2.length === 1 && sel.length === 0, 'toggle returns a new array (input untouched)');
ok(M.has(s2, 'FP1') && !M.has(sel, 'FP1'), 'has() sees the added member');
const s3 = M.toggle(s2, 'TXT1', 'text');
ok(s3.length === 2 && M.has(s3, 'TXT1'), 'second toggle adds another kind');
const s4 = M.toggle(s3, 'FP1', 'footprint');
ok(s4.length === 1 && !M.has(s4, 'FP1'), 're-toggling removes the member');
ok(M.toggle([], null).length === 1, 'toggle tolerates a null-ish id slot');

// ---------- moveItems ----------
{
  const b = makeBoard();
  const moved = M.moveItems(b, [
    { id: 'FP1', kind: 'footprint' }, { id: 'T1', kind: 'track' },
    { id: 'V1', kind: 'via' }, { id: 'TXT1', kind: 'text' }
  ], 1, 2);
  ok(moved === 4, 'moveItems reports four moved members');
  ok(nearPt(b.footprints[0].at, 1, 2) && nearPt(b.footprints[0].pads[0].at, 3, 2), 'footprint position and pads shift together');
  ok(nearPt(b.tracks[0].start, 3, 2) && nearPt(b.tracks[0].end, 13, 2), 'track endpoints shift by delta');
  ok(nearPt(b.vias[0].at, 8, 2), 'via shifts by delta');
  ok(nearPt(b.texts[0].at, 6, 7), 'board text shifts by delta');
}
{
  const b = makeBoard();
  const moved = M.moveItems(b, [{ id: 'Z1', kind: 'zone' }], 5, 5);
  ok(moved === 0 && near(b.zones[0].outline[0].x, -5), 'zones are immovable (KiCad pours are refilled, not dragged)');
  ok(M.moveItems(b, [{ id: 'GONE', kind: 'track' }], 1, 1) === 0, 'stale ids are skipped without throwing');
  ok(M.moveItems(b, [], 1, 1) === 0, 'empty selection is a no-op');
}

// ---------- bounds / rotate centre ----------
{
  const b = makeBoard();
  const bd = M.bounds(b, [{ id: 'FP1', kind: 'footprint' }, { id: 'FP2', kind: 'footprint' }]);
  ok(nearPt(bd.min, 0, 0) && nearPt(bd.max, 12, 0), 'bounds span pads of both footprints');
  ok(nearPt(bd.center, 6, 0), 'centre is the bbox midpoint');
  ok(M.bounds(b, []) === null, 'empty selection → no bounds');
}

// ---------- rotateItems ----------
{
  const b = makeBoard();
  const selr = [{ id: 'FP1', kind: 'footprint' }, { id: 'FP2', kind: 'footprint' }];
  M.rotateItems(b, selr, [6, 0], 180);
  ok(nearPt(b.footprints[0].at, 12, 0) && nearPt(b.footprints[1].at, 2, 0), '180° block rotation swaps member positions about the centre');
  ok(nearPt(b.footprints[0].pads[0].at, 10, 0), 'pad ends west of its footprint (rigid-body flip)');
  ok(((b.footprints[0].angle % 360) + 360) % 360 === 180, 'footprint orientation spins with the block');

  // two more 90° steps complete a full turn: layout returns to the start
  M.rotateItems(b, selr, [6, 0], 90);
  M.rotateItems(b, selr, [6, 0], 90);
  ok(nearPt(b.footprints[0].at, 0, 0) && nearPt(b.footprints[0].pads[0].at, 2, 0), 'full turn restores the original layout exactly');
  ok(((b.footprints[0].angle % 360) + 360) % 360 === 0, 'orientation returns to 0 after full turn');
}
{
  const b = makeBoard();
  M.rotateItems(b, [{ id: 'V1', kind: 'via' }, { id: 'TXT1', kind: 'text' }, { id: 'T1', kind: 'track' }], [0, 0], 90);
  ok(nearPt(b.vias[0].at, 0, 7), 'via rotates about the centre');
  ok(nearPt(b.texts[0].at, -5, 5) && ((b.texts[0].angle % 360) + 360) % 360 === 90, 'text rotates position and angle');
  ok(nearPt(b.tracks[0].start, 0, 2) && nearPt(b.tracks[0].end, 0, 12), 'track endpoints rotate as a rigid segment');
  ok(M.rotateItems(b, [{ id: 'Z1', kind: 'zone' }, { id: 'X', kind: 'via' }], [0, 0], 90) === 0, 'zones/stale ids never rotate');
}

// ---------- deletePlan ----------
{
  const b = makeBoard();
  const plan = M.deletePlan(b, [
    { id: 'FP1', kind: 'footprint' }, { id: 'T1', kind: 'track' },
    { id: 'V1', kind: 'via' }, { id: 'TXT1', kind: 'text' }, { id: 'Z1', kind: 'zone' },
    { id: 'STALE', kind: 'track' }
  ]);
  ok(plan.footprints.length === 1 && plan.tracks.length === 1 && plan.vias.length === 1 &&
     plan.texts.length === 1 && plan.zones.length === 1, 'plan partitions all five kinds');
  ok(!plan.tracks.includes('STALE'), 'stale ids dropped from the plan');
  const empty = M.deletePlan(makeBoard(), []);
  ok(!empty.footprints.length && !empty.zones.length, 'empty selection → empty plan');
}

// ---------- integration: group move then undo-style restore stays consistent ----------
{
  const b = makeBoard();
  const before = JSON.stringify([b.footprints[0], b.tracks[0]]);
  M.moveItems(b, [{ id: 'FP1', kind: 'footprint' }, { id: 'T1', kind: 'track' }], 3, -1);
  ok(!before.includes(JSON.stringify(b.footprints[0])), 'state actually changed after group move');
  const fp = b.footprints[0], tr = b.tracks[0];
  ok(fp.pads[0].netId === 0 && tr.netId === 0, 'net membership survives group moves (ids untouched)');
}

console.log('  — ' + pass + ' checks passed —');
