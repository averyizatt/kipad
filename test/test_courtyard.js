'use strict';

/**
 * Kipad courtyard-overlap DRC tests.
 * Run: node test/test_courtyard.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
g.KipadBoard = require('../js/board.js');

const B = g.KipadBoard;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL: ' + name);
    console.error(e && e.message);
    process.exitCode = 1;
  }
}

// Synthetic placed footprint: instance-level courtyard so no library needed.
function mkFp(id, ref, x, y, opts) {
  const o = Object.assign({ angle: 0, layer: 'F.Cu', half: 1, rect: null }, opts || {});
  return {
    id, ref, lib: 'TestLib:' + ref, value: '',
    at: [x, y], angle: o.angle, layer: o.layer, pads: [],
    courtyard: o.rect ? { min: [o.rect[0], o.rect[1]], max: [o.rect[2], o.rect[3]] }
                      : { min: [-o.half, -o.half], max: [o.half, o.half] }
  };
}
function boardWith(fps) {
  const b = B.makeBoard();
  for (const fp of fps) b.footprints.push(fp);
  return b;
}
const courtyards = b => B.runDRC(b).filter(v => v.type === 'courtyard');

check('far-apart footprints produce no courtyard violations', () => {
  const vs = courtyards(boardWith([mkFp('F1', 'R1', 0, 0), mkFp('F2', 'R2', 20, 20)]));
  assert.strictEqual(vs.length, 0);
});

check('co-located footprints flagged once, naming both refs', () => {
  const vs = courtyards(boardWith([mkFp('F1', 'R1', 0, 0), mkFp('F2', 'R2', 0.3, 0)]));
  assert.strictEqual(vs.length, 1);
  assert.strictEqual(vs[0].severity, 'error');
  assert.ok(vs[0].msg.includes('R1') && vs[0].msg.includes('R2'), 'msg names both refs: ' + vs[0].msg);
  assert.strictEqual(vs[0].layer, 'F.Cu');
  // tap-to-centre coords present and finite
  assert.ok(Number.isFinite(vs[0].x) && Number.isFinite(vs[0].y));
});

check('AABBs overlap but rotated polygons do not — not flagged (SAT)', () => {
  // Two diamonds (squares rotated 45°, circumradius 2√2 ≈ 2.83): bounding
  // boxes overlap but the polygons stay ~0.14 mm apart along the diagonal.
  const a = mkFp('F1', 'R1', 0, 0, { half: 2, angle: 45 });
  const b = mkFp('F2', 'R2', 4.1, 4.1, { half: 2, angle: 45 });
  const vs = courtyards(boardWith([a, b]));
  assert.strictEqual(vs.length, 0);
});

check('rotation makes previously-clear footprints overlap', () => {
  // Two long thin bars crossing like a plus sign must be flagged even though
  // their axis-aligned halves alone would not intersect.
  const bar = { rect: [-4, -0.5, 4, 0.5] };
  const a = mkFp('F1', 'R1', 0, 0, bar);
  const b = mkFp('F2', 'R2', 0, 0, Object.assign({}, bar, { angle: 90 }));
  const vs = courtyards(boardWith([a, b]));
  assert.strictEqual(vs.length, 1);
});

check('small courtyard fully inside large one is flagged (containment)', () => {
  const big = mkFp('F1', 'U1', 0, 0, { rect: [-5, -5, 5, 5] });
  const small = mkFp('F2', 'C1', 0, 0, { half: 1 });
  assert.strictEqual(courtyards(boardWith([big, small])).length, 1);
});

check('exact edge kiss is not an overlap', () => {
  const a = mkFp('F1', 'R1', 0, 0, { rect: [-2, -2, 2, 2] });
  const b = mkFp('F2', 'R2', 4, 0, { rect: [-2, -2, 2, 2] }); // world edge x=2 shared
  assert.strictEqual(courtyards(boardWith([a, b])).length, 0);
});

check('slight penetration beyond tolerance is flagged', () => {
  const a = mkFp('F1', 'R1', 0, 0, { rect: [-2, -2, 2, 2] });
  const b = mkFp('F2', 'R2', 3.95, 0, { rect: [-2, -2, 2, 2] }); // world minX 1.95
  assert.strictEqual(courtyards(boardWith([a, b])).length, 1);
});

check('opposite-face footprints may share XY space', () => {
  const a = mkFp('F1', 'J1', 0, 0);
  const b = mkFp('F2', 'U2', 0, 0, { layer: 'B.Cu' });
  assert.strictEqual(courtyards(boardWith([a, b])).length, 0);
});

check('courtyard overlap ignores nets (netless parts still flagged)', () => {
  const b = boardWith([mkFp('F1', 'TP1', 0, 0), mkFp('F2', 'TP2', 0.5, 0)]);
  assert.strictEqual(b.footprints.every(f => f.pads.every(p => !p.netId)), true);
  assert.strictEqual(courtyards(b).length, 1);
});

check('footprint without any courtyard is skipped silently', () => {
  const a = mkFp('F1', 'R1', 0, 0);
  delete a.courtyard; // instance has none, lib lookup unresolvable → skip
  const b = mkFp('F2', 'R2', 0, 0);
  assert.strictEqual(courtyards(boardWith([a, b])).length, 0);
});

check('deterministic across runs', () => {
  const b = boardWith([mkFp('F1', 'R1', 0, 0), mkFp('F2', 'R2', 0.5, 0.5), mkFp('F3', 'C3', 30, 30)]);
  const s1 = JSON.stringify(courtyards(b));
  const s2 = JSON.stringify(courtyards(b));
  assert.strictEqual(s1, s2);
});

check('real-board smoke: check runs fast and violations are well-formed', () => {
  const fs = require('fs');
  const Pcb = require('../js/kicad_pcb.js');
  const src = fs.readFileSync(__dirname + '/../lib-build/real-board.kicad_pcb', 'utf8');
  const board = Pcb.parseBoard(src);
  // warm + time full runDRC including the courtyard pass
  B.runDRC(board);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) B.runDRC(board);
  const ms = Number(process.hrtime.bigint() - t0) / 10 / 1e6;
  assert.ok(ms < 150, 'runDRC stays fast on real board, got ' + ms.toFixed(1) + 'ms');
  for (const v of courtyards(board)) {
    assert.ok(v.msg.includes('and'), 'overlap msg names two refs');
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
  }
  console.log('  real board runDRC avg ' + ms.toFixed(1) + ' ms, courtyard violations: ' + courtyards(board).length);
});

console.log('test_courtyard: ' + passed + ' checks passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
