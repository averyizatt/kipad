'use strict';
/* test/test_netlist_export.js — KipadNetlist KiCad .net export */
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
const Sexp = require('../js/sexpr.js');

const NL = require('../js/netlist.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('FAIL - ' + name + ': ' + e.message); }
}

const META = { source: 'test.kicad_sch', date: 'Mon 24 Aug 2026 12:00:00 UTC', tool: 'Kipad test' };

// Registry geometry: R pins are vertical — pin1 at [x, y+3.81], pin2 at [x, y-3.81].
// GND power symbol has a single power_in pin at its origin, ref prefix #PWR.
function mkSch() {
  const sch = Sch.makeSchematic();
  const r1 = Sch.placeSymbol(sch, 'R', [10, 10]);   // R1 pins (10,13.81)/(10,6.19)
  const r2 = Sch.placeSymbol(sch, 'R', [10, 30]);   // R2 pins (10,33.81)/(10,26.19)
  r1.footprint = 'Resistor_SMD:R_0603_1608Metric';
  r2.footprint = 'Resistor_SMD:R_0603_1608Metric';
  return sch;
}

t('empty schematic: valid sexpr, no components/nets/libparts', () => {
  const out = NL.exportNetlist(Sch.makeSchematic(), Syms.getSymbol, { meta: META });
  assert.strictEqual(out.data.components.length, 0);
  assert.strictEqual(out.data.libparts.length, 0);
  assert.strictEqual(out.data.nets.length, 0);
  const tree = Sexp.parse(out.text);
  assert.strictEqual(tree[0], 'export');
  assert.strictEqual(tree[1][1].q, 'D');
});

t('wire crossing pin tips connects every pin on the segment', () => {
  const sch = mkSch();
  Sch.addWire(sch, [[10, 6.19], [10, 33.81]]);      // endpoints + R1p1/R2p2 in segment interior
  Sch.addLabel(sch, 'SIG', [10, 20], 0);            // mid-wire
  const out = NL.exportNetlist(sch, Syms.getSymbol, { meta: META });
  assert.deepStrictEqual(out.data.components.map(c => c.ref), ['R1', 'R2']);
  const net = out.data.nets.find(n => n.name === 'SIG');
  assert.ok(net, 'label-named net exists; got: ' + out.data.nets.map(n => n.name));
  assert.deepStrictEqual(net.nodes.map(n => n.ref), ['R1', 'R1', 'R2', 'R2']);
  assert.deepStrictEqual(net.nodes.map(n => n.num).sort(), ['1', '1', '2', '2']);
});

t('power symbol: excluded from components and nodes, net named GND', () => {
  const sch = mkSch();
  const pwr = Sch.placeSymbol(sch, 'GND', [10, 4]); // pin at exactly [10,4]
  Sch.addWire(sch, [[10, 4], [10, 6.19]]);          // GND pin → R1 pin2
  const out = NL.exportNetlist(sch, Syms.getSymbol, { meta: META });
  assert.strictEqual(pwr.ref[0], '#', 'registry GND uses #PWR refs');
  assert.ok(!out.text.includes(pwr.ref), 'power ref absent from whole file');
  const gnd = out.data.nets.find(n => n.name === 'GND');
  assert.ok(gnd, 'GND net named by power symbol; got: ' + out.data.nets.map(n => n.name));
  assert.deepStrictEqual(gnd.nodes.map(n => n.ref), ['R1']);
  assert.strictEqual(gnd.nodes[0].pintype, 'passive');
  assert.strictEqual(gnd.nodes[0].pinfunction, '~');
});

t('unlabeled nets keep auto N-* names', () => {
  const sch = mkSch();
  Sch.addWire(sch, [[10, 6.19], [10, 26.19]]);      // joins R1p2 + interior R1p1 + R2p2
  const out = NL.exportNetlist(sch, Syms.getSymbol, { meta: META });
  assert.strictEqual(out.data.nets.length, 2, '2 pin groups; got: ' + out.data.nets.map(n => n.name).join(','));
  const joined = out.data.nets.find(n => n.nodes.length === 3);
  assert.ok(joined && /^N-/.test(joined.name), 'joined net auto-named');
});

t('components sort naturally R2 < R10', () => {
  const sch = mkSch();
  sch.symbols.push({ id: 'sym-r10', libId: 'R', ref: 'R10', value: 'R', at: [50, 10], angle: 0, unit: 1, footprint: '' });
  const refs = NL.collect(sch, Syms.getSymbol).components.map(c => c.ref);
  assert.deepStrictEqual(refs, ['R1', 'R2', 'R10']);
  assert.strictEqual(NL.natCmp('R2', 'R10'), -1);
});

