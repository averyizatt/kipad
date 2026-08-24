'use strict';
const assert = require('assert');
const Viewer = require('../js/gerber_viewer.js');
const Gerber = require('../js/gerber.js');

const board = {
  footprints: [{ layer: 'F.Cu', pads: [{ type: 'smd', shape: 'rect', size: [1, 2], at: [10, 20], layers: ['F.Cu'] }] }],
  tracks: [{ layer: 'F.Cu', width: 0.25, start: [10, 20], end: [12.5, 20] }],
  vias: [{ size: 0.8, drill: 0.4, at: [12.5, 20] }], outline: []
};
const image = Viewer.parse(Gerber.exportLayer(board, 'F.Cu'));
assert.strictEqual(image.units, 'mm');
assert.strictEqual(image.ops.filter(x => x.kind === 'flash').length, 2);
assert.strictEqual(image.ops.filter(x => x.kind === 'line').length, 1);
assert.deepStrictEqual(image.ops[0].aperture, { shape: 'R', w: 1, h: 2 });
assert.strictEqual(image.ops[0].x, 10);
assert.strictEqual(image.ops[0].y, 20);
assert.strictEqual(image.ops[1].x1, 10);
assert.strictEqual(image.ops[1].x2, 12.5);
assert.ok(image.bounds.x0 < 10 && image.bounds.x1 > 12.5);

const inch = Viewer.parse('%FSLAX24Y24*%\n%MOIN*%\n%ADD10C,0.010*%\nD10*\nX010000Y020000D03*\nM02*');
assert.strictEqual(inch.units, 'in');
assert.ok(Math.abs(inch.ops[0].x - 25.4) < 1e-9);
assert.ok(Math.abs(inch.ops[0].aperture.w - 0.254) < 1e-9);

const modal = Viewer.parse('%FSLAX44Y44*%\n%MOMM*%\n%ADD10C,0.2*%\nD10*\nX10000Y20000D02*\nX20000D01*\nY30000D01*\nM02*');
assert.deepStrictEqual(modal.ops.map(o => [o.x1, o.y1, o.x2, o.y2]), [[1, 2, 2, 2], [2, 2, 2, 3]]);

const region = Viewer.parse('%FSLAX44Y44*%\n%MOMM*%\nG36*\nX0Y0D02*\nX10000Y0D01*\nX10000Y10000D01*\nX0Y10000D01*\nG37*\nM02*');
assert.strictEqual(region.ops[0].kind, 'region');
assert.deepStrictEqual(region.ops[0].points, [[0, 0], [1, 0], [1, 1], [0, 1]]);
assert.deepStrictEqual(region.bounds, { x0: 0, y0: 0, x1: 1, y1: 1 });

console.log('test_gerber_viewer: 17 checks passed');
