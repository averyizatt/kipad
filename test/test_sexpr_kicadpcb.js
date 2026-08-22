'use strict';

/**
 * Tests for KipadSexpr (js/sexpr.js) and KipadPcb (js/kicad_pcb.js).
 * Run: node test/test_sexpr_kicadpcb.js
 */

const assert = require('assert');
const KipadSexpr = require('../js/sexpr.js');
const KipadPcb = require('../js/kicad_pcb.js');

function assertClose(a, b, msg, eps) {
  eps = eps === undefined ? 1e-3 : eps;
  assert.ok(Math.abs(a - b) <= eps, (msg || 'value') + ': expected ' + b + ', got ' + a);
}

function assertPt(p, q, msg) {
  assertClose(p[0], q[0], (msg || 'point') + '.x');
  assertClose(p[1], q[1], (msg || 'point') + '.y');
}

// =====================================================================
// test 1: sexpr parse/stringify round-trip on a realistic sample
// =====================================================================

const sample = [
  '# kipad test board',
  '(kicad_pcb',
  '  (version 20240108)',
  '  (generator "pcbnew")',
  '  (general',
  '    (thickness 1.6)',
  '  )',
  '  (nets 3',
  '    (net 0 "")',
  '    (net 1 "GND")',
  '    (net 2 "VCC")',
  '  )',
  '  (footprint "R_0603_1608Metric"',
  '    (layer "F.Cu")',
  '    (at 10 20 90)',
  '    (property "Reference" "R1" (at 0 -1) (layer "F.SilkS"))',
  '    (property "Value" "10k" (at 0 1) (layer "F.Fab"))',
  '    (pad "1" smd roundrect',
  '      (at -0.8 0)',
  '      (size 0.9 0.9)',
  '      (layers "F.Cu" "F.Paste" "F.Mask")',
  '      (roundrect_rratio 0.25)',
  '      (net 1 "GND")',
  '    )',
  '  )',
  '  (segment (start 10 21) (end 15 21) (width 0.25) (layer "F.Cu") (net 1))',
  ')'
].join('\n');

const t1 = KipadSexpr.parse(sample);
const t1b = KipadSexpr.parse(KipadSexpr.stringify(t1));
assert.deepStrictEqual(t1b, t1, 'test 1: sexpr parse/stringify round-trip');

// structure spot checks
assert.deepStrictEqual(KipadSexpr.parse('(a "b c" (d -1.5))'), ['a', { q: 'b c' }, ['d', '-1.5']]);
assert.strictEqual(
  KipadSexpr.stringify(['a', { q: 'b c' }, ['d', '-1.5']]),
  '(a\n  "b c"\n  (d\n    -1.5\n  )\n)'
);
assert.strictEqual(KipadSexpr.stringify(['empty']), '(empty)');
assert.strictEqual(KipadSexpr.stringify(['x', 'y']), '(x\n  y\n)');

// comments + CRLF
assert.deepStrictEqual(
  KipadSexpr.parse('# hi\r\n(nets 1\r\n  (net 0 "")\r\n)'),
  ['nets', '1', ['net', '0', { q: '' }]]
);

// escaped quotes/backslashes in strings
const esc = KipadSexpr.parse('(s "a\\"b\\\\c")');
assert.deepStrictEqual(esc, ['s', { q: 'a"b\\c' }]);
assert.deepStrictEqual(KipadSexpr.parse(KipadSexpr.stringify(esc)), esc);

// quoted layer names survive as quoted atoms
assert.deepStrictEqual(KipadSexpr.parse('(layer "F.Cu")'), ['layer', { q: 'F.Cu' }]);

console.log('test 1 passed (sexpr parse/stringify)');

// =====================================================================
// test 2: parseBoard on a hand-written .kicad_pcb
// =====================================================================

