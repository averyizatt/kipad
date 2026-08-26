'use strict';

/**
 * Supplementary tests for KipadKicadMod (js/kicad_mod.js):
 *  - strict schema validation of every entry in lib/footprints.json
 *    (full (c) integrity checks: copper layer first, drill/radius types,
 *    silk item validity, courtyard ordering, sorted unique names)
 *  - KiCad 7/8 `(footprint "NAME" ...)` quoted-format support (d)
 *  - R_0603 deep checks against the already-downloaded file
 *  - arc sampling: angle-form fp_arc -> 25-point polyline
 *
 * Run: cd kipad && node test/test_kicad_mod_extra.js
 * (Companion to test/test_kicad_mod.js which covers (a)/(b)/(c)-light.)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const KipadKicadMod = require('../js/kicad_mod.js');

const ROOT = path.join(__dirname, '..');

// ------------------------------------------------------------------
// (a-extra) R_0603 deep checks (task-specified file path)
// ------------------------------------------------------------------
{
  const text = fs.readFileSync(path.join(ROOT, 'lib-build', 'raw', 'Resistor_SMD', 'R_0603_1608Metric.kicad_mod'), 'utf8');
  const fp = KipadKicadMod.parseKicadMod(text);
  assert.ok(fp, 'R_0603: parse');
  assert.strictEqual(fp.name, 'R_0603_1608Metric');
  assert.strictEqual(fp.ref, 'R');
  assert.strictEqual(fp.pads.length, 2);
  for (const p of fp.pads) {
    assert.strictEqual(p.type, 'smd');
    assert.strictEqual(p.shape, 'roundrect');
    assert.deepStrictEqual(p.size, [0.8, 0.95]);
    assert.ok(Math.abs(p.radius - 0.2) < 1e-9, 'radius 0.2');
    assert.strictEqual(p.drill, null);
    assert.strictEqual(p.layers[0], 'F.Cu');
  }
  assert.strictEqual(fp.pads[0].at[0], -0.825);
  assert.strictEqual(fp.pads[1].at[0], 0.825);
  assert.deepStrictEqual(fp.courtyard.min, [-1.48, -0.73]);
  assert.deepStrictEqual(fp.courtyard.max, [1.48, 0.73]);
  const lineItems = fp.silk.filter(s => s.type === 'line');
  assert.ok(lineItems.length >= 4, 'silk >= 4 line items, got ' + lineItems.length);
}

// ------------------------------------------------------------------
// (c-strict) lib/footprints.json schema validation
// ------------------------------------------------------------------
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'footprints.json'), 'utf8'));
assert.ok(Array.isArray(lib), 'lib is array');
assert.ok(lib.length >= 150, '>= 150 footprints, got ' + lib.length);
const names = lib.map(f => f.name);
assert.strictEqual(new Set(names).size, names.length, 'unique names');
assert.deepStrictEqual(names, [...names].sort(), 'sorted by name');

for (const f of lib) {
  assert.ok(f && typeof f === 'object', 'fp object');
  assert.strictEqual(typeof f.name, 'string', f.name + ': name string');
  assert.ok(f.name.length > 0, 'fp name non-empty');
  assert.strictEqual(typeof f.ref, 'string', f.name + ': ref string');
  assert.ok(f.ref.length > 0, f.name + ': ref non-empty');
  assert.strictEqual(typeof f.value, 'string', f.name + ': value string');

  assert.ok(f.courtyard && typeof f.courtyard === 'object', f.name + ': courtyard');
  assert.ok(Array.isArray(f.courtyard.min) && f.courtyard.min.length === 2, f.name + ': courtyard.min');
  assert.ok(Array.isArray(f.courtyard.max) && f.courtyard.max.length === 2, f.name + ': courtyard.max');
  for (const v of f.courtyard.min.concat(f.courtyard.max)) {
    assert.strictEqual(typeof v, 'number', f.name + ': courtyard number');
    assert.ok(isFinite(v), f.name + ': courtyard finite');
  }
  assert.ok(f.courtyard.min[0] < f.courtyard.max[0], f.name + ': crd min.x < max.x');
  assert.ok(f.courtyard.min[1] < f.courtyard.max[1], f.name + ': crd min.y < max.y');

  assert.ok(Array.isArray(f.pads) && f.pads.length > 0, f.name + ': pads non-empty');
  for (const p of f.pads) {
    assert.strictEqual(typeof p.number, 'string', f.name + ': pad number string');
    assert.ok(['smd', 'tht', 'npth'].indexOf(p.type) !== -1, f.name + ': pad type');
    assert.ok(['rect', 'roundrect', 'circle', 'obround'].indexOf(p.shape) !== -1, f.name + ': pad shape');
    assert.ok(Array.isArray(p.at) && p.at.length === 2, f.name + ': pad at');
    assert.ok(Array.isArray(p.size) && p.size.length === 2, f.name + ': pad size');
    for (const v of p.at.concat(p.size)) {
      assert.strictEqual(typeof v, 'number', f.name + ': pad number');
      assert.ok(isFinite(v), f.name + ': pad finite');
    }
    assert.ok(p.size[0] > 0 && p.size[1] > 0, f.name + ': pad size positive');
    assert.ok(Array.isArray(p.layers) && p.layers.length >= 1, f.name + ': pad layers');
    assert.ok(p.layers[0] === 'F.Cu' || p.layers[0] === 'B.Cu', f.name + ': copper first, got ' + p.layers[0]);
    assert.ok(p.drill === null || (typeof p.drill === 'number' && p.drill > 0), f.name + ': drill');
    assert.ok(p.radius === null || (typeof p.radius === 'number' && p.radius > 0), f.name + ': radius');
  }

  assert.ok(Array.isArray(f.silk), f.name + ': silk array');
  for (const s of f.silk) {
    assert.ok(['line', 'circle', 'text'].indexOf(s.type) !== -1, f.name + ': silk type');
    if (s.type === 'line') {
      assert.ok(Array.isArray(s.pts) && s.pts.length >= 2, f.name + ': silk line pts');
      for (const pt of s.pts) {
        assert.ok(Array.isArray(pt) && pt.length === 2, f.name + ': silk pt');
        assert.strictEqual(typeof pt[0], 'number', f.name + ': silk pt x');
        assert.strictEqual(typeof pt[1], 'number', f.name + ': silk pt y');
      }
    } else if (s.type === 'circle') {
      assert.ok(Array.isArray(s.at) && s.at.length === 2, f.name + ': silk circle at');
      assert.strictEqual(typeof s.r, 'number', f.name + ': silk circle r');
      assert.ok(s.r > 0, f.name + ': silk circle r > 0');
    } else {
      assert.ok(Array.isArray(s.at) && s.at.length === 2, f.name + ': silk text at');
      assert.strictEqual(typeof s.text, 'string', f.name + ': silk text');
      assert.strictEqual(typeof s.size, 'number', f.name + ': silk text size');
      assert.ok(s.size > 0, f.name + ': silk text size > 0');
    }
  }
}

// ------------------------------------------------------------------
// (d) KiCad 7/8 (footprint "NAME" ...) quoted format
// ------------------------------------------------------------------
const k7 = '(footprint "Test_K7_0805"\n' +
  '  (layer "F.Cu") (tedit 00000000)\n' +
  '  (descr "KiCad 7 format test footprint")\n' +
  '  (tags "resistor")\n' +
  '  (attr smd)\n' +
  '  (fp_text reference "${REFERENCE}" (at 0 -1.5) (layer "F.SilkS")\n' +
  '    (effects (font (size 1 1) (thickness 0.15))))\n' +
  '  (fp_text value "${VALUE}" (at 0 1.5) (layer "F.Fab")\n' +
  '    (effects (font (size 1 1) (thickness 0.15))))\n' +
  '  (fp_line (start -1 -0.5) (end 1 -0.5) (layer "F.SilkS") (width 0.12))\n' +
  '  (fp_line (start -1 0.5) (end 1 0.5) (layer "F.SilkS") (width 0.12))\n' +
  '  (fp_rect (start -1.5 -0.7) (end 1.5 0.7) (layer "F.CrtYd") (width 0.05))\n' +
  '  (pad "1" smd roundrect (at -0.8 0) (size 0.8 1) (layers "F.Cu" "F.Paste" "F.Mask")\n' +
  '    (roundrect_rratio 0.25))\n' +
  '  (pad "2" smd roundrect (at 0.8 0) (size 0.8 1) (layers "F.Cu" "F.Paste" "F.Mask")\n' +
  '    (roundrect_rratio 0.25))\n' +
  ')';
const fp7 = KipadKicadMod.parseKicadMod(k7);
assert.ok(fp7, 'K7: parse');
assert.strictEqual(fp7.name, 'Test_K7_0805', 'K7: quoted name');
assert.strictEqual(fp7.ref, 'R', 'K7: ref from descr');
assert.strictEqual(fp7.pads.length, 2, 'K7: pads');
assert.strictEqual(fp7.pads[0].number, '1', 'K7: quoted pad number');
assert.deepStrictEqual(fp7.pads[0].size, [0.8, 1], 'K7: pad size');
assert.deepStrictEqual(fp7.courtyard, { min: [-1.5, -0.7], max: [1.5, 0.7] }, 'K7: fp_rect courtyard');
assert.ok(fp7.silk.every(s => s.type === 'line'), 'K7: placeholders skipped');

// ------------------------------------------------------------------
// fp_arc angle form -> 25-point polyline (KiCad 7+ arc syntax)
// ------------------------------------------------------------------
{
  const t = '(module ARC_Test (layer F.Cu)\n' +
    '  (descr "arc")\n' +
    '  (tags "test")\n' +
    '  (fp_arc (start 3.81 -1.33) (end 2.81 -1.33) (angle -180) (layer F.SilkS) (width 0.12))\n' +
    '  (pad 1 thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8) (layers *.Cu *.Mask))\n' +
    ')';
  const a = KipadKicadMod.parseKicadMod(t);
  assert.ok(a, 'arc: parse');
  const arcs = a.silk.filter(s => s.type === 'line' && s.pts.length > 2);
  assert.strictEqual(arcs.length, 1, 'arc: one polyline item');
  assert.ok(arcs[0].pts.length >= 24, 'arc: 24+ points, got ' + arcs[0].pts.length);
  // DIP-8 notch semicircle: center (3.31,-1.33) r=0.5, must bulge outward
  // through (3.31,-1.83) and stay within the chord endpoints at the edges.
  const first = arcs[0].pts[0], last = arcs[0].pts[arcs[0].pts.length - 1];
  assert.ok(Math.abs(first[0] - 3.81) < 1e-6 && Math.abs(first[1] - (-1.33)) < 1e-6, 'arc: start pt');
  assert.ok(Math.abs(last[0] - 2.81) < 1e-6 && Math.abs(last[1] - (-1.33)) < 1e-6, 'arc: end pt');
  let minY = Infinity;
  for (const pt of arcs[0].pts) minY = Math.min(minY, pt[1]);
  assert.ok(minY < -1.33, 'arc: bulges outward (y < -1.33), minY=' + minY);
}

console.log('test_kicad_mod_extra: ALL PASS (' + lib.length + ' footprints, strict schema + K7 format + arc sampling)');