t('libparts deduped per lib+part with registry pins', () => {
  const sch = mkSch();
  const data = NL.collect(sch, Syms.getSymbol);
  assert.strictEqual(data.libparts.length, 1);
  const lp = data.libparts[0];
  assert.strictEqual(lp.part, 'R');
  assert.strictEqual(lp.refPrefix, 'R');
  assert.strictEqual(lp.pins.length, 2);
  assert.ok(lp.pins.every(p => p.type === 'passive'), 'passive pintype from registry');
  const text = NL.formatNetlist(data, META);
  assert.strictEqual(flattenFindAll(Sexp.parse(text), 'libpart').length, 1, 'one libpart block, balanced sexpr');
});

t('footprint passthrough keeps library prefix', () => {
  const sch = mkSch();
  const out = NL.exportNetlist(sch, Syms.getSymbol, { meta: META });
  assert.ok(out.text.includes('(footprint "Resistor_SMD:R_0603_1608Metric")'), out.text);
});

t('pin data omitted cleanly for symbols missing from registry', () => {
  const sch = mkSch();
  sch.symbols.push({ id: 'sym-x', libId: 'NoSuchPart', ref: 'X1', value: 'X', at: [90, 10], angle: 0, unit: 1, footprint: '' });
  const out = NL.exportNetlist(sch, Syms.getSymbol, { meta: META });
  const xComp = out.data.components.find(c => c.ref === 'X1');
  assert.ok(xComp, 'component without registry def still exported');
  assert.strictEqual(xComp.desc, '');
  assert.doesNotThrow(() => Sexp.parse(out.text), 'output stays well-formed');
});

t('values with quotes are escaped', () => {
  const sch = mkSch();
  sch.symbols[0].value = '10k "precision"';
  const out = NL.exportNetlist(sch, Syms.getSymbol, { meta: META });
  assert.ok(out.text.includes('"10k \\"precision\\""'));
  assert.doesNotThrow(() => Sexp.parse(out.text));
});

t('deterministic given same schematic + fixed date', () => {
  const sch = mkSch();
  Sch.addWire(sch, [[10, 6.19], [10, 33.81]]);
  Sch.addLabel(sch, 'A', [10, 20], 0);
  const a = NL.exportNetlist(sch, Syms.getSymbol, { meta: META }).text;
  const b = NL.exportNetlist(sch, Syms.getSymbol, { meta: META }).text;
  assert.strictEqual(a, b);
});

t('serialize→parse round-trip: refs, footprints and nets survive save/reopen', () => {
  const sch = mkSch();
  Sch.addWire(sch, [[10, 6.19], [10, 33.81]]);
  const text = Sch.serializeSch(sch);
  const parsed = Sch.parseSch(text);
  const before = NL.collect(sch, Syms.getSymbol);
  const after = NL.collect(parsed, Syms.getSymbol);
  assert.deepStrictEqual(after.components.map(c => c.ref + '|' + c.footprint),
                        before.components.map(c => c.ref + '|' + c.footprint),
                        'footprint property must survive the .kicad_sch round trip');
  assert.deepStrictEqual(after.nets.map(n => n.name + ':' + n.nodes.length),
                        before.nets.map(n => n.name + ':' + n.nodes.length));
});

t('every exported node references an exported component', () => {
  const sch = mkSch();
  Sch.placeSymbol(sch, 'GND', [99, 99]);            // dangling power sym → net dropped
  Sch.addWire(sch, [[10, 6.19], [10, 33.81]]);
  const out = NL.exportNetlist(sch, Syms.getSymbol, { meta: META });
  const refs = new Set(out.data.components.map(c => c.ref));
  out.data.nets.forEach(n =>
    n.nodes.forEach(nd => assert.ok(refs.has(nd.ref), nd.ref + ' missing from components')));
  assert.ok(!out.data.nets.some(n => n.name === 'GND' && n.nodes.length === 0), 'empty nets dropped');
});

// ---- helpers ----
function flattenFindAll(tree, tag) {
  const hits = [];
  (function walk(node) {
    if (!Array.isArray(node)) return;
    if (node[0] === tag) hits.push(node);
    node.forEach(walk);
  })(tree);
  return hits;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
