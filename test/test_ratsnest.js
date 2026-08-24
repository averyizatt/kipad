'use strict';

/**
 * Kipad connectivity-aware ratsnest + unconnected-items DRC tests.
 * Run: node test/test_ratsnest.js
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
// pad centres 6mm apart on a row
function twoPadFp(b, ref, x0, y, netId) {
  return mkFp(b, ref, [
    mkPad(x0, y, { netId }),
    mkPad(x0 + 6, y, { netId, number: '2' })
  ]);
}
function airwireCount(board) { return B.ratsnest(board).length; }

// ---- 1. unrouted net: MST over all pads (old baseline still holds) ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  mkFp(b, 'U1', [mkPad(0, 0, { netId: n }), mkPad(6, 0, { netId: n }), mkPad(12, 0, { netId: n })]);
  assert.strictEqual(airwireCount(b), 2, '3 unrouted pads -> 2 airwires');
  const ls = B.ratsnest(b);
  assert.ok(ls.every(l => l.netId === n), 'airwires carry their netId');
}

// ---- 2. partially routed: routed pair collapses, stray pad still wired ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  twoPadFp(b, 'R1', 0, 0, n);          // pads at (0,0) and (6,0)
  mkFp(b, 'C1', [mkPad(30, 40, { netId: n })]);
  B.addTrack(b, [0, 0], [6, 0], 0.5, 'F.Cu', n); // butt-joins both pads
  assert.strictEqual(airwireCount(b), 1, 'routed pair collapses to one cluster');
  const l = B.ratsnest(b)[0];
  assert.strictEqual(l.netId, n);
  // one endpoint must be C1's pad; the other lands in the routed cluster
  const atC = Math.hypot(l.a[0] - 30, l.a[1] - 40) < 0.01 ||
              Math.hypot(l.b[0] - 30, l.b[1] - 40) < 0.01;
  assert.ok(atC, 'airwire reaches the unrouted pad');
}

// ---- 3. fully routed chain: zero airwires ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  twoPadFp(b, 'R1', 0, 0, n);
  B.addTrack(b, [0, 0], [6, 0], 0.5, 'F.Cu', n);
  assert.strictEqual(airwireCount(b), 0, 'butt-joined chain is routed');
}

// ---- 4. layer bridge through a via ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  twoPadFp(b, 'R1', 0, 0, n);
  mkFp(b, 'X1', [mkPad(20, 0, { netId: n, layers: ['B.Cu'] })]);
  B.addTrack(b, [0, 0], [6, 0], 0.5, 'F.Cu', n);   // R1 pair
  B.addTrack(b, [6, 0], [10, 0], 0.5, 'F.Cu', n);  // F.Cu stub toward X1
  B.addVia(b, [10, 0], 0.8, 0.4, n);                // layer bridge
  B.addTrack(b, [10, 0], [20, 0], 0.5, 'B.Cu', n);  // B.Cu run to X1.1
  assert.strictEqual(airwireCount(b), 0, 'via bridges F.Cu and B.Cu copper');
}

// ---- 4b. same geometry without the via stays unrouted ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  twoPadFp(b, 'R1', 0, 0, n);
  mkFp(b, 'X1', [mkPad(20, 0, { netId: n, layers: ['B.Cu'] })]);
  B.addTrack(b, [0, 0], [6, 0], 0.5, 'F.Cu', n);
  B.addTrack(b, [6, 0], [10, 0], 0.5, 'F.Cu', n);
  B.addTrack(b, [10, 0], [20, 0], 0.5, 'B.Cu', n);
  assert.strictEqual(airwireCount(b), 1, 'tracks on opposite layers do not touch');
}

// ---- 5. T-junction connects a mid-segment branch ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  twoPadFp(b, 'R1', 0, 0, n);
  mkFp(b, 'C1', [mkPad(3, 10, { netId: n })]);
  B.addTrack(b, [0, 0], [6, 0], 0.5, 'F.Cu', n);   // bus between R1 pads
  B.addTrack(b, [3, 0], [3, 10], 0.5, 'F.Cu', n);  // T-drop to C1.1
  assert.strictEqual(airwireCount(b), 0, 'T-junction counts as connected');
}

// ---- 6. different nets never merge into one cluster ----
{
  const b = B.makeBoard();
  const na = B.addNet(b, 'A'), nb = B.addNet(b, 'B');
  twoPadFp(b, 'R1', 0, 0, na);
  twoPadFp(b, 'R2', 0, 2, nb);                       // parallel, touching-ish tracks
  B.addTrack(b, [0, 0], [6, 0], 0.25, 'F.Cu', na);
  B.addTrack(b, [0, 2], [6, 2], 0.25, 'F.Cu', nb);
  const ls = B.ratsnest(b);
  assert.deepStrictEqual(ls.map(l => l.netId).sort(), [], 'both nets fully routed');
  // now cut net A's track: only A shows an airwire
  b.tracks.length = 0;
  B.addTrack(b, [0, 0], [6, 0], 0.25, 'F.Cu', na);
  B.addTrack(b, [0, 2], [6, 2], 0.25, 'F.Cu', nb);
  assert.strictEqual(airwireCount(b), 0, '0.25 wide track over 1mm pads still touches both pads');
  b.tracks[0].start = [2, 0]; // detach from R1.1 (pad half-size 1mm + eps)
  assert.strictEqual(airwireCount(b), 1, 'detached end re-opens one connection');
  assert.strictEqual(B.ratsnest(b)[0].netId, na, 'and it belongs to net A only');
}

// ---- 7. arc tracks connect like segments ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  twoPadFp(b, 'R1', 0, 0, n);
  const t = B.addTrack(b, [0, 0], [6, 0], 0.5, 'F.Cu', n);
  t.kind = 'arc'; t.mid = [3, -3];
  assert.strictEqual(airwireCount(b), 0, 'arc between the two pads routes them');

  const b2 = B.makeBoard();
  const n2 = B.addNet(b2, 'A');
  twoPadFp(b2, 'R1', 0, 0, n2);
  const t2 = B.addTrack(b2, [0, 0], [4.5, 0], 0.5, 'F.Cu', n2);
  t2.kind = 'arc'; t2.mid = [3, -3]; // stops 1.5mm short of R1.2's pad edge
  assert.strictEqual(airwireCount(b2), 1, 'short arc leaves one airwire');
}

// ---- 8. single-pad / no-net boards stay silent ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  mkFp(b, 'TP1', [mkPad(0, 0, { netId: n })]);
  assert.strictEqual(airwireCount(b), 0, 'one-pad net needs nothing');
  mkFp(b, 'TP2', [mkPad(50, 50)]); // netId 0
  assert.strictEqual(airwireCount(b), 0, 'netId 0 pads ignored');
}

// ---- 9. DRC reports unconnected items with labels ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'GND');
  twoPadFp(b, 'R1', 0, 0, n);
  mkFp(b, 'C3', [mkPad(30, 40, { netId: n, number: '1' })]);
  const vs = B.runDRC(b).filter(v => v.type === 'unconnected');
  assert.strictEqual(vs.length, 2, 'three isolated pads -> two unconnected violations');
  assert.ok(vs.every(v => v.severity === 'error'), 'unconnected is an error like KiCad');
  assert.ok(vs.every(v => v.msg.includes('GND')), 'messages name the net');
  const allMsg = vs.map(v => v.msg).join(' | ');
  assert.ok(allMsg.includes('R1.') && allMsg.includes('C3.1'), 'messages name the pads: ' + allMsg);
  assert.ok(vs.every(v => typeof v.x === 'number' && typeof v.y === 'number'), 'violations locatable');

  B.addTrack(b, [30, 40], [6, 0], 0.5, 'F.Cu', n);
  assert.strictEqual(B.runDRC(b).filter(v => v.type === 'unconnected').length, 1,
    'R1 pair itself is still unrouted');
  B.addTrack(b, [0, 0], [6, 0], 0.5, 'F.Cu', n);
  assert.strictEqual(B.runDRC(b).filter(v => v.type === 'unconnected').length, 0,
    'fully routed board passes the check');
}

// ---- 10. clearance violations now carry a msg for the panel ----
{
  const b = B.makeBoard();
  const na = B.addNet(b, 'A'), nb = B.addNet(b, 'B');
  B.addTrack(b, [0, 0], [5, 0], 0.25, 'F.Cu', na);
  B.addTrack(b, [0, 0.2], [5, 0.2], 0.25, 'F.Cu', nb);
  const tt = B.runDRC(b).find(v => v.type === 'track-track');
  assert.ok(tt && typeof tt.msg === 'string' && tt.msg.includes('clearance'),
    'clearance violation has a readable msg');
}

// ---- 11. determinism ----
{
  const b = B.makeBoard();
  const n = B.addNet(b, 'A');
  mkFp(b, 'U1', [mkPad(0, 0, { netId: n }), mkPad(10, 3, { netId: n }),
    mkPad(4, 9, { netId: n }), mkPad(-6, 5, { netId: n })]);
  const r1 = JSON.stringify(B.ratsnest(b));
  const r2 = JSON.stringify(B.ratsnest(b));
  assert.strictEqual(r1, r2, 'same board -> identical airwire set');
}

console.log('test_ratsnest: all checks passed');
