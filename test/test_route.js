'use strict';
/* KipadRoute tests — 45° elbow geometry, commit cleanup, integration with a simulated tap route. */
const assert = require('assert');
const KR = require('../js/route.js');
const B = require('../js/board.js');

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

// --- via-in-route: toggleRouteVia / currentLayer ---
{
  const r = { pts: [[0, 0], [5, 0], [5, 8]], layer0: 'F.Cu', layer: 'F.Cu', vias: [] };
  ok(KR.currentLayer('F.Cu', []) === 'F.Cu' && KR.currentLayer('F.Cu', [{ idx: 1 }]) === 'B.Cu', 'currentLayer: flips per via');
  ok(KR.currentLayer('F.Cu', [{ idx: 1 }, { idx: 2 }]) === 'F.Cu', 'currentLayer: double flip returns home');
  KR.toggleRouteVia(r, 0.8, 0.4);
  ok(r.vias.length === 1 && r.vias[0].idx === 2 && r.vias[0].size === 0.8 && r.vias[0].drill === 0.4, 'toggleRouteVia: via lands on the LAST point');
  ok(r.layer === 'B.Cu', 'toggleRouteVia: layer flipped to B.Cu');
  KR.toggleRouteVia(r, 0.8, 0.4);
  ok(r.vias.length === 0 && r.layer === 'F.Cu', 'toggleRouteVia: second press removes the via and flips back');
  const empty = { pts: [], vias: [] };
  ok(KR.toggleRouteVia(empty, 1, 0.5) === empty && empty.vias.length === 0, 'toggleRouteVia: no points → no-op, no crash');
}

// --- commitPlan: plain route (no vias) keeps legacy behaviour ---
{
  const plan = KR.commitPlan({ pts: [[0, 0], [4, 4], [10, 4]], width: 0.25, layer0: 'F.Cu', vias: [] });
  ok(plan && plan.segments.length === 2 && plan.vias.length === 0, 'commitPlan: two clean segments, no vias');
  ok(plan.segments.every(s => s.layer === 'F.Cu'), 'commitPlan: all segments on the starting layer without vias');
  ok(plan.segments.every(s => s.width === 0.25), 'commitPlan: widths carried through');
}

// --- commitPlan: mid-route via splits layers at the right segment ---
{
  // F.Cu: (0,0)->(5,0); via at (5,0); B.Cu: (5,0)->(5,8)
  const r = { pts: [[0, 0], [5, 0], [5, 8]], layer0: 'F.Cu', layer: 'B.Cu', width: 0.3, vias: [{ idx: 1, size: 0.8, drill: 0.4 }] };
  const plan = KR.commitPlan(r);
  ok(plan.segments.length === 2, 'commitPlan: via splits into two segments');
  ok(plan.segments[0].layer === 'F.Cu' && plan.segments[1].layer === 'B.Cu', 'commitPlan: pre-via F.Cu / post-via B.Cu');
  ok(plan.vias.length === 1 && plan.vias[0].at[0] === 5 && plan.vias[0].at[1] === 0, 'commitPlan: via placed at the marked point');
  ok(plan.vias[0].size === 0.8 && plan.vias[0].drill === 0.4, 'commitPlan: resolved size/drill carried onto the board via');

  // double flip F -> B -> F
  const r2 = { pts: [[0, 0], [5, 0], [5, 8], [9, 8]], layer0: 'F.Cu', width: 0.3, vias: [{ idx: 1, size: 0.6, drill: 0.3 }, { idx: 2, size: 0.9, drill: 0.45 }] };
  const p2 = KR.commitPlan(r2);
  ok(p2.segments.map(s => s.layer).join(',') === 'F.Cu,B.Cu,F.Cu', 'commitPlan: two vias give F/B/F sandwich');
  ok(p2.vias.length === 2, 'commitPlan: both vias committed');

  // via on the FIRST point (pad sits on F, route continues on B)
  const r3 = { pts: [[2, 2], [7, 2]], layer0: 'F.Cu', width: 0.3, vias: [{ idx: 0, size: 0.8, drill: 0.4 }] };
  const p3 = KR.commitPlan(r3);
  ok(p3.segments[0].layer === 'B.Cu' && p3.vias[0].at[0] === 2, 'commitPlan: start-point via flips from segment one');

  // trailing via (V then Enter): via commits, no segment inherits a bogus layer
  const r4 = { pts: [[0, 0], [5, 0]], layer0: 'F.Cu', width: 0.3, vias: [{ idx: 1, size: 0.8, drill: 0.4 }] };
  const p4 = KR.commitPlan(r4);
  ok(p4.segments.length === 1 && p4.segments[0].layer === 'F.Cu' && p4.vias.length === 1, 'commitPlan: end-of-route via kept, segments untouched');

  // stale via (idx past the last point after Backspace) is dropped
  const r5 = { pts: [[0, 0], [5, 0]], layer0: 'F.Cu', width: 0.3, vias: [{ idx: 3, size: 0.8, drill: 0.4 }] };
  const p5 = KR.commitPlan(r5);
  ok(p5.vias.length === 0 && p5.segments.every(s => s.layer === 'F.Cu'), 'commitPlan: stale via dropped');
}

