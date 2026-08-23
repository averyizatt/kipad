'use strict';

/**
 * Kipad copper zones / pours tests — KipadZones fill engine + board model.
 * Run: node test/test_zones.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
g.KipadBoard = require('../js/board.js');

const B = g.KipadBoard;
const Z = require('../js/zones.js');

// square ring 0..10
const SQUARE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

// is the cell containing world point (x,y) filled?
function fillHas(f, x, y) {
  const c = Math.floor((x - f.ox) / f.cellSize);
  const r = Math.floor((y - f.oy) / f.cellSize);
  if (c < 0 || r < 0) return false;
  return f.runs.some(run => run[0] === r && c >= run[1] && c <= run[2]);
}
function minTrackDist(f, t) {
  // smallest distance from any filled cell centre to a track segment
  let best = Infinity;
  for (const run of f.runs) {
    for (let c = run[1]; c <= run[2]; c++) {
      const cx = f.ox + (c + 0.5) * f.cellSize;
      const cy = f.oy + (run[0] + 0.5) * f.cellSize;
      const d = Z.pointSegDist(cx, cy, t.ax, t.ay, t.bx, t.by) - t.r;
      if (d < best) best = d;
    }
  }
  return best;
}

// ---- 1. point-in-polygon ----
assert.strictEqual(Z.pointInPolygon(5, 5, SQUARE), true, 'centre inside');
assert.strictEqual(Z.pointInPolygon(-1, 5, SQUARE), false, 'left outside');
assert.strictEqual(Z.pointInPolygon(11, 11, SQUARE), false, 'corner outside');
assert.strictEqual(Z.pointInPolygon(0, 5, SQUARE), true, 'edge counts as inside');
assert.strictEqual(Z.pointInPolygon(0.2, 9.9, SQUARE), true, 'near corner inside');
assert.strictEqual(Z.pointInPolygon(5, -0.001, SQUARE), false, 'just below edge outside');

// ---- 2. fill connects across a same-net track to a pad ----
const WIDE = [{ x: 0, y: -1 }, { x: 21, y: -1 }, { x: 21, y: 11 }, { x: 0, y: 11 }];
const sameNetCtx = {
  pads: [{ x: 1, y: 4, w: 2, h: 2, net: 'GND' }],
  tracks: [{ ax: 3, ay: 5, bx: 17, by: 5, r: 0.125, net: 'GND' }],
  vias: [],
  netClassOf: () => ({ clearance: 0.2 })
};
const f1 = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: WIDE }, sameNetCtx);
assert.ok(f1.filled, 'fill produced geometry');
assert.ok(f1.runs.length > 20, 'multiple runs, got ' + f1.runs.length);
assert.ok(f1.area > 30, 'large area filled, got ' + f1.area.toFixed(1));
assert.ok(fillHas(f1, 1.8, 4.5), 'cells over the seed pad are filled');
assert.ok(fillHas(f1, 16.5, 5), 'pour follows the track to its far end');
assert.strictEqual(fillHas(f1, -1, 5), false, 'nothing outside the outline');

// ---- 3. island with no same-net copper stays unfilled ----
const foreignOnly = {
  pads: [],
  tracks: [{ ax: 3, ay: 5, bx: 17, by: 5, r: 0.125, net: 'VCC' }],
  vias: [],
  netClassOf: () => ({ clearance: 0.2 })
};
const f2 = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE }, foreignOnly);
assert.strictEqual(f2.runs.length, 0, 'no seeds -> island unfilled');
assert.strictEqual(f2.area, 0, 'island area is zero');

// seed outside the outline cannot feed an inside island either
const seedOutside = {
  pads: [{ x: -3, y: 4, w: 2, h: 2, net: 'GND' }],
  tracks: [],
  vias: [],
  netClassOf: () => ({ clearance: 0.2 })
};
const f3 = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE }, seedOutside);
assert.strictEqual(f3.runs.length, 0, 'same-net pad outside the outline does not fill it');

// ---- 4. clearance gap to a foreign track is respected ----
const wall = { ax: 10, ay: -1, bx: 10, by: 11, r: 0.25 }; // VCC wall through the zone
const gapCtx = {
  pads: [{ x: 1, y: 4, w: 2, h: 2, net: 'GND' }],
  tracks: [wall],
  vias: [],
  netClassOf: () => ({ clearance: 0.2 })
};
const f4 = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE }, gapCtx);
assert.ok(f4.filled, 'left compartment fills around the wall');
assert.ok(minTrackDist(f4, wall) >= 0.2 - 1e-6,
  'every filled cell keeps 0.2mm clearance from the foreign track (min ' + minTrackDist(f4, wall).toFixed(3) + ')');
assert.ok(!f4.runs.some(run => {
  const cx = f4.ox + (run[2] + 0.5) * f4.cellSize;
  return cx > 10.7;   // nothing filled beyond the wall on the right half
}), 'right side beyond the wall has no GND pour (cut off)');

// wider class clearance -> bigger kept-out band
const wideCtx = Object.assign({}, gapCtx, { netClassOf: () => ({ clearance: 0.9 }) });
const f5 = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE }, wideCtx);
assert.ok(minTrackDist(f5, wall) >= 0.9 - 1e-6, 'netClassOf clearance of 0.9 respected');
assert.ok(f5.area < f4.area, 'wider clearance leaves less copper');

// explicit zone.clearance overrides the class value
const override = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE, clearance: 0.05 }, wideCtx);
assert.ok(minTrackDist(override, wall) >= 0.05 - 1e-6, 'zone clearance override respected');
assert.ok(override.area > f5.area, 'smaller override fills more than the 0.9 class');

// vias block too
const viaCtx = {
  pads: [{ x: 1, y: 4, w: 2, h: 2, net: 'GND' }],
  tracks: [],
  vias: [{ x: 6, y: 6, r: 0.3, net: 'VCC' }],
  netClassOf: () => ({ clearance: 0.2 })
};
const f6 = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE }, viaCtx);
assert.strictEqual(fillHas(f6, 6, 6), false, 'cell over the foreign via blocked');
assert.ok(fillHas(f6, 2.5, 2), 'rest of the pour still fills');

// other zones with a different net keep their distance
const pairCtx = {
  pads: [{ x: 1, y: 4, w: 2, h: 2, net: 'GND' }],
  tracks: [],
  vias: [],
  zones: [{ outline: [{ x: 5, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 10 }, { x: 5, y: 10 }], net: 'VCC' }],
  netClassOf: () => ({ clearance: 0.2 })
};
const f7 = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE }, pairCtx);
assert.strictEqual(fillHas(f7, 6, 5), false, 'inside a foreign zone is blocked');
for (let y = 0.125; y < 10; y += 0.5) {
  assert.strictEqual(fillHas(f7, 5.15, y), false, 'clearance strip left of foreign zone at y=' + y);
}

// ---- 5. board model: addZone / zonesOn / two layers coexist ----
const b = B.makeBoard();
B.addNet(b, 'GND');
B.addTrack(b, [0, 5], [8, 5], 0.25, 'F.Cu', 1);
const zF = B.addZone(b, { net: 'GND', layer: 'F.Cu', outline: [[-1, -1], [21, -1], [21, 11], [-1, 11]] });
const zB = B.addZone(b, { net: '', layer: 'B.Cu', outline: SQUARE });
assert.strictEqual(zF.id !== zB.id, true, 'distinct zone ids');
assert.deepStrictEqual(zF.outline[0], { x: -1, y: -1 }, 'array points normalized to {x,y}');
assert.strictEqual(b.zones.length, 2, 'both zones stored');
assert.strictEqual(B.zonesOn(b, 'F.Cu').length, 1, 'one F.Cu zone');
assert.strictEqual(B.zonesOn(b, 'B.Cu').length, 1, 'one B.Cu zone — layers coexist');
assert.strictEqual(B.zonesOn(b, 'F.Cu')[0].net, 'GND', 'net name stored');

// ---- 6. removeZone ----
assert.ok(B.removeZone(b, zF.id), 'removeZone ok');
assert.strictEqual(B.removeZone(b, zF.id), false, 'second remove fails');
assert.strictEqual(b.zones.length, 1, 'one zone left');

// ---- 7. JSON round-trip preserves zones (localStorage path) ----
const rt = JSON.parse(JSON.stringify(b));
assert.ok(Array.isArray(rt.zones) && rt.zones.length === 1, 'zones survive JSON round-trip');
assert.deepStrictEqual(rt.zones[0], b.zones[0], 'round-tripped zone identical');
assert.strictEqual(rt.zones[0].layer, 'B.Cu', 'layer persists');
assert.strictEqual(rt.zones[0].outline.length, 4, 'outline persists');

// ---- 8. refill determinism ----
const fa = Z.fillZone(zF, sameNetCtx);
const fb = Z.fillZone(zF, sameNetCtx);
assert.deepStrictEqual(JSON.parse(JSON.stringify(fa)), JSON.parse(JSON.stringify(fb)), 'two refills identical');

// configurable grid resolution changes granularity but still connects
const coarse = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE }, sameNetCtx, { cellSize: 0.5 });
const fine = Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: SQUARE }, sameNetCtx, { cellSize: 0.125 });
assert.strictEqual(coarse.cellSize, 0.5, 'coarse cell size honoured');
assert.ok(coarse.filled && fine.filled, 'both resolutions connect');
assert.ok(Math.abs(coarse.area - fine.area) < 12, 'areas roughly agree across resolutions');

// degenerate outline -> empty fill, no crash
assert.strictEqual(Z.fillZone({ net: 'GND', layer: 'F.Cu', outline: [{ x: 0, y: 0 }] }, sameNetCtx).filled, false, 'degenerate outline safe');

// ---- 9. end-to-end: board-level fill sees pads/tracks/vias like the app ----
b.zones.push(zF);   // re-add
const fp = B.placeFootprint(b, 'R_0603_1608Metric', [2, 2], 0, 'F.Cu', 'R');
fp.pads.forEach(p => { p.netId = 1; });
B.addVia(b, [18, 5], 0.6, 0.3, 1);
const vccId = B.addNet(b, 'VCC');
B.addTrack(b, [12, 3], [12, 7], 0.5, 'F.Cu', vccId);
const pads = [], tracks = [], vias = [];
for (const f of b.footprints) for (const p of f.pads) {
  pads.push({ x: p.at[0] - p.size[0] / 2, y: p.at[1] - p.size[1] / 2, w: p.size[0], h: p.size[1], net: B.netName(b, p.netId) });
}
for (const t of b.tracks) tracks.push({ ax: t.start[0], ay: t.start[1], bx: t.end[0], by: t.end[1], r: t.width / 2, net: B.netName(b, t.netId) });
for (const v of b.vias) vias.push({ x: v.at[0], y: v.at[1], r: v.size / 2, net: B.netName(b, v.netId) });
const fe = Z.fillZone(zF, {
  pads, tracks, vias,
  netClassOf: name => B.netClassOfNet(b, (b.nets.find(n => n.name === name) || { id: 0 }).id)
});
assert.ok(fe.filled, 'board-level fill works');
assert.ok(fe.area > 60, 'most of the 22x12 zone fills, got ' + fe.area.toFixed(1));
assert.ok(fillHas(fe, 2, 2), 'pour merges over the GND pads');
assert.ok(fillHas(fe, 18, 5), 'pour reaches around the same-net via');
const vWall = { ax: 12, ay: 3, bx: 12, by: 7, r: 0.25 };
assert.strictEqual(fillHas(fe, 12, 5), false, 'no pour over the foreign VCC track');
assert.ok(minTrackDist(fe, vWall) >= 0.2 - 1e-6,
  'board-level fill keeps class clearance from VCC (min ' + minTrackDist(fe, vWall).toFixed(3) + ')');

console.log('ZONE TESTS PASSED');
