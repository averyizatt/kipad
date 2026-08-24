'use strict';
/* test/test_symfields.js — KipadSymFields (Edit Symbol Fields helpers) */
const assert = require('assert');

// Registry globals so placeSymbol derives real prefixes/values (same as test_bom.js)
const g = globalThis;
g.window = g;
g.KipadSexpr = require('../js/sexpr.js');
const Syms = require('../js/symbols.js');
Syms.loadLibrary(require('../lib/symbols.json'));
g.KipadSymbols = Syms;
const Sch = require('../js/schematic.js');
g.KipadSchematic = Sch;

const SF = require('../js/symfields.js');
const Erc = require('../js/erc.js');
const Bom = require('../js/bom.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('FAIL - ' + name + ': ' + e.message); }
}

function mkSch() {
  const sch = Sch.makeSchematic();
  Sch.placeSymbol(sch, 'R', [10, 10]);   // R1
  Sch.placeSymbol(sch, 'R', [20, 10]);   // R2
  Sch.placeSymbol(sch, 'C', [30, 10]);   // C1
  return sch;
}

t('rows: empty schematic -> []', () => {
  assert.deepStrictEqual(SF.rows(Sch.makeSchematic()), []);
});

t('rows: null/degenerate input safe', () => {
  assert.deepStrictEqual(SF.rows(null), []);
  const bad = { symbols: 'nope' };
  assert.deepStrictEqual(SF.rows(bad), []);
});

t('rows: one row per physical symbol with ref/value/footprint', () => {
  const sch = mkSch();
  const rows = SF.rows(sch);
  assert.strictEqual(rows.length, 3);
  for (const r of rows) {
    assert.ok(r.id, 'row carries id');
    assert.ok(['ref', 'value', 'footprint'].every(k => typeof r[k] === 'string'));
  }
  const refs = rows.map(r => r.ref);
  assert.ok(refs.includes('R1') && refs.includes('R2') && refs.includes('C1'));
});

t('rows: power symbols and #-refs excluded', () => {
  const sch = mkSch();
  sch.symbols.push({ id: 'pwr1', libId: 'GND', ref: '#PWR01', value: 'GND', at: [5, 20], angle: 0, unit: 1, footprint: '' });
  sch.symbols.push({ id: 'pwr2', libId: 'VCC', ref: '#PWR02', value: 'VCC', at: [15, 20], angle: 0, unit: 1, footprint: '' });
  assert.strictEqual(SF.rows(sch).length, 3);
});

t('rows: natural sort R2 < R10 and C1 < L1 < R1 < U1', () => {
  const sch = mkSch();
  sch.symbols[1].ref = 'R10'; // was R2
  sch.symbols.push({ id: 'l1', libId: 'L', ref: 'L1', value: 'L', at: [50, 10], angle: 0, unit: 1, footprint: '' });
  sch.symbols.push({ id: 'u1', libId: 'MCU_Module:Arduino_Uno', ref: 'U1', value: 'Arduino_Uno', at: [60, 10], angle: 0, unit: 1, footprint: '' });
  assert.deepStrictEqual(SF.rows(sch).map(r => r.ref), ['C1', 'L1', 'R1', 'R10', 'U1']);
});

t('applyRow: sets ref/value/footprint and reports changed keys', () => {
  const sch = mkSch();
  const sym = sch.symbols[0];
  sym.footprint = ''; // library R ships a default footprint; start unassigned
  const changed = SF.applyRow(sym, { ref: 'R7', value: '10k', footprint: 'Resistor_SMD:R_0603_1608Metric' });
  assert.deepStrictEqual(changed.sort(), ['footprint', 'ref', 'value']);
  assert.strictEqual(sym.ref, 'R7');
  assert.strictEqual(sym.value, '10k');
  assert.strictEqual(sym.footprint, 'Resistor_SMD:R_0603_1608Metric');
});