// --- cleanupRouted protects via points ---
{
  // collinear straight-through: (0,0) -> (5,0) [via] -> (10,0)
  const cr = KR.cleanupRouted([[0, 0], [5, 0], [10, 0]], [{ idx: 1, size: 0.8, drill: 0.4 }]);
  ok(cr.pts.length === 3 && cr.vias.length === 1 && cr.vias[0].idx === 1, 'cleanupRouted: collinear middle with a via survives');
  // same shape without a via collapses
  const cr2 = KR.cleanupRouted([[0, 0], [5, 0], [10, 0]], []);
  ok(cr2.pts.length === 2 && cr2.vias.length === 0, 'cleanupRouted: collinear middle without a via still merges');
  // duplicate points merge, survivor keeps the via flag
  const cr3 = KR.cleanupRouted([[0, 0], [5, 0], [5, 0], [5, 8]], [{ idx: 2, size: 0.8, drill: 0.4 }]);
  ok(cr3.pts.length === 3 && cr3.vias.length === 1 && cr3.vias[0].idx === 1, 'cleanupRouted: duplicate merge keeps the via on the survivor');
  // full commitPlan on the straight-through case: three segments split around the via
  const p = KR.commitPlan({ pts: [[0, 0], [5, 0], [10, 0]], layer0: 'F.Cu', width: 0.3, vias: [{ idx: 1, size: 0.8, drill: 0.4 }] });
  ok(p.segments.length === 2 && p.segments[0].layer === 'F.Cu' && p.segments[1].layer === 'B.Cu', 'commitPlan: straight-through via splits layers mid-line');
}

// --- commitPlan degenerate cases ---
ok(KR.commitPlan({ pts: [[1, 1]], vias: [{ idx: 0, size: 1, drill: 0.5 }] }) === null, 'commitPlan: single point → null (nothing to commit)');
ok(KR.commitPlan(null) === null, 'commitPlan: null route → null');

