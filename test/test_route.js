'use strict';
/* KipadRoute tests — 45° elbow geometry, commit cleanup, integration with a simulated tap route. */
const assert = require('assert');
const KR = require('../js/route.js');

let pass = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✓ ' + name); } else { console.log('  ✗ FAIL: ' + name); process.exitCode = 1; } }
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- elbow: degenerate targets collapse ---
ok(KR.elbow([0, 0], [10, 0]).length === 1 && near(KR.elbow([0, 0], [10, 0])[0][1], 0), 'axis-aligned target → single point');
ok(KR.elbow([0, 0], [0, -5]).length === 1, 'vertical target → single point');
ok(KR.elbow([0, 0], [7, 7], 'diag').length === 1, 'exact 45° target → single point');
ok(KR.elbow([3, 3], [3, 3]).length === 1 && near(KR.elbow([3, 3], [3, 3])[0][0], 3), 'zero-length → single identical point');

// --- elbow: diagonal first (default posture) ---
let e = KR.elbow([0, 0], [10, 4]); // dx dominates
ok(e.length === 2, 'arbitrary target → two segments');
ok(near(e[0][0], 4) && near(e[0][1], 4), 'diag posture: elbow = p1 + dmin in both axes');
ok(near(e[1][0], 10) && near(e[1][1], 4), 'diag posture: straight finish into target');
ok(KR.isAllowed([0, 0], e[0]) && KR.isAllowed(e[0], e[1]), 'diag posture segments are H/V/45');

e = KR.elbow([0, 0], [4, 10]); // dy dominates
ok(near(e[0][0], 4) && near(e[0][1], 4), 'diag posture works when Y dominates');

// --- elbow: straight first ---
e = KR.elbow([0, 0], [10, 4], 'straight');
ok(e.length === 2, 'straight posture → two segments');
ok(near(e[0][0], 6) && near(e[0][1], 0), 'straight posture: straight leaves p1 along dominant axis');
ok(near(e[1][0], 10) && near(e[1][1], 4), 'straight posture: 45° arrives into target');
ok(KR.isAllowed([0, 0], e[0]) && KR.isAllowed(e[0], e[1]), 'straight posture segments are H/V/45');

// --- negative directions ---
e = KR.elbow([0, 0], [-10, -4]);
ok(near(e[0][0], -4) && near(e[0][1], -4), 'negative quadrant diag elbow');
ok(KR.isAllowed([0, 0], e[0]) && KR.isAllowed(e[0], e[1]), 'negative quadrant segments allowed');
e = KR.elbow([5, 5], [-2, 9]);
ok(e.length === 2 && KR.isAllowed([5, 5], e[0]) && KR.isAllowed(e[0], e[1]), 'mixed-sign target stays constrained');

// --- isAllowed tolerance ---
ok(KR.isAllowed([0, 0], [10, 0.0000001]), 'near-axis counts as allowed at default eps');
ok(!KR.isAllowed([0, 0], [10, 1]), 'free angle rejected');
ok(KR.isAllowed([0, 0], [10, 1], 2), 'custom eps widens acceptance');

// --- cleanup ---
ok(KR.cleanup([]).length === 0, 'empty input');
ok(JSON.stringify(KR.cleanup([[1, 1]])) === '[[1,1]]', 'single point passthrough');
ok(KR.cleanup([[0, 0], [0, 0], [5, 0]]).length === 2, 'consecutive duplicates dropped');
ok(KR.cleanup([[0, 0], [2, 0], [4, 0], [4, 3]]).length === 3, 'collinear run merged to one segment');
ok(KR.cleanup([[0, 0], [2, 2], [4, 4], [4, 0]]).length === 3, 'diagonal collinear run merged');
ok(KR.cleanup([[0, 0], [4, 0], [4, 3]]).length === 3, 'corner preserved');
ok(KR.cleanup([[0, 0], [4, 0], [8, 0]]).length === 2, 'full collinear collapse to endpoints');
ok(KR.cleanup([[0, 0], [4, 0], [4.0000001, 3]]) .every(p => true) && KR.cleanup([[0, 0], [4, 0], [4, 3], [4, 3]]).length === 3, 'trailing dup removed');
const orig = [[0, 0], [4, 0]];
const copy = KR.cleanup(orig);
copy[0][0] = 99;
ok(orig[0][0] === 0, 'cleanup returns a fresh array (no aliasing)');