const file = [
  '# test board: 1 smd fp rotated 90deg, 1 tht fp, tracks, via, outline',
  '(kicad_pcb',
  '  (version 20240108)',
  '  (generator "pcbnew")',
  '  (general',
  '    (thickness 1.6)',
  '  )',
  '  (nets 3',
  '    (net 0 "")',
  '    (net 1 "GND")',
  '    (net 2 "VCC")',
  '  )',
  '  (footprint "R_0603_1608Metric"',
  '    (layer "F.Cu")',
  '    (at 10 20 90)',
  '    (property "Reference" "R1" (at 0 -1) (layer "F.SilkS"))',
  '    (property "Value" "10k" (at 0 1) (layer "F.Fab"))',
  '    (pad "1" smd roundrect',
  '      (at -0.8 0)',
  '      (size 0.9 0.9)',
  '      (layers "F.Cu" "F.Paste" "F.Mask")',
  '      (roundrect_rratio 0.25)',
  '      (net 1 "GND")',
  '    )',
  '    (pad "2" smd roundrect',
  '      (at 0.8 0)',
  '      (size 0.9 0.9)',
  '      (layers "F.Cu" "F.Paste" "F.Mask")',
  '      (roundrect_rratio 0.25)',
  '      (net 2 "VCC")',
  '    )',
  '  )',
  '  (footprint "PinHeader_1x02_P2.54mm_Vertical"',
  '    (layer "B.Cu")',
  '    (at 30 40)',
  '    (property "Reference" "J1" (at 0 -2) (layer "F.SilkS"))',
  '    (property "Value" "CONN" (at 0 2) (layer "F.Fab"))',
  '    (pad "1" thru_hole circle',
  '      (at -1.27 0)',
  '      (size 1.7 1.7)',
  '      (drill 1)',
  '      (layers "F.Cu" "B.Cu")',
  '      (net 1 "GND")',
  '    )',
  '    (pad "2" thru_hole circle',
  '      (at 1.27 0)',
  '      (size 1.7 1.7)',
  '      (drill 1)',
  '      (layers "F.Cu" "B.Cu")',
  '      (net 0 "")',
  '    )',
  '  )',
  '  (segment (start 10 21) (end 15 21) (width 0.25) (layer "F.Cu") (net 1))',
  '  (segment (start 15 21) (end 20 21) (width 0.25) (layer "F.Cu") (net 1))',
  '  (via (at 20 21) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))',
  '  (gr_line (start 0 0) (end 50 0) (layer "Edge.Cuts") (stroke (width 0.1) (type solid)))',
  '  (gr_line (start 50 0) (end 50 30) (layer "Edge.Cuts") (stroke (width 0.1) (type solid)))',
  ')'
].join('\n');

const board = KipadPcb.parseBoard(file);

// version + nets
assert.strictEqual(board.version, '20240108');
assert.strictEqual(board.nets.length, 3);
assert.deepStrictEqual(board.nets[0], { id: 0, name: '' });
assert.deepStrictEqual(board.nets[1], { id: 1, name: 'GND' });
assert.deepStrictEqual(board.nets[2], { id: 2, name: 'VCC' });

// footprint 1: R_0603 at (10,20) rotated 90deg
assert.strictEqual(board.footprints.length, 2);
const fp1 = board.footprints[0];
assert.strictEqual(fp1.id, 'F1');
assert.strictEqual(fp1.lib, 'R_0603_1608Metric');
assert.strictEqual(fp1.ref, 'R1');
assert.strictEqual(fp1.value, '10k');
assert.deepStrictEqual(fp1.at, [10, 20]);
assert.strictEqual(fp1.angle, 90);
assert.strictEqual(fp1.layer, 'F.Cu');
assert.strictEqual(fp1.pads.length, 2);

// pad 1: local (-0.8, 0) rotated 90deg CCW -> (0, -0.8) -> abs (10, 19.2)
const p1 = fp1.pads[0];
assert.strictEqual(p1.number, '1');
assert.strictEqual(p1.type, 'smd');
assert.strictEqual(p1.shape, 'roundrect');
assert.ok(Math.abs(p1.at[0] - 10) < 1e-9 && Math.abs(p1.at[1] - 19.2) < 1e-9, 'pad1 abs');
assert.strictEqual(p1.angle, 90);
assert.deepStrictEqual(p1.size, [0.9, 0.9]);
assert.strictEqual(p1.drill, null);
assert.ok(Math.abs(p1.radius - 0.225) < 1e-9, 'pad1 radius');
assert.deepStrictEqual(p1.layers, ['F.Cu', 'F.Paste', 'F.Mask']);
assert.strictEqual(p1.netId, 1);

// pad 2: local (0.8, 0) rotated 90deg -> (0, 0.8) -> abs (10, 20.8)
const p2 = fp1.pads[1];
assert.strictEqual(p2.number, '2');
assert.ok(Math.abs(p2.at[0] - 10) < 1e-9 && Math.abs(p2.at[1] - 20.8) < 1e-9, 'pad2 abs');
assert.strictEqual(p2.angle, 90);
assert.strictEqual(p2.netId, 2);
assert.strictEqual(p2.drill, null);

// footprint 2: connector at (30,40), no rotation
const fp2 = board.footprints[1];
assert.strictEqual(fp2.id, 'F2');
assert.strictEqual(fp2.lib, 'PinHeader_1x02_P2.54mm_Vertical');
assert.strictEqual(fp2.ref, 'J1');
assert.strictEqual(fp2.value, 'CONN');
assert.deepStrictEqual(fp2.at, [30, 40]);
assert.strictEqual(fp2.angle, 0);
assert.strictEqual(fp2.layer, 'B.Cu');
assert.strictEqual(fp2.pads.length, 2);