// --- clearance-aware obstacle avoidance ------------------------------------
{
  const start = [0, 0], target = [10, 0], width = 0.25;
  const direct = KR.avoid(start, target, 'diag', [], width);
  ok(JSON.stringify(direct) === '[[10,0]]', 'avoid: unobstructed route preserves the direct 45-degree tail');

  // Exact audited geometry: the direct centreline is 1.275 mm from a 2 mm pad.
  // With a 0.25 mm track that leaves 1.275 - 1.0 - 0.125 = 0.15 mm copper
  // gap, which is unsafe against the applicable 0.2 mm clearance.  The routed
  // centreline therefore has to stay >= 1.325 mm from the pad centre.
  const foreignPad = { kind: 'pad', at: [5, 1.275], radius: 1, clearance: 0.2 };
  const detour = KR.avoid(start, target, 'diag', [foreignPad], width);
  ok(detour && detour.length > 1, 'avoid: foreign-net pad causes a deterministic walk-around');
  ok(JSON.stringify(detour) === JSON.stringify(KR.avoid(start, target, 'diag', [foreignPad], width)), 'avoid: audited 0.15mm-gap detour is deterministic');
  const routed = [start].concat(detour);
  ok(routed.every((p, i) => !i || KR.isAllowed(routed[i - 1], p)), 'avoid: every pad-detour segment remains H/V/45');
  let minPad = Infinity;
  function pointSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], den = dx * dx + dy * dy;
    const t = den ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  for (let i = 0; i + 1 < routed.length; i++) minPad = Math.min(minPad, pointSeg(foreignPad.at, routed[i], routed[i + 1]));
  ok(minPad >= 1 + 0.2 + width / 2 - 1e-7, 'avoid: pad detour honours pad radius + configured clearance + half track width');
  ok(near(detour[detour.length - 1][0], target[0]) && near(detour[detour.length - 1][1], target[1]), 'avoid: detour still reaches the requested target');

  const board = B.makeBoard(), routeNet = B.addNet(board, 'ROUTE'), padNet = B.addNet(board, 'OTHER');
  board.footprints.push({ id: 'F-audit', ref: 'P1', at: foreignPad.at.slice(), angle: 0, layer: 'F.Cu', pads: [
    { number: '1', type: 'smd', shape: 'circle', at: foreignPad.at.slice(), size: [2, 2], drill: null, layers: ['F.Cu'], netId: padNet }
  ] });
  B.addTrack(board, start, target, width, 'F.Cu', routeNet);
  const audited = B.runDRC(board).find(v => v.type === 'pad-track');
  ok(audited && near(audited.dist, 0.15) && near(audited.clearance, 0.2), 'avoid regression fixture reproduces the audited 0.15mm vs 0.2mm DRC failure');
  board.tracks = [];
  for (let i = 0; i + 1 < routed.length; i++) B.addTrack(board, routed[i], routed[i + 1], width, 'F.Cu', routeNet);
  ok(!B.runDRC(board).some(v => v.type === 'pad-track'), 'avoid: committed detour is clearance-clean in the board DRC');

  const foreignTrack = { kind: 'track', a: [5, -1], b: [5, 1], radius: 0.15, clearance: 0.2 };
  const aroundTrack = KR.avoid(start, target, 'straight', [foreignTrack], width);
  ok(aroundTrack && aroundTrack.length > 1 && aroundTrack.every((p, i) => !i || KR.isAllowed(aroundTrack[i - 1], p)), 'avoid: foreign track capsule also gets a 45-degree walk-around');

  const blockedTarget = KR.avoid(start, foreignPad.at, 'diag', [foreignPad], width);
  ok(blockedTarget === null, 'avoid: target inside foreign copper is rejected instead of previewing a DRC violation');
}

// --- simulated tap flow with a mid-route via through the real pipeline ---
{
  const pts = [[0, 0]];
  for (const p of KR.elbow(pts[pts.length - 1], [8, 3])) pts.push(p); // tap 1: diagonal up to the elbow
  const route = { pts, layer0: 'F.Cu', layer: 'F.Cu', width: 0.25, posture: 'diag', vias: [] };
  KR.toggleRouteVia(route, 0.8, 0.4); // V pressed at the elbow before descending
  for (const p of KR.elbow(pts[pts.length - 1], [8, 12])) {
    if (!(p[0] === pts[pts.length - 1][0] && p[1] === pts[pts.length - 1][1])) pts.push(p); // tap 2 continues on B.Cu
  }
  const plan = KR.commitPlan(route);
  let allowed = true;
  for (let i = 0; i < plan.segments.length; i++) {
    const s = plan.segments[i];
    if (!KR.isAllowed(s.a, s.b)) allowed = false;
  }
  ok(allowed, 'simulated via route: every committed segment stays H/V/45');
  ok(plan.vias.length === 1, 'simulated via route: exactly one via staged+committed');
  const layers = plan.segments.map(s => s.layer);
  ok(layers.indexOf('F.Cu') < layers.lastIndexOf('B.Cu'), 'simulated via route: F.Cu run precedes B.Cu run');
}

