'use strict';

/**
 * Footprint ERC tests — MISSING_FOOTPRINT / FOOTPRINT_NOT_FOUND (js/erc.js).
 * Run: cd kipad && node test/test_footprint_erc.js
 */

const assert = require('assert');

const g = globalThis;
g.window = g;
g.KipadSexpr = require('../js/sexpr.js');
const Syms = require('../js/symbols.js');
Syms.loadLibrary(require('../lib/symbols.json'));
g.KipadSymbols = Syms;
const Sch = require('../js/schematic.js');
g.KipadSchematic = Sch;
const Erc = require('../js/erc.js');

function byCode(viol, code) { return viol.filter(v => v.code === code); }

// tiny footprint registry stub mirroring KipadFootprints.getFootprint
const REGISTRY = { 'R_0603_1608Metric': { pads: [] }, 'C_0805_2012Metric': { pads: [] } };
const getFp = name => REGISTRY[name] || null;

// ---- 1. unassigned footprint -> warning on non-power symbols ----
let sch = Sch.makeSchematic();
const r1 = Sch.placeSymbol(sch, 'R', [0, 0], 0);
r1.footprint = '';                               // force-unassigned regardless of lib defaults
let viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'MISSING_FOOTPRINT').length, 1, 'empty footprint reported');
assert.strictEqual(byCode(viol, 'MISSING_FOOTPRINT')[0].severity, 'warning', 'missing footprint is a warning');
assert.strictEqual(byCode(viol, 'MISSING_FOOTPRINT')[0].symbolId, r1.id, 'violation points at the symbol');
assert.deepStrictEqual([byCode(viol, 'MISSING_FOOTPRINT')[0].x, byCode(viol, 'MISSING_FOOTPRINT')[0].y], [0, 0], 'located at symbol origin');

// whitespace-only counts as missing too
r1.footprint = '   ';
viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'MISSING_FOOTPRINT').length, 1, 'whitespace-only footprint reported');

// message names the ref
assert.ok(/R1/.test(byCode(viol, 'MISSING_FOOTPRINT')[0].message), 'message mentions the ref designator');

// ---- 2. power symbols exempt ----
sch = Sch.makeSchematic();
const pwr = Sch.placeSymbol(sch, 'GND', [0, -10], 0);
if (!pwr || !Sch.isPower(pwr)) throw new Error('GND fixture must be a power symbol for this test');
viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'MISSING_FOOTPRINT').filter(v => v.symbolId === pwr.id).length, 0, 'power symbol never needs a footprint');

// KiCad #-refs (#PWR/#FLG-style) are exempt even when the value misses the
// power-name regex (e.g. a synthetic power_out symbol valued "3V3")
Sch.placeSymbol(sch, 'TEST_PWR_OUT', [10, -10], 0);
sch.symbols[sch.symbols.length - 1].ref = '#PWR01';
viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'MISSING_FOOTPRINT').length, 0, '#-prefixed refs exempt from footprint checks');

// ---- 3. assigned + resolvable -> clean; unknown -> error ----
sch = Sch.makeSchematic();
const c1 = Sch.placeSymbol(sch, 'C', [5, 0], 0);
c1.footprint = 'Capacitor_SMD:C_0805_2012Metric';
viol = Erc.runERC(sch, Syms.getSymbol, getFp);
assert.strictEqual(byCode(viol, 'FOOTPRINT_NOT_FOUND').length, 0, 'resolvable lib:name assignment passes');
assert.strictEqual(byCode(viol, 'MISSING_FOOTPRINT').length, 0, 'assigned symbol not flagged');

c1.footprint = 'C_0805_2012Metric';              // bare name (no library prefix) also fine
viol = Erc.runERC(sch, Syms.getSymbol, getFp);
assert.strictEqual(byCode(viol, 'FOOTPRINT_NOT_FOUND').length, 0, 'bare resolvable name passes');

c1.footprint = 'Weird_Lib:Not_A_Real_Part';
viol = Erc.runERC(sch, Syms.getSymbol, getFp);
assert.strictEqual(byCode(viol, 'FOOTPRINT_NOT_FOUND').length, 1, 'unknown footprint reported');
const nf = byCode(viol, 'FOOTPRINT_NOT_FOUND')[0];
assert.strictEqual(nf.severity, 'error', 'unknown footprint is an error');
assert.strictEqual(nf.symbolId, c1.id, 'error points at the owning symbol');
assert.ok(/Not_A_Real_Part/.test(nf.message), 'message quotes the bad name');
assert.ok(/[Dd]efault|fallback/i.test(nf.message), 'message explains the silent fallback');

// ---- 4. without a registry getter the existence check is skipped ----
c1.footprint = 'Weird_Lib:Not_A_Real_Part';
viol = Erc.runERC(sch, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'FOOTPRINT_NOT_FOUND').length, 0, 'no getter -> existence check skipped');

// ---- 5. default footprints inherited from the symbol library are honoured ----
sch = Sch.makeSchematic();
const u1 = Sch.placeSymbol(sch, 'R', [0, 0], 0);
if (u1.footprint) {                              // only meaningful if the lib def carries one
  viol = Erc.runERC(sch, Syms.getSymbol);
  assert.strictEqual(byCode(viol, 'MISSING_FOOTPRINT').length, 0, 'lib-default footprint satisfies the check');
}

// ---- 6. counts() integration + determinism ----
sch = Sch.makeSchematic();
const a = Sch.placeSymbol(sch, 'R', [0, 0], 0); a.footprint = '';
const b = Sch.placeSymbol(sch, 'C', [10, 0], 0); b.footprint = 'X:nope';
viol = Erc.runERC(sch, Syms.getSymbol, getFp);
const cnt = Erc.counts(viol);
assert.strictEqual(cnt.warnings >= 1 && byCode(viol, 'MISSING_FOOTPRINT').length === 1, true, 'warning counted');
assert.strictEqual(cnt.errors >= 1 && byCode(viol, 'FOOTPRINT_NOT_FOUND').length === 1, true, 'error counted');

const viol2 = Erc.runERC(sch, Syms.getSymbol, getFp);
assert.deepStrictEqual(viol.map(v => v.code), viol2.map(v => v.code), 'stable violation order');

console.log('FOOTPRINT ERC TESTS PASSED');
