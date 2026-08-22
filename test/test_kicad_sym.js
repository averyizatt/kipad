'use strict';

/**
 * test_kicad_sym.js — tests for the real KiCad symbol pipeline:
 *  (a) inline sample parse (js/kicad_sym.js)
 *  (b) lib/symbols.json integrity (schema + unique names)
 *  (c) spot checks: 'R' present with >= 2 pins, a power symbol present
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const KipadKicadSym = require('../js/kicad_sym.js');
const KipadSymbols = require('../js/symbols.js');

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  PASS  ${name}`);
}

// ------------------------------------------------------------------
// (a) inline sample parse
// ------------------------------------------------------------------
console.log('(a) inline sample parse');

const SAMPLE =
  '(kicad_symbol_lib (version 20220914) (generator "x") ' +
  '(symbol "R" ' +
  '  (property "Reference" "R" (at 0 2.54 0)) ' +
  '  (property "Value" "R" (at 0 -2.54 0)) ' +
  '  (symbol "0" ' +
  '    (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default))) ' +
  '    (pin passive line (at -3.81 0 0) (length 2.54) ' +
  '      (name "1" (effects (font (size 1.27 1.27)))) ' +
  '      (number "1" (effects (font (size 1.27 1.27))))) ' +
  '    (pin passive line (at 3.81 0 180) (length 2.54) ' +
  '      (name "2" (effects (font (size 1.27 1.27)))) ' +
  '      (number "2" (effects (font (size 1.27 1.27))))) ' +
  '  ) ' +
  ')' +
  ')';


const parsed = KipadKicadSym.parseKicadSym(SAMPLE);
assert.strictEqual(parsed.length, 1, 'sample parses to exactly one symbol');
ok('one symbol parsed');

const r = parsed[0];
assert.strictEqual(r.name, 'R');
assert.strictEqual(r.ref, 'R');
ok(`symbol named R with ref 'R'`);

assert.ok(Array.isArray(r.pins) && r.pins.length === 2, 'exactly 2 pins');
const nums = r.pins.map((p) => p.number).sort();
assert.deepStrictEqual(nums, ['1', '2']);
for (const p of r.pins) {
  assert.strictEqual(p.length, 2.54, `pin ${p.number} length 2.54`);
}
assert.strictEqual(r.pins[0].angle, 0);
assert.strictEqual(r.pins[1].angle, 180);
ok('2 pins (numbers 1 and 2, length 2.54, angles 0/180)');

assert.ok(Array.isArray(r.graphics) && r.graphics.length === 1, '1 graphic');
assert.strictEqual(r.graphics[0].type, 'rect');
assert.deepStrictEqual(r.graphics[0].start, [-1.016, -2.54]);
assert.deepStrictEqual(r.graphics[0].end, [1.016, 2.54]);
ok('1 rect graphic with correct start/end');

// ------------------------------------------------------------------
// (b) symbols.json integrity
// ------------------------------------------------------------------
console.log('(b) lib/symbols.json integrity');

const jsonPath = path.join(__dirname, '..', 'lib', 'symbols.json');
assert.ok(fs.existsSync(jsonPath), 'lib/symbols.json exists (run lib-build/build-symbols.js first)');
const symbols = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
assert.ok(Array.isArray(symbols), 'symbols.json is an array');
assert.ok(symbols.length > 0, 'symbols.json is non-empty');

const names = new Set();
for (let i = 0; i < symbols.length; i++) {
  const s = symbols[i];
  const tag = `symbol[${i}] '${s && s.name}'`;
  assert.strictEqual(typeof s.name, 'string', `${tag}: string name`);
  assert.strictEqual(typeof s.ref, 'string', `${tag}: string ref`);
  assert.ok(Array.isArray(s.pins), `${tag}: pins is array`);
  assert.ok(Array.isArray(s.graphics), `${tag}: graphics is array`);
  assert.ok(!names.has(s.name), `${tag}: unique name`);
  names.add(s.name);

  for (let j = 0; j < s.pins.length; j++) {
    const p = s.pins[j];
    const ptag = `${tag} pin[${j}]`;
    assert.strictEqual(typeof p.number, 'string', `${ptag}: string number`);
    assert.strictEqual(typeof p.name, 'string', `${ptag}: string name`);
    assert.strictEqual(typeof p.type, 'string', `${ptag}: string type`);
    assert.ok(Array.isArray(p.at) && p.at.length === 2, `${ptag}: at [x,y]`);
    assert.strictEqual(typeof p.at[0], 'number', `${ptag}: at[0] number`);
    assert.strictEqual(typeof p.at[1], 'number', `${ptag}: at[1] number`);
    assert.strictEqual(typeof p.angle, 'number', `${ptag}: angle number`);
    assert.strictEqual(typeof p.length, 'number', `${ptag}: length number`);
  }
}
ok(`${symbols.length} symbols: schema valid, names unique`);

// ------------------------------------------------------------------
// (c) spot checks via registry
// ------------------------------------------------------------------
console.log('(c) spot checks');

KipadSymbols.loadLibrary(symbols);
assert.strictEqual(KipadSymbols.count(), symbols.length, 'registry count matches json');

const R = KipadSymbols.getSymbol('R');
assert.ok(R, "symbol 'R' exists");
assert.strictEqual(R.ref, 'R');
assert.ok(R.pins.length >= 2, "'R' has >= 2 pins");
ok("symbol 'R' present, ref 'R', >= 2 pins");

const powerCandidates = ['GND', 'VCC', '+5V'];
const powerHit = powerCandidates.find((n) => KipadSymbols.getSymbol(n) !== null);
assert.ok(powerHit, `power symbol present (one of ${powerCandidates.join(', ')})`);
ok(`power symbol present: '${powerHit}'`);

console.log(`\nALL TESTS PASSED (${passed} checks)`);
