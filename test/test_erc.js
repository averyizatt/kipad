'use strict';

/**
 * ERC tests — js/erc.js (KipadErc), KiCad-style electrical rules check for
 * schematics. Builds synthetic schematics with the KipadSchematic API.
 * Run: cd kipad && node test/test_erc.js
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
g.KipadErc = Erc;

function byCode(viol, code) { return viol.filter(v => v.code === code); }
function codes(viol) { return viol.map(v => v.code); }

// R symbol pin geometry: pin 1 at (0, 3.81), pin 2 at (0, -3.81)
assert.strictEqual(Sch.pinPositions({ libId: 'R', at: [0, 0], angle: 0 }, Syms.getSymbol).length, 2, 'R has 2 pins');

// ---- 1. clean schematic → zero violations ----
const clean = Sch.makeSchematic();
Sch.placeSymbol(clean, 'R', [0, 0], 0);
Sch.placeSymbol(clean, 'C', [10, 0], 0);
Sch.addWire(clean, [[0, 3.81], [10, 3.81]]);
Sch.addLabel(clean, 'VCC', [5, 3.81], 0);
Sch.addWire(clean, [[0, -3.81], [10, -3.81]]);
Sch.addLabel(clean, 'GND', [5, -3.81], 0);
let viol = Erc.runERC(clean, Syms.getSymbol);
assert.strictEqual(viol.length, 0, 'fully-wired labeled circuit is clean, got: ' + JSON.stringify(viol));

// ---- 2. unconnected pins ----
const iso = Sch.makeSchematic();
const isoR = Sch.placeSymbol(iso, 'R', [0, 0], 0);
viol = Erc.runERC(iso, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN').length, 2, 'isolated R: both pins unconnected');
assert.strictEqual(byCode(viol, 'SINGLE_PIN_NET').length, 0, 'isolated pins are not ALSO single-pin nets');
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN')[0].severity, 'warning', 'unconnected pin is a warning');
const u = byCode(viol, 'UNCONNECTED_PIN')[0];
assert.strictEqual(u.symbolId, isoR.id, 'unconnected pin locates symbol');
assert.strictEqual(u.pinId, '1', 'unconnected pin locates pin number');
assert.ok(typeof u.x === 'number' && typeof u.y === 'number', 'unconnected pin carries coordinates');

// ---- 3. power pin exemption (value names a power net) ----
const loneGnd = Sch.makeSchematic();
Sch.placeSymbol(loneGnd, 'GND', [2.54, 0], 0);
assert.strictEqual(Erc.runERC(loneGnd, Syms.getSymbol).length, 0, 'lone GND power symbol is not an error');
assert.strictEqual(Erc.powerNetName({ type: 'power_in', symValue: 'GND', name: '' }), 'GND', 'powerNetName from value');
assert.strictEqual(Erc.powerNetName({ type: 'passive', symValue: 'GND', name: '' }), null, 'passive pin is not a power pin');

// synthetic power_out symbol (value names a net) — also exempt
Syms.loadLibrary([{ name: 'TEST_PWR_OUT', ref: '#PWR', value: '3V3', footprint: '', desc: '',
  pins: [{ number: '1', name: '', type: 'power_out', at: [0, 0], angle: 0, length: 2.54 }], graphics: [] }]);
const lonePwrOut = Sch.makeSchematic();
Sch.placeSymbol(lonePwrOut, 'TEST_PWR_OUT', [0, 0], 0);
assert.strictEqual(Erc.runERC(lonePwrOut, Syms.getSymbol).length, 0, 'lone power_out symbol with net-named value is fine');

// ---- 4. no_connect pin exemption ----
Syms.loadLibrary([{ name: 'TEST_NC', ref: 'U', value: 'TEST_NC', footprint: '', desc: '',
  pins: [{ number: '1', name: 'NC', type: 'no_connect', at: [0, 0], angle: 0, length: 2.54 }], graphics: [] }]);
const loneNc = Sch.makeSchematic();
Sch.placeSymbol(loneNc, 'TEST_NC', [0, 0], 0);
assert.strictEqual(Erc.runERC(loneNc, Syms.getSymbol).length, 0, 'no_connect pin is exempt from unconnected checks');

// ---- 5. duplicate reference designators ----
const dup = Sch.makeSchematic();
Sch.placeSymbol(dup, 'R', [0, 0], 0, 'R1');
const dupR2 = Sch.placeSymbol(dup, 'R', [10, 0], 0, 'R1');
viol = Erc.runERC(dup, Syms.getSymbol);
const dupViol = byCode(viol, 'DUPLICATE_REF');
assert.strictEqual(dupViol.length, 1, 'two R1 → one duplicate-ref error');
assert.strictEqual(dupViol[0].severity, 'error', 'duplicate ref is an error');
assert.strictEqual(dupViol[0].symbolId, dupR2.id, 'duplicate flagged on the second symbol');
assert.ok(dupViol[0].message.indexOf('R1') >= 0, 'message names the designator');

// three of a kind → two violations (one per extra symbol)
const tri = Sch.makeSchematic();
Sch.placeSymbol(tri, 'R', [0, 0], 0, 'R1');
Sch.placeSymbol(tri, 'R', [10, 0], 0, 'R1');
Sch.placeSymbol(tri, 'R', [20, 0], 0, 'R1');
assert.strictEqual(byCode(Erc.runERC(tri, Syms.getSymbol), 'DUPLICATE_REF').length, 2, 'three R1 → two errors');

// ---- 6. missing ref / value ----
const miss = Sch.makeSchematic();
const missR = Sch.placeSymbol(miss, 'R', [0, 0], 0);
missR.ref = '';
missR.value = '';
viol = Erc.runERC(miss, Syms.getSymbol);
const mref = byCode(viol, 'MISSING_REF');
const mval = byCode(viol, 'MISSING_VALUE');
assert.strictEqual(mref.length, 1, 'empty ref → MISSING_REF');
assert.strictEqual(mref[0].severity, 'error', 'missing ref is an error');
assert.strictEqual(mval.length, 1, 'empty value → MISSING_VALUE');
assert.strictEqual(mval[0].severity, 'warning', 'missing value is a warning');
assert.strictEqual(mval[0].symbolId, missR.id, 'missing-value locates symbol');

// ---- 7. net label conflicts ----
const conf = Sch.makeSchematic();
Sch.placeSymbol(conf, 'R', [0, 0], 0);
Sch.placeSymbol(conf, 'C', [10, 0], 0);
Sch.addWire(conf, [[0, 3.81], [10, 3.81]]);
Sch.addLabel(conf, 'A', [2, 3.81], 0);
Sch.addLabel(conf, 'B', [8, 3.81], 0);
viol = Erc.runERC(conf, Syms.getSymbol);
const lc = byCode(viol, 'LABEL_CONFLICT');
assert.strictEqual(lc.length, 1, 'two different labels on one net → one conflict');
assert.strictEqual(lc[0].severity, 'error', 'label conflict is an error');
assert.ok(lc[0].message.indexOf('"B"') >= 0 && lc[0].message.indexOf('"A"') >= 0, 'message names both labels');
assert.ok(lc[0].labelId, 'label conflict locates the label id');
assert.ok(typeof lc[0].x === 'number', 'label conflict carries position');
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN').length, 2, 'unconnected pins still reported (pins 2)');

// same label text repeated on one net is fine
const same = Sch.makeSchematic();
Sch.placeSymbol(same, 'R', [0, 0], 0);
Sch.placeSymbol(same, 'C', [10, 0], 0);
Sch.addWire(same, [[0, 3.81], [10, 3.81]]);
Sch.addLabel(same, 'A', [2, 3.81], 0);
Sch.addLabel(same, 'A', [8, 3.81], 0);
assert.strictEqual(byCode(Erc.runERC(same, Syms.getSymbol), 'LABEL_CONFLICT').length, 0, 'duplicate same-name labels on one net are fine');

// ---- 8. single-pin net (pin + wire stub, no label) ----
const stub = Sch.makeSchematic();
const stubR = Sch.placeSymbol(stub, 'R', [0, 0], 0);
Sch.addWire(stub, [[0, 3.81], [5, 3.81]]);
viol = Erc.runERC(stub, Syms.getSymbol);
const spn = byCode(viol, 'SINGLE_PIN_NET');
assert.strictEqual(spn.length, 1, 'pin wired to a stub with no label → single-pin net');
assert.strictEqual(spn[0].severity, 'warning', 'single-pin net is a warning');
assert.strictEqual(spn[0].symbolId, stubR.id, 'single-pin net locates the symbol');
assert.strictEqual(spn[0].pinId, '1', 'single-pin net locates the pin');
assert.ok(spn[0].netName.indexOf('N-') === 0, 'auto net name used');
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN').length, 1, 'other pin still unconnected');
assert.strictEqual(byCode(viol, 'DANGLING_WIRE').length, 1, 'stub end is dangling');

// ---- 9. dangling wires ----
const dang = Sch.makeSchematic();
Sch.addWire(dang, [[0, 0], [5, 0]]);
viol = Erc.runERC(dang, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'DANGLING_WIRE').length, 2, 'bare wire → both ends dangling');
assert.strictEqual(byCode(viol, 'DANGLING_WIRE')[0].severity, 'warning', 'dangling wire is a warning');
assert.ok(byCode(viol, 'DANGLING_WIRE')[0].wireId, 'dangling wire locates the wire id');

// wire between two pins is not dangling (covered by clean case, assert explicitly)
assert.strictEqual(byCode(Erc.runERC(clean, Syms.getSymbol), 'DANGLING_WIRE').length, 0, 'wired pins → no dangling ends');

// label right at a wire end rescues the end
const labEnd = Sch.makeSchematic();
Sch.placeSymbol(labEnd, 'R', [0, 0], 0);
Sch.addWire(labEnd, [[0, 3.81], [5, 3.81]]);
Sch.addLabel(labEnd, 'OUT', [5, 3.81], 0);
viol = Erc.runERC(labEnd, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'DANGLING_WIRE').length, 0, 'label at wire end → not dangling');
assert.strictEqual(byCode(viol, 'SINGLE_PIN_NET').length, 0, 'labeled net is not a single-pin net');
assert.strictEqual(byCode(viol, 'UNCONNECTED_PIN').length, 1, 'pin 2 still unconnected');

// wire loop closing on itself is not a dangling end
const loop = Sch.makeSchematic();
Sch.addWire(loop, [[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]);
viol = Erc.runERC(loop, Syms.getSymbol);
assert.strictEqual(byCode(viol, 'DANGLING_WIRE').length, 0, 'closed loop has no dangling ends');

// ---- 10. severity counts ----
const mixed = Sch.makeSchematic();
Sch.placeSymbol(mixed, 'R', [0, 0], 0, 'R1');
Sch.placeSymbol(mixed, 'R', [10, 0], 0, 'R1');
viol = Erc.runERC(mixed, Syms.getSymbol);
const c = Erc.counts(viol);
assert.strictEqual(c.errors, 1, 'one duplicate ref error');
assert.strictEqual(c.warnings, 4, 'four unconnected pins (2 symbols × 2 pins)');
assert.strictEqual(viol.length, c.errors + c.warnings, 'counts add up');

// ---- 11. violations are deterministic + all carry locate info ----
viol = Erc.runERC(mixed, Syms.getSymbol);
assert.deepStrictEqual(codes(viol), codes(Erc.runERC(mixed, Syms.getSymbol)), 'deterministic order');
viol.forEach(v => {
  assert.ok(v.severity === 'error' || v.severity === 'warning', 'severity valid');
  assert.ok(typeof v.message === 'string' && v.message.length > 0, 'message present');
  assert.ok(typeof v.x === 'number' && typeof v.y === 'number', 'coordinates present');
  assert.ok(v.symbolId || v.labelId || v.wireId, 'locator id present');
});

console.log('ERC TESTS PASSED');
