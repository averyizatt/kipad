'use strict';
/* test/test_bom.js — KipadBom bill-of-materials generation */
const assert = require('assert');

// Registry globals so placeSymbol derives real prefixes/values (same as test_erc.js)
const g = globalThis;
g.window = g;
g.KipadSexpr = require('../js/sexpr.js');
const Syms = require('../js/symbols.js');
Syms.loadLibrary(require('../lib/symbols.json'));
g.KipadSymbols = Syms;
const Sch = require('../js/schematic.js');
g.KipadSchematic = Sch;

const Bom = require('../js/bom.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('FAIL - ' + name + ': ' + e.message); }
}

// Two resistors + cap + MCU, wired like a real sheet (wires irrelevant to BOM)
function mkSch() {
  const sch = Sch.makeSchematic();
  Sch.placeSymbol(sch, 'R', [10, 10]);   // R1
  Sch.placeSymbol(sch, 'R', [20, 10]);   // R2
  Sch.placeSymbol(sch, 'C', [30, 10]);   // C1
  sch.symbols.push({ id: 'sym-u1', libId: 'MCU_Module:Arduino_Uno', ref: 'U1', value: 'Arduino_Uno', at: [40, 40], angle: 0, unit: 1, footprint: '' });
  return sch;
}

t('empty schematic: no rows, header-only csv', () => {
  const out = Bom.exportBom(Sch.makeSchematic());
  assert.strictEqual(out.rows.length, 0);
  assert.strictEqual(out.csv, 'Ref,Qnty,Value,Footprint\n');
});

t('identical value+footprint group into one row with qty', () => {
  const sch = mkSch();
  sch.symbols[0].footprint = 'R_0603_1608Metric';
  sch.symbols[1].footprint = 'R_0603_1608Metric';
  sch.symbols.forEach(s => { if (!s.footprint) s.footprint = s.ref.startsWith('C') ? 'C_0603' : s.ref.startsWith('U') ? 'Module_Board' : ''; });
  const rows = Bom.collect(sch);
  const rRow = rows.find(r => r.refs.includes('R1'));
  assert.ok(rRow, 'resistor row exists');
  assert.strictEqual(rRow.qty, 2);
  assert.deepStrictEqual(rRow.refs, ['R1', 'R2']);
});

t('different values never merge even with same footprint', () => {
  const sch = Sch.makeSchematic();
  Sch.placeSymbol(sch, 'R', [10, 10]);
  Sch.placeSymbol(sch, 'R', [20, 10]);
  sch.symbols[0].value = '10k';
  sch.symbols[1].value = '4k7';
  sch.symbols.forEach(s => { s.footprint = 'R_0603'; });
  const rows = Bom.collect(sch);
  assert.strictEqual(rows.length, 2);
});

t('power symbols excluded from BOM', () => {
  const sch = mkSch();
  const gnd = Sch.placeSymbol(sch, 'GND', [5, 5]);
  assert.ok(Sch.isPower(gnd), 'sanity: GND detected as power');
  const rows = Bom.collect(sch);
  assert.strictEqual(rows.reduce((n, r) => n + r.qty, 0), 4);
  assert.ok(!rows.some(r => r.value === 'GND'));
});

t('#-prefixed annotation refs excluded', () => {
  const sch = mkSch();
  sch.symbols.push({ id: 'x1', libId: 'power:GND', ref: '#PWR01', value: 'GND', at: [0, 0], angle: 0, unit: 1, footprint: '' });
  sch.symbols.push({ id: 'x2', libId: 'Device:R', ref: '#FLG02', value: '10k', at: [1, 1], angle: 0, unit: 1, footprint: 'R_0603' });
  const refs = Bom.collect(sch).flatMap(r => r.refs);
  assert.ok(!refs.some(r => r.startsWith('#')));
});

t('natural sort inside groups and across groups (R2 < R10)', () => {
  const sch = Sch.makeSchematic();
  const refs0 = ['R10', 'R2', 'R11', 'R1'];   // deliberately shuffled
  for (let i = 0; i < 4; i++) {
    sch.symbols.push({ id: 'r' + i, libId: 'R', ref: refs0[i], value: '10k', at: [i * 5 + 10, 10], angle: 0, unit: 1, footprint: 'R_0603' });
  }
  sch.symbols.unshift({ id: 'c9', libId: 'C', ref: 'C9', value: '100n', at: [-5, 10], angle: 0, unit: 1, footprint: 'C_0603' });
  const allRefs = Bom.collect(sch).flatMap(r => r.refs);
  assert.deepStrictEqual(allRefs, ['C9', 'R1', 'R2', 'R10', 'R11']);
});

t('group order by first ref: caps before mcus before Rs', () => {
  const sch = mkSch();
  sch.symbols.forEach(s => { s.footprint = s.ref.startsWith('U') ? 'Mod' : s.ref.startsWith('C') ? 'Cap' : 'Res'; });
  const firsts = Bom.collect(sch).map(r => r.refs[0]);
  assert.deepStrictEqual(firsts, ['C1', 'R1', 'U1']);
});

t('csv quotes fields containing spaces/commas/quotes only', () => {
  const rows = [{ refs: ['R1', 'R2'], qty: 2, value: '10k', footprint: 'R_0603' }];
  const csv = Bom.formatCsv(rows);
  assert.strictEqual(csv, 'Ref,Qnty,Value,Footprint\n"R1 R2",2,10k,R_0603\n');
  const tricky = Bom.formatCsv([{ refs: ['U1'], qty: 1, value: '"Mega", 32', footprint: 'QFN, 32' }]);
  assert.ok(tricky.includes('U1,1,"""Mega"", 32","QFN, 32"'), 'RFC-4180 escaping');
});

t('missing footprint exported as empty field', () => {
  const sch = mkSch();
  const rows = Bom.collect(sch);
  const u = rows.find(r => r.refs.includes('U1'));
  assert.strictEqual(u.footprint, '');
  assert.ok(Bom.formatCsv(rows).split('\n').some(l => l.endsWith(',')), 'empty trailing footprint column present');
});

t('deterministic across calls', () => {
  const sch = mkSch();
  sch.symbols.forEach((s, i) => { s.footprint = i % 2 ? 'A' : 'B'; });
  const a = Bom.exportBom(sch), b = Bom.exportBom(sch);
  assert.deepStrictEqual(a.rows, b.rows);
  assert.strictEqual(a.csv, b.csv);
});

t('round-trip smoke: serialize -> parse -> export still groups correctly', () => {
  const sch = mkSch();
  sch.symbols[0].footprint = sch.symbols[1].footprint = 'R_0603';
  sch.symbols[2].footprint = 'C_0603';
  sch.symbols[3].footprint = 'Module_Board';
  const text = Sch.serializeSch(sch);
  const parsed = Sch.parseSch(text);
  const rows = Bom.collect(parsed);
  assert.strictEqual(rows.reduce((n, r) => n + r.qty, 0), 4);
  const rRow = rows.find(r => r.refs.includes('R1'));
  assert.strictEqual(rRow.qty, 2);
  assert.strictEqual(Bom.formatCsv(rows).split('\n').length, 5);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