t('applyRow: blank/whitespace ref keeps the old designator', () => {
  const sch = mkSch();
  const sym = sch.symbols[0];
  const changed = SF.applyRow(sym, { ref: '   ' });
  assert.deepStrictEqual(changed, []);
  assert.strictEqual(sym.ref, 'R1');
  // whitespace around a real ref is trimmed and applied
  assert.deepStrictEqual(SF.applyRow(sym, { ref: ' R3 ' }), ['ref']);
  assert.strictEqual(sym.ref, 'R3');
});

t('applyRow: value/footprint may be cleared; unchanged values report nothing', () => {
  const sch = mkSch();
  const sym = sch.symbols[0];
  sym.value = '10k'; sym.footprint = 'R_0603';
  assert.deepStrictEqual(SF.applyRow(sym, { value: '', footprint: '  ' }), ['value', 'footprint']);
  assert.strictEqual(sym.value, '');
  assert.strictEqual(sym.footprint, '');
  assert.deepStrictEqual(SF.applyRow(sym, { value: '' }), []);
});

t('applyRow: missing symbol / empty patch safe', () => {
  assert.deepStrictEqual(SF.applyRow(null, { ref: 'X' }), []);
  const sch = mkSch();
  assert.deepStrictEqual(SF.applyRow(sch.symbols[0], {}), []);
  assert.deepStrictEqual(SF.applyRow(sch.symbols[0], null), []);
});

t('fields survive .kicad_sch save/reopen round-trip', () => {
  const sch = mkSch();
  SF.applyRow(sch.symbols[0], { value: '4k7', footprint: 'Resistor_SMD:R_0603_1608Metric' });
  const txt = Sch.serializeSch(sch, Syms.getSymbol);
  const back = Sch.parseSch(txt, Syms.getSymbol);
  const r1 = back.symbols.find(s => s.ref === 'R1');
  assert.strictEqual(r1.value, '4k7');
  assert.strictEqual(r1.footprint, 'Resistor_SMD:R_0603_1608Metric');
});

t('ERC agrees after assignment: FOOTPRINT_NOT_FOUND clears', () => {
  const sch = mkSch();
  sch.symbols.forEach(s => { s.footprint = ''; }); // isolate from library defaults
  const getFootprint = name => name === 'R_0603_1608Metric';
  SF.applyRow(sch.symbols[0], { footprint: 'NOPE:Not_Real' });
  let vs = Erc.runERC(sch, Syms.getSymbol, getFootprint).filter(v => v.code === 'FOOTPRINT_NOT_FOUND');
  assert.strictEqual(vs.length, 1);
  assert.strictEqual(vs[0].symbolId, sch.symbols[0].id);
  SF.applyRow(sch.symbols[0], { footprint: 'Resistor_SMD:R_0603_1608Metric' });
  vs = Erc.runERC(sch, Syms.getSymbol, getFootprint).filter(v => v.code === 'FOOTPRINT_NOT_FOUND');
  assert.strictEqual(vs.length, 0);
  // remaining MISSING_FOOTPRINT warnings are the two untouched symbols
  vs = Erc.runERC(sch, Syms.getSymbol, getFootprint).filter(v => v.code === 'MISSING_FOOTPRINT');
  assert.strictEqual(vs.length, 2);
});

t('BOM reflects edited values: same value+footprint group together', () => {
  const sch = mkSch();
  SF.applyRow(sch.symbols[0], { value: '10k', footprint: 'R_0603' });
  SF.applyRow(sch.symbols[1], { value: '10k', footprint: 'R_0603' });
  const groups = Bom.collect(sch);
  assert.strictEqual(groups.length, 2); // 2×R(10k) + 1×C
  const rGroup = groups.find(gr => gr.refs.includes('R1'));
  assert.strictEqual(rGroup.qty, 2);
  assert.strictEqual(rGroup.refs.join(' '), 'R1 R2');
});

t('determinism: rows order stable across calls', () => {
  const sch = mkSch();
  sch.symbols[1].ref = 'R10';
  const a = SF.rows(sch), b = SF.rows(sch);
  assert.deepStrictEqual(a, b);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
