'use strict';

/**
 * KiCad 10 format regression tests:
 *  - named nets without a (nets ...) block: (net "VCC") in pads/segments/vias
 *  - wildcard pad layers: (layers "*.Cu" "*.Mask")
 *  - round-trip through serializeBoard
 * Run: cd kipad && node test/test_kicad10.js
 */

const assert = require('assert');
const KipadPcb = require('../js/kicad_pcb.js');

// Minimal KiCad 10 style file (version 20260206 / generator pcbnew 10.0)
const K10 = `(kicad_pcb
\t(version 20260206)
\t(generator "pcbnew")
\t(generator_version "10.0")
\t(general
\t\t(thickness 1.6)
\t)
\t(footprint "Resistor_SMD:R_0603_1608Metric"
\t\t(layer "F.Cu")
\t\t(at 10 20)
\t\t(property "Reference" "R1" (at 0 -1.43) (layer "F.SilkS"))
\t\t(property "Value" "10k" (at 0 1.43) (layer "F.Fab"))
\t\t(pad "1" smd roundrect
\t\t\t(at -0.825 0)
\t\t\t(size 0.8 0.95)
\t\t\t(layers "F.Cu" "F.Paste" "F.Mask")
\t\t\t(roundrect_rratio 0.25)
\t\t\t(net "VCC")
\t\t\t(pintype "passive")
\t\t)
\t\t(pad "2" smd roundrect
\t\t\t(at 0.825 0)
\t\t\t(size 0.8 0.95)
\t\t\t(layers "F.Cu" "F.Paste" "F.Mask")
\t\t\t(roundrect_rratio 0.25)
\t\t\t(net "GND")
\t\t\t(pintype "passive")
\t\t)
\t)
\t(footprint "MountingHole:MountingHole_3.2mm_M3"
\t\t(layer "F.Cu")
\t\t(at 40 40)
\t\t(property "Reference" "H1" (at 0 -1.8) (layer "F.SilkS"))
\t\t(property "Value" "MountingHole_3.2mm_M3" (at 0 1.8) (layer "F.Fab"))
\t\t(pad "" np_thru_hole circle
\t\t\t(at 0 0)
\t\t\t(size 3.2 3.2)
\t\t\t(drill 3.2)
\t\t\t(layers "*.Cu" "*.Mask")
\t\t\t(remove_unused_layers no)
\t\t)
\t)
\t(segment
\t\t(start 10 19.175)
\t\t(end 20 19.175)
\t\t(width 0.25)
\t\t(layer "F.Cu")
\t\t(net "VCC")
\t)
\t(via
\t\t(at 20 19.175)
\t\t(size 0.6)
\t\t(drill 0.3)
\t\t(layers "F.Cu" "B.Cu")
\t\t(capping no)
\t\t(filling no)
\t\t(net "VCC")
\t)
\t(gr_line
\t\t(start 0 0)
\t\t(end 50 0)
\t\t(layer "Edge.Cuts")
\t\t(stroke (width 0.1) (type solid))
\t)
\t(gr_line
\t\t(start 50 0)
\t\t(end 50 30)
\t\t(layer "Edge.Cuts")
\t\t(stroke (width 0.1) (type solid))
\t)
)
`;

const board = KipadPcb.parseBoard(K10);

// ---- 1. nets built from named references (no (nets) block) ----
assert.strictEqual(board.nets.length, 3, 'nets: 0("") + GND + VCC');
const byName = {};
for (const n of board.nets) byName[n.name] = n.id;
assert.ok(byName.VCC !== undefined, 'VCC net exists');
assert.ok(byName.GND !== undefined, 'GND net exists');
assert.strictEqual(byName[''], 0, 'empty net is id 0');

// ---- 2. pads resolved named nets ----
assert.strictEqual(board.footprints.length, 2, 'two footprints');
const r1 = board.footprints[0];
assert.strictEqual(r1.lib, 'Resistor_SMD:R_0603_1608Metric');
assert.strictEqual(r1.ref, 'R1');
assert.strictEqual(r1.pads[0].netId, byName.VCC, 'pad 1 on VCC');
assert.strictEqual(r1.pads[1].netId, byName.GND, 'pad 2 on GND');

// ---- 3. wildcard layers expanded ----
const h1 = board.footprints[1];
assert.strictEqual(h1.lib, 'MountingHole:MountingHole_3.2mm_M3');
assert.deepStrictEqual(h1.pads[0].layers, ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask'], '*.Cu *.Mask expanded');
assert.strictEqual(h1.pads[0].drill, 3.2, 'np_thru_hole drill kept');

// ---- 4. segments + vias ----
assert.strictEqual(board.tracks.length, 1);
assert.strictEqual(board.tracks[0].netId, byName.VCC, 'track on VCC');
assert.strictEqual(board.vias.length, 1);
assert.strictEqual(board.vias[0].netId, byName.VCC, 'via on VCC');

// ---- 5. round trip keeps nets ----
const text = KipadPcb.serializeBoard(board);
const b2 = KipadPcb.parseBoard(text);
assert.strictEqual(b2.nets.length, 3, 'roundtrip nets');
assert.strictEqual(b2.footprints.length, 2, 'roundtrip footprints');
assert.strictEqual(b2.footprints[0].pads[0].netId, byName.VCC, 'roundtrip pad net');
assert.strictEqual(b2.tracks[0].netId, byName.VCC, 'roundtrip track net');

console.log('KICAD 10 FORMAT TESTS PASSED');
