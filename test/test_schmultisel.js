'use strict';
const assert = require('assert');
const M = require('../js/schmultisel.js');

function makeSch() {
  return {
    symbols: [{ id: 'S1', libId: 'R', at: [0, 0], angle: 0 }, { id: 'S2', libId: 'R', at: [10, 0], angle: 0 }],
    wires: [{ id: 'W1', pts: [[0, 2], [10, 2]] }],
    labels: [{ id: 'L1', text: 'BUS', at: [5, 2], angle: 0 }],
    junctions: [{ id: 'J1', at: [5, 2] }], noConnects: [{ id: 'N1', at: [0, -2] }]
  };
}
const getSymbol = () => ({ graphics: [{ type: 'rect', start: [-1, -1], end: [1, 1] }], pins: [{ at: [0, 2] }, { at: [0, -2] }] });
let sel = M.toggle([], 'S1', 'symbol');
assert(M.has(sel, 'S1') && !M.has(M.toggle(sel, 'S1', 'symbol'), 'S1'), 'toggle/has are immutable set operations');

{
  const sch = makeSch();
  const found = M.collectInRect(sch, { minX: -0.5, minY: -2.2, maxX: 0.5, maxY: -1.8 }, getSymbol);
  assert(M.has(found, 'S1'), 'symbol is selected when the box intersects a pin extent');
  assert(M.has(found, 'N1'), 'no-connect anchor is selected');
  assert(!M.has(found, 'S2'), 'distant symbol is excluded');
  assert(M.has(M.collectInRect(sch, { minX: 4, minY: 1.9, maxX: 6, maxY: 2.1 }, getSymbol), 'W1'), 'crossing wire is selected');
}
{
  const sch = makeSch();
  const all = M.collectInRect(sch, { minX: -20, minY: -20, maxX: 20, maxY: 20 }, getSymbol);
  assert.deepStrictEqual(all.map(x => x.id), ['S1', 'S2', 'W1', 'L1', 'J1', 'N1'], 'box collector returns every schematic kind in stable order');
  assert.deepStrictEqual(M.bounds(sch, all).center, [5, 0], 'group centre spans every member anchor/vertex');
  assert.strictEqual(M.moveItems(sch, all, 1, 3), 6, 'all six members move');
  assert.deepStrictEqual(sch.wires[0].pts, [[1, 5], [11, 5]], 'wire vertices move rigidly');
  assert.deepStrictEqual(sch.noConnects[0].at, [1, 1], 'no-connect moves with its connected group');
}
{
  const sch = makeSch(), group = [{ id: 'S1', kind: 'symbol' }, { id: 'S2', kind: 'symbol' }, { id: 'W1', kind: 'wire' }, { id: 'L1', kind: 'label' }];
  assert.strictEqual(M.rotateItems(sch, group, [5, 0], 90), 4, 'group rotation reports changed members');
  assert(Math.abs(sch.symbols[0].at[0] - 5) < 1e-9 && Math.abs(sch.symbols[0].at[1] + 5) < 1e-9, 'symbol orbits group centre');
  assert.strictEqual(sch.symbols[0].angle, 90, 'symbol orientation rotates');
  assert(Math.abs(sch.wires[0].pts[0][0] - 3) < 1e-9 && Math.abs(sch.wires[0].pts[0][1] + 5) < 1e-9, 'wire rotates as a rigid segment');
  assert.strictEqual(sch.labels[0].angle, 90, 'label orientation rotates');
}
{
  const sch = makeSch();
  assert.strictEqual(M.hitTest(sch, 5, 2.05, 0.1, getSymbol).kind, 'label', 'label wins over coincident wire');
  assert.strictEqual(M.hitTest(sch, 8, 2.05, 0.1, getSymbol).kind, 'wire', 'wire segment is hit away from anchors');
  const p = M.deletePlan(sch, [{ id: 'S1', kind: 'symbol' }, { id: 'W1', kind: 'wire' }, { id: 'N1', kind: 'noconn' }, { id: 'gone', kind: 'label' }]);
  assert.deepStrictEqual([p.symbols.length, p.wires.length, p.noConnects.length, p.labels.length], [1, 1, 1, 0], 'delete plan partitions live ids and drops stale ids');
}
console.log('SCHEMATIC MULTISELECT TESTS PASSED');
