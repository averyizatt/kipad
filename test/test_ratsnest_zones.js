'use strict';

/**
 * Zone-fill connectivity tests: a filled pour joins all same-net copper it
 * touches, so ratsnest airwires (and the DRC unconnected-items check) treat
 * the pour's outline region as copper. Run: node test/test_ratsnest_zones.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
g.KipadBoard = require('../js/board.js');

const B = g.KipadBoard;

let seq = 0;
function mkPad(x, y, opts) {
  const o = Object.assign({ size: [2, 2], type: 'smd', shape: 'circle', drill: null,
    layers: ['F.Cu'], netId: 0 }, opts || {});
  return {
    number: o.number || '1', type: o.type, shape: o.shape, at: [x, y], angle: 0,
    size: o.size, drill: o.drill, radius: null, layers: o.layers, netId: o.netId
  };
}
function mkFp(b, ref, pads) {
  const fp = { id: 'FT' + (++seq), lib: 'T', ref, value: '', at: [0, 0], angle: 0,
    layer: 'F.Cu', pads };
  b.footprints.push(fp);
  return fp;
}
function square(x0, y0, s) {
  return [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }];
}
function airwireCount(board) { return B.ratsnest(board).length; }

// ---- 1. pour joins same-net pads inside its outline ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'GND');
  mkFp(b, 'R1', [mkPad(2, 2, { netId: n }), mkPad(8, 2, { netId: n })]);
  assert.strictEqual(airwireCount(b), 1, 'unrouted baseline');
  B.addZone(b, { net: 'GND', layer: 'F.Cu', outline: square(0, 0, 10) });
  assert.strictEqual(airwireCount(b), 0, 'filled pour joins both pads -> no airwire');
}

// ---- 2. pour is net-specific: foreign pad inside stays unconnected ----
{
  const b = B.makeBoard();
  const gnd = B.addNet(b, 'GND');
  const vcc = B.addNet(b, 'VCC');
  mkFp(b, 'R1', [mkPad(2, 2, { netId: gnd }), mkPad(8, 2, { netId: gnd })]);
  mkFp(b, 'C1', [mkPad(5, 5, { netId: vcc })]);
  mkFp(b, 'C2', [mkPad(20, 20, { netId: vcc })]);
  B.addZone(b, { net: 'GND', layer: 'F.Cu', outline: square(0, 0, 10) });
  assert.strictEqual(airwireCount(b), 1, 'GND joined by pour; VCC pair keeps its one airwire');
  const ls = B.ratsnest(b);
  for (const l of ls) assert.notStrictEqual(l.netId, gnd, 'no GND airwires remain');
  assert.strictEqual(ls[0].netId, vcc, 'remaining airwire is the VCC pair');
}

// ---- 3. layer rule: F.Cu pour ignores B.Cu-only pads; stitching vias bridge ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'GND');
  mkFp(b, 'R1', [
    mkPad(2, 2, { netId: n, layers: ['B.Cu'] }),
    mkPad(8, 2, { netId: n, layers: ['B.Cu'] })
  ]);
  B.addZone(b, { net: 'GND', layer: 'F.Cu', outline: square(0, 0, 10) });
  assert.strictEqual(airwireCount(b), 2, 'opposite-face pads unrouted; pour itself needs stitching too');
  B.addVia(b, [8, 2], 0.8, 0.4, n); // via under pad2: annulus contact + sits in the pour
  assert.strictEqual(airwireCount(b), 1, 'only pad1 remains unrouted');
  const l = B.ratsnest(b)[0];
  assert.deepStrictEqual(l.a, [2, 2], 'remaining airwire starts at pad1');
  B.addVia(b, [2, 2], 0.8, 0.4, n); // second stitching via
  assert.strictEqual(airwireCount(b), 0, 'both vias bridge the B.Cu pads into the pour');
}

// ---- 4. track crossing the outline edge joins the pour cluster ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'GND');
  mkFp(b, 'R1', [mkPad(5, 5, { netId: n })]);   // inside the pour
  mkFp(b, 'R2', [mkPad(20, 5, { netId: n })]);  // far outside
  B.addZone(b, { net: 'GND', layer: 'F.Cu', outline: square(0, 0, 10) });
  assert.strictEqual(airwireCount(b), 1, 'R1 rides the pour; R2 keeps one airwire');
  // this track starts on R2 and enters the outline -> everything collapses
  B.addTrack(b, [20, 5], [7, 3], 0.5, 'F.Cu', n);
  assert.strictEqual(airwireCount(b), 0, 'track crossing the edge joins both ends via pour');

  // counter-case: track that never reaches the outline changes nothing
  const b2 = B.makeBoard();
  const n2 = B.addNet(b2, 'GND');
  mkFp(b2, 'R1', [mkPad(5, 5, { netId: n2 })]);
  mkFp(b2, 'R2', [mkPad(20, 5, { netId: n2 })]);
  B.addZone(b2, { net: 'GND', layer: 'F.Cu', outline: square(0, 0, 10) });
  B.addTrack(b2, [12, -5], [12, 15], 0.5, 'F.Cu', n2); // right of x=10, no touch
  assert.strictEqual(airwireCount(b2), 2, 'near-miss track does not join; floats as own island');
}

// ---- 5. pad outside but within reach of the edge still counts; far pad does not ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'GND');
  mkFp(b, 'R1', [mkPad(-0.8, 5, { netId: n })]);  // r=1 circle overlapping x=0 edge
  mkFp(b, 'R2', [mkPad(-3.5, 5, { netId: n })]);  // fully clear of pour and of R1
  B.addZone(b, { net: 'GND', layer: 'F.Cu', outline: square(0, 0, 10) });
  assert.strictEqual(airwireCount(b), 1, 'edge-touching pad joins; distant one keeps an airwire');
}

// ---- 6. DRC unconnected-items check honours zone connectivity ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'GND');
  mkFp(b, 'R1', [mkPad(2, 2, { netId: n }), mkPad(8, 2, { netId: n })]);
  let drc = B.runDRC(b).filter(v => v.type === 'unconnected');
  assert.strictEqual(drc.length, 1, 'baseline: one unconnected error');
  B.addZone(b, { net: 'GND', layer: 'F.Cu', outline: square(0, 0, 10) });
  drc = B.runDRC(b).filter(v => v.type === 'unconnected');
  assert.strictEqual(drc.length, 0, 'pour joins the net -> check passes');
}

// ---- 7. zones of other nets / degenerate outlines are ignored ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'GND');
  mkFp(b, 'R1', [mkPad(2, 2, { netId: n }), mkPad(8, 2, { netId: n })]);
  B.addZone(b, { net: 'VCC', layer: 'F.Cu', outline: square(0, 0, 10) });
  B.addZone(b, { net: 'GND', layer: 'F.Cu', outline: [{ x: 1, y: 1 }] }); // <3 points
  assert.strictEqual(airwireCount(b), 1, 'foreign/degenerate pours change nothing');
  // a same-net pour on the far side still needs its own stitch connection
  B.addZone(b, { net: 'GND', layer: 'B.Cu', outline: square(0, 0, 10) });
  assert.strictEqual(airwireCount(b), 2, 'unreachable B.Cu pour attracts a stitching airwire');
}

console.log('test_ratsnest_zones: all checks passed');