const jp1 = fp2.pads[0];
assert.strictEqual(jp1.number, '1');
assert.strictEqual(jp1.type, 'tht');
assert.strictEqual(jp1.shape, 'circle');
assert.ok(Math.abs(jp1.at[0] - 28.73) < 1e-9 && Math.abs(jp1.at[1] - 40) < 1e-9, 'jp1 abs');
assert.strictEqual(jp1.angle, 0);
assert.deepStrictEqual(jp1.size, [1.7, 1.7]);
assert.strictEqual(jp1.drill, 1);
assert.strictEqual(jp1.radius, null);
assert.deepStrictEqual(jp1.layers, ['F.Cu', 'B.Cu']);
assert.strictEqual(jp1.netId, 1);

const jp2 = fp2.pads[1];
assert.ok(Math.abs(jp2.at[0] - 31.27) < 1e-9 && Math.abs(jp2.at[1] - 40) < 1e-9, 'jp2 abs');
assert.strictEqual(jp2.netId, 0);

// tracks
assert.strictEqual(board.tracks.length, 2);
assert.strictEqual(board.tracks[0].id, 'T1');
assert.deepStrictEqual(board.tracks[0].start, [10, 21]);
assert.deepStrictEqual(board.tracks[0].end, [15, 21]);
assert.strictEqual(board.tracks[0].width, 0.25);
assert.strictEqual(board.tracks[0].layer, 'F.Cu');
assert.strictEqual(board.tracks[0].netId, 1);
assert.strictEqual(board.tracks[1].id, 'T2');
assert.deepStrictEqual(board.tracks[1].start, [15, 21]);
assert.deepStrictEqual(board.tracks[1].end, [20, 21]);
assert.strictEqual(board.tracks[1].netId, 1);

// via
assert.strictEqual(board.vias.length, 1);
assert.strictEqual(board.vias[0].id, 'V1');
assert.deepStrictEqual(board.vias[0].at, [20, 21]);
assert.strictEqual(board.vias[0].size, 0.6);
assert.strictEqual(board.vias[0].drill, 0.3);
assert.strictEqual(board.vias[0].netId, 1);

// outline: 2 chained gr_lines -> 1 polyline with 3 points
assert.strictEqual(board.outline.length, 1);
assert.strictEqual(board.outline[0].length, 3);
assert.deepStrictEqual(board.outline[0][0], [0, 0]);
assert.deepStrictEqual(board.outline[0][1], [50, 0]);
assert.deepStrictEqual(board.outline[0][2], [50, 30]);

console.log('test 2 passed (parseBoard)');

// =====================================================================
// test 3: serializeBoard -> parseBoard round-trip
// =====================================================================

const b = {
  version: '20240108',
  nets: [
    { id: 0, name: '' },
    { id: 1, name: 'GND' },
    { id: 2, name: 'VCC' }
  ],
  footprints: [
    {
      id: 'F1',
      lib: 'R_0603_1608Metric',
      ref: 'R1',
      value: '10k',
      at: [10, 20],
      angle: 90,
      layer: 'F.Cu',
      pads: [
        {
          number: '1', type: 'smd', shape: 'roundrect',
          at: [10, 19.2], angle: 90, size: [0.9, 0.9],
          drill: null, radius: 0.225,
          layers: ['F.Cu', 'F.Paste', 'F.Mask'], netId: 1
        },
        {
          number: '2', type: 'smd', shape: 'roundrect',
          at: [10, 20.8], angle: 90, size: [0.9, 0.9],
          drill: null, radius: 0.225,
          layers: ['F.Cu', 'F.Paste', 'F.Mask'], netId: 2
        }
      ]
    },
    {
      id: 'F2',
      lib: 'PinHeader_1x02_P2.54mm_Vertical',
      ref: 'J1',
      value: 'CONN',
      at: [30, 40],
      angle: 0,
      layer: 'B.Cu',
      pads: [
        {
          number: '1', type: 'tht', shape: 'circle',
          at: [28.73, 40], angle: 0, size: [1.7, 1.7],
          drill: 1, radius: null,
          layers: ['F.Cu', 'B.Cu'], netId: 1
        },
        {
          number: '2', type: 'tht', shape: 'circle',
          at: [31.27, 40], angle: 0, size: [1.7, 1.7],
          drill: 1, radius: null,
          layers: ['F.Cu', 'B.Cu'], netId: 0
        }
      ]
    }
  ],
  tracks: [
    { id: 'T1', start: [10, 21], end: [15, 21], width: 0.25, layer: 'F.Cu', netId: 1 },
    { id: 'T2', start: [15, 21], end: [20, 21], width: 0.25, layer: 'F.Cu', netId: 1 }
  ],
  vias: [
    { id: 'V1', at: [20, 21], size: 0.6, drill: 0.3, netId: 1 }
  ],
  outline: [
    [[0, 0], [50, 0], [50, 30], [0, 30]]
  ]
};

