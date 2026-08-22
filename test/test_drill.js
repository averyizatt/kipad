'use strict';

/**
 * Tests for the Kipad Excellon drill exporter (js/drill.js).
 * Run: cd kipad && node test/test_drill.js
 */

const assert = require('assert');
const Drill = require('../js/drill.js');

const board = {
  footprints: [
    {
      layer: 'F.Cu', pads: [
        { number: '1', type: 'tht', at: [0, 0], size: [1.6, 1.6], drill: 0.8 },
        { number: '2', type: 'tht', at: [2.54, 0], size: [1.6, 1.6], drill: 0.8 },
        { number: '3', type: 'smd', at: [5, 0], size: [1.0, 0.6], drill: null }
      ]
    }
  ],
  vias: [
    { at: [10, 10], size: 0.6, drill: 0.3 },
    { at: [12, 10], size: 0.6, drill: 0.3 }
  ]
};

// ---- 1. collectDrills dedupes sizes, skips SMD ----
const d = Drill.collectDrills(board);
assert.deepStrictEqual(d.sizes, [0.3, 0.8], 'two unique sizes, sorted');
assert.strictEqual(d.holes.length, 4, '4 holes (2 tht pads + 2 vias)');

// ---- 2. exportDrill structure ----
const text = Drill.exportDrill(board);
assert.ok(text.includes('M48'), 'header start');
assert.ok(text.includes('METRIC,TZ'), 'metric mode');
assert.ok(text.includes('FMAT,2'), 'Excellon 2');
assert.ok(text.includes('T1C0.3000'), 'tool 1 size');
assert.ok(text.includes('T2C0.8000'), 'tool 2 size');
assert.ok(text.includes('%'), 'header end');
assert.ok(text.includes('G90'), 'absolute mode');
assert.ok(text.includes('M30'), 'end of program');
assert.ok(text.includes('X0.0000Y0.0000'), 'first hole coords');

// ---- 3. holes are grouped by tool ----
const t1 = text.indexOf('T1');
const t2 = text.indexOf('T2');
assert.ok(t1 > 0 && t2 > t1, 'T1 appears before T2');

// ---- 4. empty board -> '' ----
const empty = Drill.exportDrill({ footprints: [], vias: [] });
assert.strictEqual(empty, '', 'no holes -> empty string');

console.log('DRILL TESTS PASSED');
