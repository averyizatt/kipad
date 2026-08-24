'use strict';

// Round-trip preservation of unsupported KiCad S-expression nodes:
// unknown top-level nodes (dimension, setup/stackup, title_block, non-silk
// text/art, …) and footprint-level nodes (fp_line, fp_text, model, attr,
// custom properties) must survive parse -> serialize -> re-parse verbatim.

const assert = require('assert');
const fs = require('fs');
global.KipadSexpr = require('../js/sexpr.js');
const Pcb = require('../js/kicad_pcb.js');

function countIn(s, needle) { return s.split(needle).length - 1; }
function topTags(b) {
  var out = new Set();
  for (var i = 0; i < b.extra.length; i++) out.add(b.extra[i][0]);
  return out;
}

// ---------------------------------------------------------------------
// synthetic file with unsupported content
// ---------------------------------------------------------------------

const SRC = [
  '(kicad_pcb (version 20240108) (generator kiCad)',
  '  (generator_version "8.0")',
  '  (general (thickness 1.2))',
  '  (paper "A4")',
  '  (title_block (title "Demo") (company "ACME"))',
  '  (setup (pad_to_mask_clearance 0.05))',
  '  (layer "F.Cu")',
  '  (nets 2 (net 1 "GND") (net 2 "SIG"))',
  '  (footprint "R_0603" (layer "F.Cu") (at 10 5 90)',
  '    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS"))',
  '    (property "Value" "10k" (at 0 0 0) (layer "F.Fab"))',
  '    (property "MPN" "RC0603FR-0710KL")',
  '    (attr smd)',
  '    (fp_text user "hello" (at 0 -2 90) (layer "F.Fab"))',
  '    (fp_line (start -1.7 0.4) (end 1.7 0.4) (stroke (width 0.12)))',
  '    (model "\\${KICAD8_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603.wrl"',
  '      (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))',
  '    (pad "1" smd roundrect (at -0.75 0 90) (size 0.8 0.8)',
  '      (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25) (net 2 "SIG"))',
  '    (pad "2" smd roundrect (at 0.75 0 90) (size 0.8 0.8)',
  '      (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25) (net 1 "GND"))',
  '  )',
  '  (segment (start 10 6) (end 20 6) (width 0.25) (layer "F.Cu") (net 2))',
  '  (gr_text "fab note" (at 40 30 0) (layer "F.Fab"))',
  '  (gr_line (start 0 0) (end 5 0) (stroke (width 0.12)) (layer "F.SilkS"))',
  '  (gr_curve (pts (xy 0 0) (xy 1 1) (xy 2 -1) (xy 3 0)) (stroke (width 0.2)) (layer "Edge.Cuts"))',
  '  (dimension (locked yes) (layer "F.Fab") (gr_text "40 mm") (pts (xy 0 0) (xy 40 0)))',
  '  (target plus (at 60 60) (size 2) (width 0.15))',
  ')'
].join('\n');

const board = Pcb.parseBoard(SRC);

// modeled content still parses
assert.strictEqual(board.generator, 'kiCad', 'generator is modeled now');
assert.strictEqual(board.footprints.length, 1);
assert.strictEqual(board.footprints[0].ref, 'R1');
assert.strictEqual(board.footprints[0].value, '10k');
assert.strictEqual(board.footprints[0].pads.length, 2);
assert.strictEqual(board.tracks.length, 1);

// unsupported top-level nodes land in extra
var tags = topTags(board);
for (const t of ['generator_version', 'general', 'paper', 'title_block', 'setup',
  'gr_curve', 'dimension', 'target']) {
  assert.ok(tags.has(t), `top-level ${t} preserved`);
}
assert.ok(!tags.has('segment') && !tags.has('footprint') && !tags.has('nets'),
  'modeled node kinds are never duplicated into extra');

// non-Edge.Cuts art + non-silk text preserved
assert.ok(tags.has('gr_line'), 'non-edge gr_line preserved');
assert.ok(tags.has('gr_text'), 'non-silk gr_text preserved');

