'use strict';

/**
 * Tests for the Kipad built-in footprint library.
 * Run: cd kipad && node test/test_footprints.js
 */

const assert = require('assert');
const KipadFootprints = require('../js/footprints.js');

const names = KipadFootprints.listFootprints();

// --- 1. library has at least the 11 required footprints ---
assert.ok(names.length >= 11, 'expected >= 11 footprints, got ' + names.length);

// names are unique
assert.strictEqual(new Set(names).size, names.length, 'footprint names must be unique');

// --- 2. structural validation of every footprint ---
for (const name of names) {
  const fp = KipadFootprints.getFootprint(name);
  assert.strictEqual(fp.name, name, name + ': name mismatch');
  assert.ok(fp.desc && fp.desc.length > 0, name + ': desc required');
  assert.ok(fp.ref && fp.ref.length > 0, name + ': ref prefix required');
  assert.strictEqual(fp.value, '', name + ': default value should be empty string');

  assert.ok(Array.isArray(fp.courtyard.min) && Array.isArray(fp.courtyard.max),
    name + ': courtyard must have min/max arrays');
  assert.ok(fp.courtyard.min[0] < fp.courtyard.max[0], name + ': courtyard min.x < max.x');
  assert.ok(fp.courtyard.min[1] < fp.courtyard.max[1], name + ': courtyard min.y < max.y');

  assert.ok(Array.isArray(fp.pads) && fp.pads.length >= 1, name + ': at least one pad');
  for (const pad of fp.pads) {
    assert.ok(String(pad.number).length > 0, name + ': pad number required');
    assert.ok(pad.type === 'smd' || pad.type === 'tht', name + ': pad type');
    assert.ok(['rect', 'circle', 'roundrect', 'obround'].indexOf(pad.shape) !== -1,
      name + ': pad shape');
    assert.ok(Array.isArray(pad.at) && pad.at.length === 2, name + ': pad at [x,y]');
    assert.ok(Array.isArray(pad.size) && pad.size.length === 2, name + ': pad size [w,h]');
    assert.ok(pad.size[0] > 0 && pad.size[1] > 0, name + ': pad size positive');
    assert.ok(Array.isArray(pad.layers) && pad.layers.length >= 1, name + ': pad layers');
    assert.strictEqual(pad.layers[0], 'F.Cu', name + ': copper layer must come first');
    if (pad.type === 'tht') {
      assert.ok(typeof pad.drill === 'number' && pad.drill > 0, name + ': tht pad needs drill');
      assert.strictEqual(pad.radius, null, name + ': tht pad has no roundrect radius');
    } else {
      assert.strictEqual(pad.drill, null, name + ': smd pad has no drill');
    }
  }

  assert.ok(Array.isArray(fp.silk), name + ': silk array required');
  for (const s of fp.silk) {
    assert.ok(s.type === 'line' || s.type === 'circle' || s.type === 'text',
      name + ': silk element type');
    if (s.type === 'line') {
      assert.ok(Array.isArray(s.pts) && s.pts.length === 2, name + ': silk line pts');
    } else if (s.type === 'circle') {
      assert.ok(s.r > 0, name + ': silk circle r');
    } else {
      assert.ok(typeof s.text === 'string' && s.size > 0, name + ': silk text');
    }
  }
}

// --- 3. R_0603 pads symmetric about origin, size correct ---
const r0603 = KipadFootprints.getFootprint('R_0603_1608Metric');
assert.strictEqual(r0603.pads.length, 2);
const p1 = r0603.pads[0];
const p2 = r0603.pads[1];
// KiCad IPC-7351 nominal: pad centers at +/-0.825 (1.65 mm between centers)
assert.strictEqual(p1.at[0], -0.825, 'R_0603 pad 1 x');
assert.strictEqual(p2.at[0], 0.825, 'R_0603 pad 2 x');
assert.strictEqual(Math.abs(p1.at[0]), Math.abs(p2.at[0]), 'R_0603 pads symmetric');
assert.strictEqual(p1.at[1], 0, 'R_0603 pad 1 y');
assert.strictEqual(p2.at[1], 0, 'R_0603 pad 2 y');
assert.deepStrictEqual(p1.size, [0.8, 0.95], 'R_0603 pad size');
assert.deepStrictEqual(p2.size, [0.8, 0.95], 'R_0603 pad size');
assert.strictEqual(p1.type, 'smd');
assert.strictEqual(p1.shape, 'roundrect');
assert.strictEqual(p1.radius, 0.2);
assert.strictEqual(p1.drill, null);
assert.strictEqual(p1.layers[0], 'F.Cu');
assert.strictEqual(r0603.ref, 'R');