// --- integration: simulate taps through the real pipeline ---
function simulateRoute(taps, posture) {
  let pts = [[0, 0]];
  for (const t of taps) {
    const last = pts[pts.length - 1];
    if (t[0] === last[0] && t[1] === last[1]) continue;
    for (const p of KR.elbow(last, t, posture || 'diag')) pts.push(p);
  }
  return KR.cleanup(pts);
}
let sim = simulateRoute([[10, 4], [10, 12]]);
ok(sim.length >= 2, 'simulated two-tap route survives cleanup');
for (let i = 0; i < sim.length - 1; i++) ok(KR.isAllowed(sim[i], sim[i + 1]), 'simulated segment ' + i + ' is H/V/45');
ok(near(sim[sim.length - 1][0], 10) && near(sim[sim.length - 1][1], 12), 'simulated route ends on target');
let sim2 = simulateRoute([[6, 9]], 'straight');
for (let i = 0; i < sim2.length - 1; i++) ok(KR.isAllowed(sim2[i], sim2[i + 1]), 'straight-posture simulated segment ' + i + ' allowed');
// backtrack then retap (Backspace path): pop last elbow, continue from previous vertex
let pts = [[0, 0]]; for (const p of KR.elbow([0, 0], [8, 3])) pts.push(p);
pts.pop();
for (const p of KR.elbow(pts[pts.length - 1], [12, 3])) pts.push(p);
const bt = KR.cleanup(pts);
ok(near(bt[bt.length - 1][0], 12) && near(bt[bt.length - 1][1], 3), 'backtrack + retap reaches new target');
for (let i = 0; i < bt.length - 1; i++) ok(KR.isAllowed(bt[i], bt[i + 1]), 'backtracked segment ' + i + ' allowed');

// --- width/via choice + resolution helpers (toolbar combobox backing) ---
let wc = KR.widthChoices(0.25, [0.2, 0.5, 0.25, 1.0, 0.15, -1]);
ok(JSON.stringify(wc) === JSON.stringify([0.15, 0.2, 0.25, 0.5, 1.0]), 'widthChoices: class default merged with presets, deduped, ascending, invalid dropped');
ok(KR.widthChoices(0.3).length === 1 && KR.widthChoices(0.3)[0] === 0.3, 'widthChoices: presets optional, class-only list works');
let vc = KR.viaChoices(0.8, 0.4, [[0.6, 0.3], [0.8, 0.35], [1.0, 0.5], [0, 9]]);
ok(vc.length === 3, 'viaChoices: deduped by size (class wins size clash), invalid dropped');
ok(vc[0].size === 0.6 && vc[1].size === 0.8 && vc[2].size === 1.0, 'viaChoices: ascending by size');
ok(vc[1].drill === 0.4, 'viaChoices: class drill kept on size clash');
let vd = KR.viaChoices(1.2, null, []);
ok(vd[0].drill === 0.6, 'viaChoices: missing drill defaults to half the via size');
ok(KR.resolveTrackWidth(null, 0.3) === 0.3, 'resolveTrackWidth: null override → class width');
ok(KR.resolveTrackWidth(undefined, 0.3) === 0.3 && KR.resolveTrackWidth(0, 0.3) === 0.3, 'resolveTrackWidth: undefined/zero override → class width');
ok(KR.resolveTrackWidth(0.45, 0.3) === 0.45, 'resolveTrackWidth: explicit override wins');
let rv = KR.resolveVia({ size: 0.9, drill: 0 }, { viaSize: 0.8, viaDrill: 0.4 });
ok(rv.size === 0.9 && rv.drill === 0.45, 'resolveVia: override with bad drill falls back to half-size drill');
let rvd = KR.resolveVia(null, { viaSize: 0.8, viaDrill: 0.4 });
ok(rvd.size === 0.8 && rvd.drill === 0.4, 'resolveVia: null override → class size/drill pair');
ok(KR.resolveVia({ size: 1.0, drill: 0.5 }, { viaSize: 0.8, viaDrill: 0.4 }).size === 1.0, 'resolveVia: explicit pair wins');
ok(KR.widthChoices(0.25, [1.0])[0] === 0.25 && KR.viaChoices(0.8, 0.4, []).length === 1, 'choices: class-only inputs survive');

console.log('test_route.js: ' + pass + ' checks passed');
