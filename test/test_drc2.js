'use strict';

/**
 * Kipad expanded DRC tests — hole-to-copper, copper-to-edge, silkscreen-over-pad.
 * Run: node test/test_drc2.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
g.KipadBoard = require('../js/board.js');

const B = g.KipadBoard;

let seq = 0;
function mkPad(x, y, opts) {
  const o = Object.assign({ size: [2, 2], type: 'tht', shape: 'circle', drill: 1, netId: 0 }, opts || {});
  return {
    number: '1', type: o.type, shape: o.shape, at: [x, y], angle: 0,
    size: o.size, drill: o.drill, radius: null, layers: o.layers || ['F.Cu'], netId: o.netId
  };
}
function mkFp(b, ref, pads) {
  const fp = { id: 'FT' + (++seq), lib: 'FakeSilk', ref, value: '', at: [0, 0], angle: 0, layer: 'F.Cu', pads };
  b.footprints.push(fp);
  return fp;
}
function squareOutline(size) {
  const s = size || 40;
  return [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
}

// fake footprint library with configurable silk art (board.js resolves root.KipadFootprints first)
let fakeSilk = [{ type: 'line', pts: [[-3, 0], [3, 0]] }];
g.window.KipadFootprints = { getFootprint: () => ({ pads: [], silk: fakeSilk }) };

// ---- 1. hole-to-copper: track crossing a THT pad drill of another net ----
{
  const b = B.makeBoard();
  b.outline = squareOutline();
  const na = B.addNet(b, 'A'), nb = B.addNet(b, 'B');
  mkFp(b, 'J1', [mkPad(20, 20, { netId: na })]);
  B.addTrack(b, [23, 20], [30, 20], 0.25, 'F.Cu', nb); // gap 3 - .5(hole) - .125(track) = 2.375 clean
  assert.ok(!B.runDRC(b).some(v => v.type === 'hole-track'), 'far track stays clean');
  B.addTrack(b, [20.8, 20], [22.5, 20], 0.25, 'F.Cu', nb); // gap .8 - .5 - .125 = .175 < .25
  const vs = B.runDRC(b).filter(v => v.type === 'hole-track');
  assert.strictEqual(vs.length, 1, 'track over foreign pad hole flagged once');
  assert.strictEqual(vs[0].severity, 'error', 'hole violation is an error');
  assert.strictEqual(vs[0].x, 20, 'hole violation located at hole centre');
}

// ---- 2. same-net + own-pad exemptions ----
{
  const b = B.makeBoard();
  const na = B.addNet(b, 'A');
  mkFp(b, 'J1', [mkPad(0, 0, { netId: na })]);
  B.addTrack(b, [0.8, 0], [5, 0], 0.25, 'F.Cu', na);
  assert.ok(!B.runDRC(b).includes('hole-track'), 'placeholder');
  assert.ok(!B.runDRC(b).some(v => v.type === 'hole-track'), 'same-net track over hole exempt');

  const b2 = B.makeBoard();
  mkFp(b2, 'P2', [mkPad(0, 0, {})]); // unconnected THT pad: annulus surrounds own drill
  assert.ok(!B.runDRC(b2).some(v => v.type === 'hole-pad'), "pad's own drill exempt even unconnected");
}

// ---- 3. via drill vs other-net track on another layer ----
{
  const b = B.makeBoard();
  const na = B.addNet(b, 'A'), nb = B.addNet(b, 'B');
  B.addVia(b, [10, 10], 0.6, 0.3, na); // drill r 0.15
  B.addTrack(b, [10.35, 10], [16, 10], 0.25, 'B.Cu', nb); // gap .35-.15-.125=.075 < .25
  const vs = B.runDRC(b).filter(v => v.type === 'hole-track' && v.layer === 'B.Cu');
  assert.ok(vs.length >= 1, 'track under foreign via drill flagged');
  assert.strictEqual(vs[0].severity, 'error', 'via-drill violation is error');
}

// ---- 3b. through-hole annulus participates in copper DRC on both layers ----
{
  const b = B.makeBoard();
  const na = B.addNet(b, 'THT'), nb = B.addNet(b, 'BACK');
  mkFp(b, 'J1', [mkPad(10, 10, { netId: na, layers: ['*.Cu', '*.Mask'] })]);
  B.addTrack(b, [11.25, 10], [16, 10], 0.2, 'B.Cu', nb); // gap .15mm < .2mm
  const vs = B.runDRC(b).filter(v => v.type === 'pad-track' && v.layer === 'B.Cu');
  assert.strictEqual(vs.length, 1, 'THT pad wildcard copper is checked against B.Cu');

  b.tracks[0].start = [11.5, 10];
  assert.strictEqual(B.runDRC(b).filter(v => v.type === 'pad-track' && v.layer === 'B.Cu').length, 0,
    'THT pad to B.Cu track clears once the class gap is met');
}

// ---- 4. copper-to-board-edge ----
{
  const b = B.makeBoard();
  b.outline = squareOutline();
  const na = B.addNet(b, 'A');
  mkFp(b, 'R1', [mkPad(0.3, 20, { size: [1, 1], type: 'smd', drill: null, netId: na })]); // crosses left edge
  const vs = B.runDRC(b).filter(v => v.type === 'edge-pad');
  assert.strictEqual(vs.length, 1, 'pad straddling outline flagged');
  assert.strictEqual(vs[0].severity, 'error', 'edge violation is error');
  assert.strictEqual(vs[0].layer, 'F.Cu', 'edge violation carries layer');

  const b2 = B.makeBoard();
  b2.outline = squareOutline();
  mkFp(b2, 'R2', [mkPad(20, 20, { size: [1, 1], type: 'smd', drill: null })]);
  assert.ok(!B.runDRC(b2).some(v => v.type.startsWith('edge-')), 'well-inside pad clean');

  const b3 = B.makeBoard(); // no outline → check skipped
  mkFp(b3, 'R3', [mkPad(0, 0, { type: 'smd', drill: null })]);
  assert.ok(!B.runDRC(b3).some(v => v.type.startsWith('edge-')), 'no outline → no edge checks');
}

// ---- 5. silkscreen text over exposed pads ----
{
  const b = B.makeBoard();
  const na = B.addNet(b, 'GND');
  mkFp(b, 'R1', [mkPad(10, 10, { size: [2, 2], type: 'smd', drill: null, netId: na })]);
  B.addText(b, { text: 'GND', at: [10, 10], layer: 'F.SilkS', size: 1 });
  let vs = B.runDRC(b).filter(v => v.type === 'silk-text');
  assert.strictEqual(vs.length, 1, 'text over pad warned');
  assert.strictEqual(vs[0].severity, 'warning', 'silk overlap is warning');
  b.texts[0].at = [30, 30];
  assert.strictEqual(B.runDRC(b).filter(v => v.type === 'silk-text').length, 0, 'clear text fine');
  b.texts[0].layer = 'B.SilkS'; b.texts[0].at = [10, 10];
  assert.strictEqual(B.runDRC(b).filter(v => v.type === 'silk-text').length, 0, 'no cross-side false positive');
  b.texts[0].layer = 'F.SilkS';
  b.texts[0].angle = 90; // rotated text still caught (rotation-aware bbox)
  assert.strictEqual(B.runDRC(b).filter(v => v.type === 'silk-text').length, 1, 'rotated text still caught');
}

// ---- 6. footprint silk art across a FOREIGN pad ----
{
  const b = B.makeBoard();
  const na = B.addNet(b, 'N');
  mkFp(b, 'U1', []);                                                    // silk-only fp at origin
  mkFp(b, 'U2', [mkPad(0, 0, { size: [2, 2], type: 'smd', drill: null, netId: na })]);
  let vs = B.runDRC(b).filter(v => v.type === 'silk-line');
  assert.strictEqual(vs.length, 1, 'foreign silk across pad core flagged');
  assert.strictEqual(vs[0].severity, 'warning', 'silk line is warning');
  assert.ok(vs[0].msg.indexOf('U1') >= 0 && vs[0].msg.indexOf('U2') >= 0, 'message names both fps');

  fakeSilk = [{ type: 'line', pts: [[-3, 0.9], [3, 0.9]] }];            // clips only outer band
  vs = B.runDRC(b).filter(v => v.type === 'silk-line');
  assert.strictEqual(vs.length, 0, 'corner-clipping silk stays quiet');

  fakeSilk = [{ type: 'line', pts: [[-3, 0], [3, 0]] }];
  const b2 = B.makeBoard();
  mkFp(b2, 'W1', [mkPad(0, 0, { size: [2, 2], type: 'smd', drill: null, netId: na })]); // own pad exempt
  assert.strictEqual(B.runDRC(b2).filter(v => v.type === 'silk-line').length, 0, 'own-library silk exempt');
}

// ---- 7. regression: classic clearance still works, severity always present ----
{
  const b = B.makeBoard();
  const na = B.addNet(b, 'A'), nb = B.addNet(b, 'B');
  B.addTrack(b, [0, 0], [5, 0], 0.25, 'F.Cu', na);
  B.addTrack(b, [0, 0.2], [5, 0.2], 0.25, 'F.Cu', nb);
  const vs = B.runDRC(b);
  const tt = vs.find(v => v.type === 'track-track');
  assert.ok(tt, 'copper clearance still flags close tracks');
  assert.strictEqual(tt.severity, 'error', 'classic violation tagged error');
  assert.ok(vs.every(v => v.severity === 'error' || v.severity === 'warning'), 'all violations carry severity');
  assert.strictEqual(B.HOLE_CLEARANCE_DEFAULT, 0.25, 'hole clearance default exported');
  assert.strictEqual(B.EDGE_CLEARANCE_DEFAULT, 0.5, 'edge clearance default exported');
}

console.log('test_drc2: all checks passed');