const text = KipadPcb.serializeBoard(b);
assert.ok(text.indexOf('(kicad_pcb') === 0, 'serialized text starts with (kicad_pcb');
assert.ok(text.indexOf('20240108') !== -1, 'serialized text contains version');

const b2 = KipadPcb.parseBoard(text);

// version + nets
assert.strictEqual(b2.version, b.version);
assert.strictEqual(b2.nets.length, 3);
assert.strictEqual(b2.nets[0].id, 0); assert.strictEqual(b2.nets[0].name, '');
assert.strictEqual(b2.nets[1].id, 1); assert.strictEqual(b2.nets[1].name, 'GND');
assert.strictEqual(b2.nets[2].id, 2); assert.strictEqual(b2.nets[2].name, 'VCC');

// footprints
assert.strictEqual(b2.footprints.length, b.footprints.length);
for (let i = 0; i < b.footprints.length; i++) {
  const a = b.footprints[i];
  const c = b2.footprints[i];
  assert.strictEqual(c.lib, a.lib, 'fp lib ' + i);
  assert.strictEqual(c.ref, a.ref, 'fp ref ' + i);
  assert.strictEqual(c.value, a.value, 'fp value ' + i);
  assertPt(c.at, a.at, 'fp at ' + i);
  assertClose(c.angle, a.angle, 'fp angle ' + i);
  assert.strictEqual(c.layer, a.layer, 'fp layer ' + i);
  assert.strictEqual(c.pads.length, a.pads.length, 'fp pads ' + i);
  for (let j = 0; j < a.pads.length; j++) {
    const pa = a.pads[j];
    const pc = c.pads[j];
    assert.strictEqual(pc.number, pa.number, 'pad number ' + i + '.' + j);
    assert.strictEqual(pc.type, pa.type, 'pad type ' + i + '.' + j);
    assert.strictEqual(pc.shape, pa.shape, 'pad shape ' + i + '.' + j);
    assertPt(pc.at, pa.at, 'pad at ' + i + '.' + j);
    assertClose(pc.angle, pa.angle, 'pad angle ' + i + '.' + j);
    assertClose(pc.size[0], pa.size[0], 'pad w ' + i + '.' + j);
    assertClose(pc.size[1], pa.size[1], 'pad h ' + i + '.' + j);
    assert.strictEqual(pc.drill, pa.drill, 'pad drill ' + i + '.' + j);
    if (pa.radius === null) {
      assert.strictEqual(pc.radius, null, 'pad radius ' + i + '.' + j);
    } else {
      assertClose(pc.radius, pa.radius, 'pad radius ' + i + '.' + j);
    }
    assert.deepStrictEqual(pc.layers, pa.layers, 'pad layers ' + i + '.' + j);
    assert.strictEqual(pc.netId, pa.netId, 'pad net ' + i + '.' + j);
  }
}

// tracks
assert.strictEqual(b2.tracks.length, b.tracks.length);
for (let i = 0; i < b.tracks.length; i++) {
  const a = b.tracks[i];
  const c = b2.tracks[i];
  assertPt(c.start, a.start, 'track start ' + i);
  assertPt(c.end, a.end, 'track end ' + i);
  assertClose(c.width, a.width, 'track width ' + i);
  assert.strictEqual(c.layer, a.layer, 'track layer ' + i);
  assert.strictEqual(c.netId, a.netId, 'track net ' + i);
}

// vias
assert.strictEqual(b2.vias.length, b.vias.length);
assertPt(b2.vias[0].at, b.vias[0].at, 'via at');
assertClose(b2.vias[0].size, b.vias[0].size, 'via size');
assertClose(b2.vias[0].drill, b.vias[0].drill, 'via drill');
assert.strictEqual(b2.vias[0].netId, b.vias[0].netId, 'via net');

// outline
assert.strictEqual(b2.outline.length, b.outline.length);
assert.strictEqual(b2.outline[0].length, b.outline[0].length, 'outline points');
for (let k = 0; k < b.outline[0].length; k++) {
  assertPt(b2.outline[0][k], b.outline[0][k], 'outline pt ' + k);
}

console.log('test 3 passed (serializeBoard round-trip)');
console.log('ALL TESTS PASSED');
