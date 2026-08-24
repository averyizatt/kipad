'use strict';

/**
 * test_editors.js — Symbol/Footprint library editor support:
 *  (a) serializeKicadSym -> parseKicadSym round-trip (props, pins, graphics)
 *  (b) serializeKicadSym output re-serializes stably (serialize∘parse == identity on fields)
 *  (c) serializeKicadMod -> parseKicadMod round-trip (name/desc/pads/silk/courtyard)
 */

const assert = require('assert');
const KipadKicadSym = require('../js/kicad_sym.js');
const KipadKicadMod = require('../js/kicad_mod.js');

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  PASS  ${name}`);
}

// ------------------------------------------------------------------
// (a) symbol round trip
// ------------------------------------------------------------------
console.log('(a) serializeKicadSym round trip');

const sym = {
  name: 'TEST_R_2P', ref: 'R', value: '10k', desc: 'a test resistor', footprint: 'R_0603_1608Metric',
  pins: [
    { number: '1', name: '~', type: 'passive', at: [-5.08, 0], angle: 180, length: 2.54 },
    { number: '2', name: 'OUT', type: 'output', at: [5.08, 0], angle: 0, length: 3 },
    { number: '3', name: 'VCC', type: 'power_in', at: [0, 6.35], angle: 270, length: 2.54 }
  ],
  graphics: [
    { type: 'rect', start: [-5.08, -3.81], end: [5.08, 3.81] },
    { type: 'circle', center: [0, -6.35], r: 1 },
    { type: 'polyline', pts: [[0, 0], [1.27, 1.27], [2.54, 0]] }
  ]
};

const symText = KipadKicadSym.serializeKicadSym(sym);
assert.ok(symText.startsWith('(kicad_symbol_lib'), 'output is a kicad_symbol_lib');

const back = KipadKicadSym.parseKicadSym(symText)[0];
assert.ok(back, 're-parses to one symbol');
assert.strictEqual(back.name, 'TEST_R_2P', 'name round trips');
assert.strictEqual(back.ref, 'R', 'ref property round trips');
assert.strictEqual(back.value, '10k', 'value property round trips');
assert.strictEqual(back.desc, 'a test resistor', 'description round trips');
assert.strictEqual(back.footprint, 'R_0603_1608Metric', 'footprint assignment round trips');
ok('symbol properties round trip');

assert.strictEqual(back.pins.length, 3, 'pin count preserved');
for (let i = 0; i < 3; i++) {
  const a = sym.pins[i], b = back.pins[i];
  assert.strictEqual(b.number, a.number, `pin ${i} number`);
  assert.strictEqual(b.name, a.name, `pin ${i} name`);
  assert.strictEqual(b.type, a.type, `pin ${i} electrical type`);
  assert.deepStrictEqual(b.at, a.at, `pin ${i} position`);
  assert.strictEqual(b.angle, a.angle, `pin ${i} angle`);
  assert.strictEqual(b.length, a.length, `pin ${i} length`);
}
ok('all pin fields round trip exactly');

const gRect = back.graphics.find(g => g.type === 'rect');
assert.ok(gRect, 'rect graphic survives');
assert.deepStrictEqual(gRect.start, [-5.08, -3.81], 'rect start');
assert.deepStrictEqual(gRect.end, [5.08, 3.81], 'rect end');
const gCircle = back.graphics.find(g => g.type === 'circle');
assert.ok(gCircle && Math.abs(gCircle.r - 1) < 1e-9, 'circle radius survives');
const gPoly = back.graphics.find(g => g.type === 'polyline');
assert.ok(gPoly && gPoly.pts.length === 3 && gPoly.pts[2][0] === 2.54, 'polyline points survive');
ok('graphics round trip');

// ------------------------------------------------------------------
// (b) serializer stability through a second cycle
// ------------------------------------------------------------------
console.log('(b) serialize stability');

const symText2 = KipadKicadSym.serializeKicadSym(back);
const back2 = KipadKicadSym.parseKicadSym(symText2)[0];
assert.deepStrictEqual(
  { name: back2.name, ref: back2.ref, value: back2.value, desc: back2.desc,
    footprint: back2.footprint, pins: back2.pins, graphics: back2.graphics },
  { name: back.name, ref: back.ref, value: back.value, desc: back.desc,
    footprint: back.footprint, pins: back.pins, graphics: back.graphics },
  'second serialize->parse cycle is field-identical'
);
ok('serialize(parse(serialize(x))) stable');

// empty symbol edge case
const emptyText = KipadKicadSym.serializeKicadSym({ name: 'EMPTY_SYM' });
const emptyBack = KipadKicadSym.parseKicadSym(emptyText)[0];
assert.ok(emptyBack && emptyBack.name === 'EMPTY_SYM' && emptyBack.pins.length === 0, 'pin-less symbol serializes and parses');
ok('empty symbol edge case');

// ------------------------------------------------------------------
// (c) footprint round trip
// ------------------------------------------------------------------
console.log('(c) serializeKicadMod round trip');

const fp = {
  name: 'TEST_FP_1x02_P1.27mm', desc: 'test footprint',
  courtyard: { min: [-2.55, -1.6], max: [2.55, 1.6] },
  silk: [
    { type: 'line', pts: [[-2.05, -1.1], [-2.05, 1.1]] },
    { type: 'circle', at: [0, 0], r: 0.3 }
  ],
  pads: [
    { number: '1', type: 'smd', shape: 'rect', at: [-0.635, 0], size: [1, 0.7],
      layers: ['F.Cu', 'F.Paste', 'F.Mask'] },
    { number: '2', type: 'tht', shape: 'circle', at: [1.27, 0], size: [2, 2], drill: 1,
      layers: ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask'] }
  ]
};

const fpText = KipadKicadMod.serializeKicadMod(fp);
const fpBack = KipadKicadMod.parseKicadMod(fpText);
assert.ok(fpBack, 're-parses to one footprint');
assert.strictEqual(fpBack.name, fp.name, 'name round trips');
assert.strictEqual(fpBack.desc, fp.desc, 'descr round trips');
ok('footprint header round trip');

assert.strictEqual(fpBack.pads.length, 2, 'pad count');
const p1 = fpBack.pads[0];
assert.strictEqual(p1.number, '1');
assert.strictEqual(p1.type, 'smd');
assert.strictEqual(p1.shape, 'rect');
assert.deepStrictEqual(p1.at, [-0.635, 0]);
assert.deepStrictEqual(p1.size, [1, 0.7]);
for (const l of ['F.Cu', 'F.Paste', 'F.Mask']) assert.ok(p1.layers.indexOf(l) !== -1, 'smd layer ' + l);
const p2 = fpBack.pads[1];
assert.strictEqual(p2.type, 'tht', 'thru_hole maps back to tht');
assert.strictEqual(p2.drill, 1, 'drill round trips');
for (const l of ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask']) assert.ok(p2.layers.indexOf(l) !== -1, 'tht layer ' + l);
ok('pads round trip (types, geometry, layers, drill)');

const circ = fpBack.silk.find(s => s.type === 'circle');
assert.ok(circ && Math.abs(circ.r - 0.3) < 1e-6, 'silk circle survives');
const lines = fpBack.silk.filter(s => s.type === 'line');
assert.ok(lines.length >= 1, 'silk line survives');
assert.ok(Math.abs(lines[0].pts[0][0] - (-2.05)) < 1e-6, 'silk line coords');
ok('silkscreen primitives round trip');

const cy = fpBack.courtyard;
assert.ok(cy, 'courtyard present');
assert.ok(Math.abs(cy.min[0] - (-2.55)) < 1e-6 && Math.abs(cy.max[0] - 2.55) < 1e-6, 'courtyard X exact from CrtYd lines');
assert.ok(Math.abs(cy.min[1] - (-1.6)) < 1e-6 && Math.abs(cy.max[1] - 1.6) < 1e-6, 'courtyard Y exact from CrtYd lines');
ok('courtyard round trips exactly via F.CrtYd outline');

// oblong pad shape mapping + npth
const fpText2 = KipadKicadMod.serializeKicadMod({
  name: 'TEST_FP_NP',
  pads: [{ number: '', type: 'npth', shape: 'obround', at: [0, 0], size: [2, 3], drill: 2 }]
});
const fp2 = KipadKicadMod.parseKicadMod(fpText2);
assert.strictEqual(fp2.pads[0].type, 'npth', 'np_thru_hole maps back to npth');
assert.strictEqual(fp2.pads[0].shape, 'obround', 'oval maps back to obround');
assert.strictEqual(fp2.pads[0].drill, 2, 'npth drill kept');
ok('oval/npth mappings');

console.log(`\n${passed} checks passed`);
