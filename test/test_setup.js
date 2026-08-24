'use strict';

/**
 * KipadSetup tests — board-setup model normalization + DRC constraint overrides.
 * Run: node test/test_setup.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
const KS = require('../js/setup.js');
const B = require('../js/board.js');

let pass = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✓ ' + name); } else { console.log('  ✗ FAIL: ' + name); process.exitCode = 1; } }
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---- effective(): defaults when no setup present ----
{
  const s = KS.effective({});
  ok(s.minClearance === null, 'no setup → minClearance null (follow net classes)');
  ok(near(s.holeClearance, 0.25) && near(s.edgeClearance, 0.5), 'KiCad constraint defaults');
  ok(JSON.stringify(s.trackWidths) === JSON.stringify(KS.PRESET_TRACK_WIDTHS), 'preset track widths');
  ok(Array.isArray(s.viaSizes) && s.viaSizes.length === 4 && Array.isArray(s.viaSizes[0]), 'preset via pairs are [size,drill] arrays');
}

// ---- normalize(): partial overrides + unknown keys dropped + invalid fallbacks ----
{
  const s = KS.normalize({ minClearance: 0.3, holeClearance: 0.4, unknownJunk: 'x', trackWidths: [9, 0.1111] });
  ok(s.unknownJunk === undefined, 'unknown keys dropped');
  ok(s.minClearance === 0.3 && near(s.holeClearance, 0.4) && near(s.edgeClearance, 0.5),
    'partial override merges over defaults');
  ok(JSON.stringify(s.trackWidths) === JSON.stringify([0.111, 9]), 'widths rounded to 3 decimals + ascending');
}
{
  const s = KS.normalize({ minClearance: '', holeClearance: NaN, edgeClearness: -5 });
  ok(s.minClearance === null && near(s.holeClearance, 0.25) && near(s.edgeClearance, 0.5),
    'blank/garbage values fall back to class-follow + defaults');
}
{
  const s = KS.normalize({ minClearance: -1, holeClearance: 0, edgeClearance: -2 });
  ok(s.minClearance === null && near(s.holeClearance, 0.25) && near(s.edgeClearance, 0.5),
    'negative/zero constraints rejected (edge must be >= 0, hole > 0)');
}
{
  const s = KS.normalize({ edgeClearance: 0 });
  ok(s.edgeClearance === 0, 'edge clearance of exactly 0 allowed (= check disabled)');
}
{
  const s = KS.normalize({ minClearance: '0.35' }); // numeric strings coerce like form inputs
  ok(s.minClearance === 0.35, 'numeric strings coerce');
}

// ---- widths(): dedupe + sort + garbage tolerance ----
{
  ok(KS.widths([0.5, 0.2, 0.5, 0.8, 'x', -1, 0]).length === 3, 'garbage/non-positive widths dropped, deduped, sorted');
  ok(JSON.stringify(KS.widths([])) === JSON.stringify(KS.PRESET_TRACK_WIDTHS), 'all-garbage list falls back to presets');
  ok(JSON.stringify(KS.normalize({ trackWidths: 'junk' }).trackWidths) === JSON.stringify(KS.PRESET_TRACK_WIDTHS),
    'non-array widths fall back to presets');
}

// ---- vias(): pair forms, drill fallback, annulus rule, dedupe by size ----
{
  const v = KS.vias([[0.8, 0.4], [0.6], { size: 1.0, drill: 0.45 }, 1.27]);
  ok(v.length === 4, 'array / short-array / object / bare-number forms accepted');
  ok(JSON.stringify(v[0]) === JSON.stringify([0.6, 0.3]), 'missing drill → half the size');
  ok(JSON.stringify(v[2]) === JSON.stringify([1, 0.45]) && JSON.stringify(v[3]) === JSON.stringify([1.27, 0.635]),
    'object and bare-number forms normalized');
}
{
  ok(KS.vias([[1, 1]]).every(p => p[1] < p[0]), 'drill >= size rejected (no annulus)');
  const v = KS.vias([[0.6, 0.25], [0.6, 0.3]]);
  ok(v.length === 1 && near(v[0][1], 0.25), 'same-size duplicates: first wins');
  ok(JSON.stringify(KS.vias([])) === JSON.stringify(KS.PRESET_VIA_SIZES), 'empty via list falls back to presets');
}

// ---- DRC integration: constraint overrides reach runDRC ----
let seq = 0;
function mkPad(x, y, opts) {
  const o = Object.assign({ size: [0.5, 0.5], type: 'smd', shape: 'rect', drill: null, netId: 0 }, opts || {});
  return {
    number: '1', type: o.type, shape: o.shape, at: [x, y], angle: 0,
    size: o.size, drill: o.drill, radius: null, layers: o.type === 'tht' ? ['*.Cu'] : ['F.Cu'], netId: o.netId
  };
}
function mkFp(b, ref, pads) {
  const fp = { id: 'FT' + (++seq), lib: 'FakeLib', ref, value: '', at: [0, 0], angle: 0, layer: 'F.Cu', pads };
  b.footprints.push(fp);
  return fp;
}
function squareOutline() { return [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]; }
g.window.KipadFootprints = { getFootprint: () => ({ pads: [], silk: [] }) };

// pad-pad clearance: gap 0.5 mm between two 0.5 mm pads on different nets
function clearBoard() {
  const b = B.makeBoard();
  b.outline = squareOutline();
  const na = B.addNet(b, 'A'), nb = B.addNet(b, 'B');
  mkFp(b, 'R1', [mkPad(10, 20, { netId: na })]);
  mkFp(b, 'R2', [mkPad(11, 20, { netId: nb })]); // gap = 1 - 0.25 - 0.25 = 0.5
  return b;
}
{
  const b = clearBoard();
  ok(B.runDRC(b).every(v => v.type !== 'pad-pad'), 'default class rules leave 0.5 mm gap clean');
  ok(B.runDRC(b, { clearance: 0.8 }).filter(v => v.type === 'pad-pad').length === 1,
    'setup minClearance override tightens the rule');
  ok(B.runDRC(b, 0.8).filter(v => v.type === 'pad-pad').length === 1,
    'legacy number-arg override still works');
  const v = B.runDRC(b, { clearance: 0.8 }).find(v => v.type === 'pad-pad');
  assert.ok(v);
  ok(v.msg.includes('0.8'), 'violation message reports the overridden clearance');
}

// hole-to-copper: foreign track crowds a THT pad drill (gap 0.175 < 0.25 default)
function holeBoard() {
  const b = B.makeBoard();
  b.outline = squareOutline();
  const na = B.addNet(b, 'A'), nb = B.addNet(b, 'B');
  mkFp(b, 'J1', [mkPad(20, 20, { type: 'tht', size: [2, 2], drill: 1, netId: na })]);
  B.addTrack(b, [20.8, 20], [30, 20], 0.25, 'F.Cu', nb);
  return b;
}
{
  const b = holeBoard();
  ok(B.runDRC(b).some(v => v.type === 'hole-track'), 'default hole clearance flags the crowded drill');
  ok(!B.runDRC(b, { holeClearance: 0.1 }).some(v => v.type === 'hole-track'),
    'relaxed setup hole clearance clears it');
  const relaxed = B.runDRC(holeBoard(), { holeClearance: 0.18 });
  ok(relaxed.some(v => v.type === 'hole-track') && relaxed.find(v => v.type === 'hole-track').msg.includes('0.18'),
    'intermediate hole threshold reported correctly');
}

// copper-to-edge: pad ring stops 0.2 mm short of the outline (default 0.5 flags)
function edgeBoard() {
  const b = B.makeBoard();
  b.outline = squareOutline();
  const na = B.addNet(b, 'A');
  mkFp(b, 'R1', [mkPad(38.8, 20, { netId: na })]); // rightmost copper x=39.05 → gap 0.95… widen below
  return b;
}
{
  // place the pad so its copper ends exactly 0.2 mm from the edge
  const b = edgeBoard();
  b.footprints[0].pads[0].at[0] = 39.55; // copper edge 39.8, outline 40 → gap 0.2
  ok(B.runDRC(b).some(v => v.type === 'edge-pad'), 'default edge clearance flags 0.2 mm gap');
  ok(!B.runDRC(b, { edgeClearance: 0.1 }).some(v => v.type.startsWith('edge-')),
    'relaxed setup edge clearance clears it');
}

// full pipeline through effective(): what the app actually passes
{
  const b = clearBoard();
  b.setup = KS.normalize({ minClearance: 0.8 });
  const s = KS.effective(b);
  ok(B.runDRC(b, { clearance: s.minClearance, holeClearance: s.holeClearance, edgeClearance: s.edgeClearance })
    .filter(v => v.type === 'pad-pad').length === 1,
    'effective() output wired straight into runDRC flags the violation');
}

console.log('\nKipadSetup: ' + pass + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