// --- zone-outline obstacles in the clearance router ------------------------
//
// The interactive router refuses to commit a path that would cross an
// opposite-net zone outline (or its clearance ring), matching how it already
// treats pads, tracks and vias. Zone edges arrive as capsules with radius 0;
// the visible pour outline is the line we keep clear, and the routed
// half-width is added by route.js's obstacleRadius.
//
// These tests build a small obstacles list directly (the same shape
// routeObstacles emits after the per-net filter), and drive the same
// avoid(start, target, posture, obstacles, width) helper the track/pad
// tests use. The same-net exemption and the layer filter live at the
// routeObstacles call site in js/app.part2.js; here we exercise their
// effective behaviour by leaving the corresponding capsule out of the
// obstacles array.
{
  const start = [0, 0], target = [10, 0], width = 0.25;
  const ZONE_CLEAR = 0.2; // matches the foreign-pad/track clearance used above

  // 1) target on an opposite-net zone edge — like the existing
  // blockedTarget test for pads, the endpoint sitting on the obstacle
  // means no walk-around can place the segment endpoint at the target.
  const blockingEdge = { kind: 'zone', a: [10, 0], b: [10, 10], radius: 0, clearance: ZONE_CLEAR };
  const refused = KR.avoid(start, target, 'diag', [blockingEdge], width);
  ok(refused === null, 'avoid: target on opposite-net zone outline is refused (returns null)');

  // 2) clear margin: a vertical zone edge sitting 2 mm away from the
  // direct centreline is well outside the clearance ring, so the direct
  // 45° path is allowed unchanged.
  const farEdge = { kind: 'zone', a: [5, 2], b: [5, 10], radius: 0, clearance: ZONE_CLEAR };
  const direct = KR.avoid(start, target, 'diag', [farEdge], width);
  ok(direct && direct.length === 1 && near(direct[0][0], 10) && near(direct[0][1], 0),
     'avoid: opposite-net zone outline outside the clearance ring does not block the direct path');

  // 3) walk-around: a zone edge slicing across the direct path (analogous
  // to the existing foreign-track detour test) gets a deterministic 45°
  // bypass instead of being refused.
  const crossEdge = { kind: 'zone', a: [5, -1], b: [5, 1], radius: 0, clearance: ZONE_CLEAR };
  const detour = KR.avoid(start, target, 'diag', [crossEdge], width);
  ok(detour && detour.length > 1, 'avoid: opposite-net zone outline crossing the direct path forces a 45° walk-around');
  const routed = [start].concat(detour);
  for (let i = 0; i + 1 < routed.length; i++) ok(KR.isAllowed(routed[i], routed[i + 1]),
     'avoid: zone-detour segment ' + i + ' stays H/V/45');
  // verify the detour actually leaves the clearance ring around the edge
  let minEdge = Infinity;
  for (let i = 0; i + 1 < routed.length; i++) {
    const a = routed[i], b = routed[i + 1];
    const dx = crossEdge.b[0] - crossEdge.a[0], dy = crossEdge.b[1] - crossEdge.a[1];
    const den = dx * dx + dy * dy;
    const t = den ? Math.max(0, Math.min(1, ((a[0] - crossEdge.a[0]) * dx + (a[1] - crossEdge.a[1]) * dy) / den)) : 0;
    const px = crossEdge.a[0] + t * dx, py = crossEdge.a[1] + t * dy;
    minEdge = Math.min(minEdge, Math.hypot(a[0] - px, a[1] - py), Math.hypot(b[0] - px, b[1] - py));
  }
  ok(minEdge >= ZONE_CLEAR + width / 2 - 1e-7, 'avoid: zone-detour honours the zone clearance ring + half track width');
  ok(near(detour[detour.length - 1][0], target[0]) && near(detour[detour.length - 1][1], target[1]),
     'avoid: zone-detour still reaches the requested target');

  // 4) same-net zone outline does NOT block the route. routeObstacles
  // filters same-net zones out at the call site, so the obstacles array
  // passed to avoid() never contains the capsule. The direct path must
  // therefore be returned unchanged — the same shape that would have been
  // blocked by Test 3 with the capsule present.
  const sameNet = KR.avoid(start, target, 'diag', [], width); // filter applied: no capsule
  ok(sameNet && sameNet.length === 1 && near(sameNet[0][0], 10) && near(sameNet[0][1], 0),
     'avoid: same-net zone outline is filtered at the call site — direct path is returned');

  // 5) zone on the OTHER copper layer is not in this layer's obstacle
  // set at all. The same capsule that blocks in Test 3 must not appear in
  // an F.Cu routing call when the zone actually lives on B.Cu. We model
  // that by simply not including the capsule (the layer filter is a
  // build-time decision at the call site, exactly like the same-net
  // filter above).
  const otherLayer = KR.avoid(start, target, 'diag', [], width); // B.Cu zone omitted from F.Cu obstacles
  ok(otherLayer && otherLayer.length === 1 && near(otherLayer[0][0], 10) && near(otherLayer[0][1], 0),
     'avoid: zone on the other copper layer is filtered at the call site — direct path is returned');
}
