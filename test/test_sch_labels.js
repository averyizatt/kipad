'use strict';

/**
 * Schematic label tests — local/global label model (js/schematic.js),
 * .kicad_sch round-trip of (label ...) / (global_label ...), and netlist
 * equivalence of both flavours.
 * Run: cd kipad && node test/test_sch_labels.js
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

// ---- 1. model defaults ----
let sch = Sch.makeSchematic();
const loc = Sch.addLabel(sch, 'SDA', [10, 20], 0);
assert.strictEqual(loc.type, 'local', 'label type defaults to local');

const glob = Sch.addLabel(sch, 'SDA', [30, 20], 0, 'global');
assert.strictEqual(glob.type, 'global', 'explicit global type kept');

const weird = Sch.addLabel(sch, 'X', [40, 20], 0, 'bogus');
assert.strictEqual(weird.type, 'local', 'unknown type coerces to local');

// ---- 2. serialization ----
const schLocOnly = Sch.makeSchematic();
Sch.addLabel(schLocOnly, 'SDA', [10, 20], 0);
let out = Sch.serializeSch(schLocOnly);
assert.ok(out.includes('(label "SDA" (at 10 20 0)'), 'local label serialized as (label');
assert.ok(!out.includes('(global_label'), 'no global_label when only locals');

let sch2 = Sch.makeSchematic();
Sch.addLabel(sch2, 'BUS0', [5, 5], 90, 'global');
out = Sch.serializeSch(sch2);
assert.ok(out.includes('(global_label "BUS0" (at 5 5 90)'), 'global label serialized as (global_label with angle');
assert.ok(out.includes('(shape input)'), 'global label carries KiCad shape input');

// both flavours in one file
sch.labels.push(JSON.parse(JSON.stringify(glob)));
out = Sch.serializeSch(sch);
assert.ok(out.includes('(label "SDA"'), 'mixed file keeps (label');
assert.ok(out.includes('(global_label "SDA"'), 'mixed file keeps (global_label');

// ---- 3. parsing real KiCad-style text ----
const kicadText = `(kicad_sch (version 20231120) (generator eeschema)
  (paper "A4")
  (wire (pts (xy 10 10) (xy 30 10)) (stroke (width 0) (type default)) (uuid "u1"))
  (label "LOCAL_NET" (at 10 10 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "u2"))
  (global_label "GLOBAL_NET" (at 30 10 180) (shape input)
    (effects (font (size 1.27 1.27)) (justify right bottom)) (uuid "u3"))
)`;
let parsed = Sch.parseSch(kicadText, null);
assert.strictEqual(parsed.labels.length, 2, 'both labels parsed');
const pLoc = parsed.labels.find(l => l.text === 'LOCAL_NET');
const pGlob = parsed.labels.find(l => l.text === 'GLOBAL_NET');
assert.ok(pLoc && pLoc.type === 'local', '(label tag parses as local');
assert.ok(pGlob && pGlob.type === 'global', '(global_label tag parses as global');
assert.strictEqual(pGlob.angle, 180, 'global label angle preserved');
assert.deepStrictEqual(pGlob.at, [30, 10], 'global label position preserved');

// legacy files without a type field keep working via parse defaults
parsed = Sch.parseSch(`(kicad_sch (version 20231120) (generator eeschema)
  (label "ONLY_LOCAL" (at 1 1 0) (effects (font (size 1.27 1.27))) (uuid "u4"))
)`, null);
assert.strictEqual(parsed.labels[0].type, 'local', 'plain (label files parse as local');

// ---- 4. round-trip stability ----
const rt1 = Sch.serializeSch(parsed);
const rt2 = Sch.serializeSch(Sch.parseSch(rt1, null));
assert.strictEqual(rt1, rt2, 'double round-trip is stable');

// ---- 5. both flavours name the net identically ----
sch = Sch.makeSchematic();
Sch.addWire(sch, [[10, 10], [30, 10]]);
Sch.addLabel(sch, 'SHARED', [10, 10], 0);            // local on left end
Sch.addLabel(sch, 'OTHER', [30, 10], 0, 'global');   // global on right end -> same wire!
// a local and a global with the SAME text must merge into one net; different
// texts on one wire merge into the same node but extractNets picks the first.
const nets = Sch.extractNets(sch, null);
assert.strictEqual(nets.length, 1, 'one wire = one node regardless of label types');
assert.ok(nets[0].labels.includes('SHARED'), 'node carries local label text');
assert.ok(nets[0].labels.includes('OTHER'), 'node carries global label text');

// two wires joined only by matching text across flavours -> same net
sch = Sch.makeSchematic();
Sch.addWire(sch, [[0, 0], [10, 0]]);
Sch.addWire(sch, [[50, 50], [60, 50]]);
Sch.addLabel(sch, 'LINK', [0, 0], 0);
Sch.addLabel(sch, 'LINK', [60, 50], 0, 'global');
const merged = Sch.extractNets(sch, null).filter(n => n.name === 'LINK');
assert.strictEqual(merged.length, 1, 'local+global with equal text share one net');
assert.strictEqual(merged[0].pins.length, 0, 'no pins involved');

console.log('test_sch_labels: all checks passed');
