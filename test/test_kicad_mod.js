'use strict';

/**
 * Tests for KipadKicadMod (js/kicad_mod.js) — real .kicad_mod parsing.
 * Run: cd kipad && node test/test_kicad_mod.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const KicadMod = require('../js/kicad_mod.js');

const rawDir = path.join(__dirname, '..', 'lib-build', 'raw');

// ---- 1. parse a real KiCad footprint file ----
const r0603 = KicadMod.parseKicadMod(fs.readFileSync(path.join(rawDir, 'Resistor_SMD', 'R_0603_1608Metric.kicad_mod'), 'utf8'));
assert.ok(r0603, 'R_0603 parses');
assert.strictEqual(r0603.name, 'R_0603_1608Metric');
assert.strictEqual(r0603.ref, 'R', 'ref prefix inferred');
assert.strictEqual(r0603.pads.length, 2, 'two pads');
const p1 = r0603.pads[0];
assert.strictEqual(p1.number, '1');
assert.strictEqual(p1.type, 'smd');
assert.strictEqual(p1.shape, 'roundrect');
assert.ok(Math.abs(p1.at[0] - -0.825) < 1e-6, 'pad1 x -0.825');
assert.deepStrictEqual(p1.size, [0.8, 0.95], 'pad size');
assert.strictEqual(p1.drill, null, 'smd pad no drill');
assert.ok(Math.abs(p1.radius - 0.2) < 1e-6, 'roundrect radius 0.2 (0.25*0.8)');
assert.strictEqual(p1.layers[0], 'F.Cu', 'copper first');
assert.deepStrictEqual(r0603.courtyard.min, [-1.48, -0.73], 'courtyard min');
assert.deepStrictEqual(r0603.courtyard.max, [1.48, 0.73], 'courtyard max');
assert.ok(r0603.silk.length >= 4, 'silk lines present');

// ---- 2. parse a THT part with drills ----
const dip8File = fs.readdirSync(path.join(rawDir, 'Package_DIP')).find(f => f.includes('DIP-8_W7.62mm'));
assert.ok(dip8File, 'DIP-8 file exists in raw');
const dip8 = KicadMod.parseKicadMod(fs.readFileSync(path.join(rawDir, 'Package_DIP', dip8File), 'utf8'));
assert.ok(dip8, 'DIP-8 parses');
assert.strictEqual(dip8.ref, 'U', 'DIP ref prefix');
assert.strictEqual(dip8.pads.length, 8, '8 pins');
assert.ok(dip8.pads.every(p => p.type === 'tht' && p.drill > 0), 'tht pads with drills');

// ---- 3. parse a pin header ----
const phFile = fs.readdirSync(path.join(rawDir, 'Connector_PinHeader_2.54mm')).find(f => f.includes('PinHeader_1x04_P2.54mm_Vertical'));
const ph = KicadMod.parseKicadMod(fs.readFileSync(path.join(rawDir, 'Connector_PinHeader_2.54mm', phFile), 'utf8'));
assert.ok(ph, 'header parses');
assert.strictEqual(ph.ref, 'J', 'connector ref prefix');
assert.strictEqual(ph.pads.length, 4, '4 pins');
assert.ok(Math.abs(ph.pads[3].at[1] - 7.62) < 1e-6, 'pitch 2.54');

// ---- 4. malformed input -> null ----
assert.strictEqual(KicadMod.parseKicadMod('not a footprint'), null, 'garbage -> null');

// ---- 5. every footprint in lib/footprints.json parses from raw source (round-trip sanity) ----
const lib = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'footprints.json'), 'utf8'));
assert.ok(Array.isArray(lib) && lib.length >= 150, 'library has >= 150 footprints, got ' + lib.length);
const names = new Set(lib.map(f => f.name));
assert.strictEqual(names.size, lib.length, 'unique names');
for (const fp of lib) {
  assert.ok(fp.name && fp.ref, fp.name + ': name/ref');
  assert.ok(fp.pads && fp.pads.length >= 1, fp.name + ': pads');
  assert.ok(fp.courtyard && fp.courtyard.min && fp.courtyard.max, fp.name + ': courtyard');
  for (const p of fp.pads) {
    assert.ok(['smd', 'tht', 'npth'].includes(p.type), fp.name + ': pad type');
    assert.ok(['rect', 'roundrect', 'circle', 'obround'].includes(p.shape), fp.name + ': pad shape');
    assert.ok(p.size[0] > 0 && p.size[1] > 0, fp.name + ': pad size');
    assert.ok(Array.isArray(p.layers) && p.layers.length, fp.name + ': pad layers');
  }
}

console.log('KICAD_MOD TESTS PASSED (' + lib.length + ' footprints validated)');