// --- 4. getFootprint returns a deep copy ---
const mutated = KipadFootprints.getFootprint('R_0603_1608Metric');
mutated.name = 'HACKED';
mutated.ref = 'X';
mutated.pads[0].at[0] = 999;
mutated.pads[0].size[1] = -1;
mutated.silk[0].pts[0][0] = 999;
mutated.courtyard.min[0] = 0;
const clean = KipadFootprints.getFootprint('R_0603_1608Metric');
assert.strictEqual(clean.name, 'R_0603_1608Metric', 'library name unmutated');
assert.strictEqual(clean.ref, 'R', 'library ref unmutated');
assert.strictEqual(clean.pads[0].at[0], -0.825, 'library pad position unmutated');
assert.strictEqual(clean.pads[0].size[1], 0.95, 'library pad size unmutated');
assert.strictEqual(clean.silk[0].pts[0][0], r0603.silk[0].pts[0][0], 'library silk unmutated');
assert.deepStrictEqual(clean.courtyard.min, [-1.48, -0.73], 'library courtyard unmutated');

// --- spot checks on the remaining footprints ---
const sot23 = KipadFootprints.getFootprint('SOT-23');
assert.strictEqual(sot23.pads.length, 3);
assert.deepStrictEqual(sot23.pads[0].at, [-0.95, -0.95], 'SOT-23 pad 1');
assert.deepStrictEqual(sot23.pads[1].at, [0.95, -0.95], 'SOT-23 pad 2');
assert.deepStrictEqual(sot23.pads[2].at, [0, 0.95], 'SOT-23 pad 3 (top center)');
assert.deepStrictEqual(sot23.pads[0].size, [0.6, 1.0], 'SOT-23 pad size');

const soic8 = KipadFootprints.getFootprint('SOIC-8_3.9x4.9mm_P1.27mm');
assert.strictEqual(soic8.pads.length, 8);
assert.deepStrictEqual(soic8.pads[0].at, [-2.475, -1.905], 'SOIC-8 pad 1');
assert.deepStrictEqual(soic8.pads[7].at, [2.475, -1.905], 'SOIC-8 pad 8');
assert.ok(soic8.pads.every(p => p.type === 'smd' && p.radius === 0.15), 'SOIC-8 smd pads, r=0.15');

const dip8 = KipadFootprints.getFootprint('DIP-8_W7.62mm');
assert.strictEqual(dip8.pads.length, 8);
assert.ok(dip8.pads.every(p => p.type === 'tht' && p.drill === 0.8 && p.size[0] === 1.6),
  'DIP-8 tht pads, 1.6mm, drill 0.8');
assert.deepStrictEqual(dip8.pads[0].at, [-3.81, -3.81], 'DIP-8 pin 1');
assert.deepStrictEqual(dip8.pads[7].at, [3.81, -3.81], 'DIP-8 pin 8');

const ph1 = KipadFootprints.getFootprint('PinHeader_1x04_P2.54mm_Vertical');
assert.strictEqual(ph1.pads.length, 4);
assert.deepStrictEqual(ph1.pads.map(p => p.at[1]), [0, 2.54, 5.08, 7.62], '1x04 header pitch');
assert.ok(ph1.pads.every(p => p.type === 'tht' && p.drill === 1.0), '1x04 header pads');

const ph2 = KipadFootprints.getFootprint('PinHeader_2x04_P2.54mm_Vertical');
assert.strictEqual(ph2.pads.length, 8);
assert.deepStrictEqual(ph2.pads[0].at, [-1.27, 0], '2x04 pin 1');
assert.deepStrictEqual(ph2.pads[1].at, [1.27, 0], '2x04 pin 2');
assert.deepStrictEqual(ph2.pads[7].at, [1.27, 7.62], '2x04 pin 8');

const led = KipadFootprints.getFootprint('LED_0603_1608Metric');
assert.strictEqual(led.pads.length, 2);
assert.ok(led.pads[0].at[0] < 0, 'LED pad 1 (cathode) on the left');
assert.ok(led.silk.some(s => s.type === 'line' && s.pts[0][0] === -0.55 && s.pts[0][1] === -0.3),
  'LED cathode bar present on pad-1 side');

// unknown name -> null
assert.strictEqual(KipadFootprints.getFootprint('NO_SUCH_PART'), null, 'unknown name returns null');

console.log('PASS: ' + names.length + ' footprints, all tests OK.');
console.log('Footprints: ' + names.join(', '));