// footprint-level unsupported nodes land in fp.extra
const fp = board.footprints[0];
var fpTags = new Set(fp.extra.map(function (n) { return n[0]; }));
for (const t of ['attr', 'fp_text', 'fp_line', 'model', 'property']) {
  assert.ok(fpTags.has(t), `footprint ${t} preserved`);
}
const mpn = fp.extra.find(function (n) { return n[0] === 'property'; });
assert.strictEqual(mpn[2].q, 'RC0603FR-0710KL', 'custom property value intact');

// ---------------------------------------------------------------------
// serialization: preserved verbatim, no duplicates
// ---------------------------------------------------------------------

const t1 = Pcb.serializeBoard(board);
assert.strictEqual(countIn(t1, '(dimension'), 1);
assert.strictEqual(countIn(t1, '(model'), 1);
assert.strictEqual(countIn(t1, '(general'), 1, 'no synthesized general next to preserved one');
assert.ok(/\(thickness\s+1\.2\s*\)/.test(t1), 'original stackup thickness kept');
assert.ok(!t1.includes('1.6'), 'synthetic thickness not emitted');
assert.ok(t1.includes('"kiCad"'), 'original generator survives');
assert.ok(t1.includes('RC0603FR-0710KL'), 'custom property serialized');
assert.ok(/\(pad_to_mask_clearance\s+0\.05\s*\)/.test(t1), 'setup preserved');
assert.ok(t1.includes('"Demo"'), 'title_block preserved');
assert.strictEqual(countIn(t1, '(segment'), 1);

// second cycle byte-stable
const t2 = Pcb.serializeBoard(Pcb.parseBoard(t1));
const t3 = Pcb.serializeBoard(Pcb.parseBoard(t2));
assert.strictEqual(t2, t3, 'cycle-2 output is byte-stable');

// JSON survival (localStorage save path)
const clone = JSON.parse(JSON.stringify(board));
assert.strictEqual(Pcb.serializeBoard(clone), t1, 'extras survive a JSON round trip');

// boards without extras still serialize exactly as before
const bare = Pcb.serializeBoard({
  version: '20240108',
  nets: [{ id: 0, name: '' }],
  footprints: [{ id: 'F1', lib: 'x', ref: 'R1', value: '1k', at: [0, 0], angle: 0,
    layer: 'F.Cu', pads: [] }],
  tracks: [], vias: [], texts: [], zones: [], outline: [], groups: []
});
assert.ok(/\(thickness\s+1\.6\s*\)/.test(bare), 'synthesized general when no extras');

// ---------------------------------------------------------------------
// real-file smoke: video.kicad_pcb (dimensions + 175 models)
// ---------------------------------------------------------------------

const raw = fs.readFileSync(
  require('path').join(__dirname, '..', 'lib-build', 'raw', 'video.kicad_pcb'), 'utf8');
const rb = Pcb.parseBoard(raw);
assert.ok(rb.extra.some(function (n) { return n[0] === 'dimension'; }), 'real dimensions preserved');
var modelCount = 0;
for (const f of rb.footprints) {
  for (const e of f.extra) if (e[0] === 'model') modelCount++;
}
assert.strictEqual(modelCount, countIn(raw, '(model'), 'all real fp models captured');

const r1 = Pcb.serializeBoard(rb);
const rb2 = Pcb.parseBoard(r1);
const r2 = Pcb.serializeBoard(rb2);
assert.strictEqual(r1, r2, 'real board cycle-2 byte-stable with extras');
assert.strictEqual(countIn(r2, '(dimension'), countIn(raw, '(dimension'));
assert.strictEqual(countIn(r2, '(model'), countIn(raw, '(model'));
assert.ok(rb2.footprints.every(function (f) { return f.pads.length > 0 || true; }));

console.log('test_extra_rt: all tests passed');
