'use strict';

/* Node test for the Kipad Gerber RS-274X exporter. Run:
 *   cd /home/thefrogbrain/.openclaw/sandbox/kipad && node test/test_gerber.js
 */

const assert = require('assert');
const Gerber = require('../js/gerber.js');

// mm -> integer in 1e-4 mm units (same scaling the exporter uses)
function fmt(mm) {
  return String(Math.round(mm * 10000));
}

function buildBoard() {
  return {
    version: '20240108',
    nets: [
      { id: 1, name: 'GND' },
      { id: 2, name: 'VCC' },
      { id: 3, name: 'SIG' }
    ],
    footprints: [
      {
        id: 'fp-roundrect', lib: 'test-lib', ref: 'R1', value: '10k',
        at: [10, 10], angle: 0, layer: 'F.Cu',
        pads: [
          {
            number: '1', type: 'smd', shape: 'roundrect',
            at: [10, 10], angle: 0, size: [1.0, 0.6], drill: null, radius: 0.2,
            layers: ['F.Cu', 'F.Paste', 'F.Mask'], netId: 1
          }
        ]
      },
      {
        id: 'fp-rect', lib: 'test-lib', ref: 'R2', value: '10k',
        at: [20, 20], angle: 0, layer: 'B.Cu',
        pads: [
          {
            number: '1', type: 'smd', shape: 'rect',
            at: [20, 20], angle: 0, size: [1.2, 0.8], drill: null, radius: null,
            layers: ['B.Cu', 'B.Paste', 'B.Mask'], netId: 2
          }
        ]
      }
    ],
    tracks: [
      { id: 1, start: [0, 0], end: [5, 0], width: 0.25, layer: 'F.Cu', netId: 1 },
      { id: 2, start: [5, 0], end: [10, 0], width: 0.5, layer: 'F.Cu', netId: 1 }
    ],
    vias: [
      { id: 1, at: [12, 12], size: 0.6, drill: 0.3, netId: 3 }
    ],
    outline: [
      [[0, 0], [50, 0], [50, 40], [0, 40], [0, 0]]
    ]
  };
}

const board = buildBoard();
const all = Gerber.exportAll(board);

// ---- 1. exportAll returns keys F.Cu, B.Cu, Edge.Cuts ---------------------
assert.deepStrictEqual(Object.keys(all).sort(),
  ['B.Cu', 'B.Mask', 'B.Paste', 'B.SilkS', 'Edge.Cuts', 'F.Cu', 'F.Mask', 'F.Paste', 'F.SilkS'],
  'exportAll keys (nine-layer fabrication set)');

// ---- 2. F.Cu header and end-of-file -------------------------------------
const fcu = all['F.Cu'];
assert.ok(fcu.includes('%FSLAX44Y44*%'), 'FS header present');
assert.ok(fcu.includes('%MOMM*%'), 'MO header present');
assert.ok(fcu.includes('M02*'), 'M02 end of file present');

// ---- 3. F.Cu content -----------------------------------------------------
const roundrectPad = board.footprints[0].pads[0];

assert.ok(/ADD\d+O,/.test(fcu), 'O (obround) aperture for roundrect pad');
assert.ok(
  fcu.includes('X' + fmt(roundrectPad.at[0]) + 'Y' + fmt(roundrectPad.at[1]) + 'D03*'),
  'pad flashed at its absolute coordinate in 1e-4 mm units'
);

const wideTrack = board.tracks[1]; // width 0.5
assert.ok(
  new RegExp('%ADD\\d+C,' + wideTrack.width.toFixed(6) + '\\*%').test(fcu),
  'line aperture for the wider track'
);

assert.ok(/D01\*/.test(fcu), 'D01 draw commands present');

// ---- 4. Edge.Cuts outline coordinates ------------------------------------
const ec = all['Edge.Cuts'];
const outline = board.outline[0];
assert.ok(
  ec.includes('X' + fmt(outline[0][0]) + 'Y' + fmt(outline[0][1]) + 'D02*'),
  'outline start point moved to'
);
assert.ok(
  ec.includes('X' + fmt(outline[2][0]) + 'Y' + fmt(outline[2][1]) + 'D01*'),
  'outline corner drawn to'
);
assert.ok(/%ADD\d+C,0\.150000/.test(ec), 'Edge.Cuts 0.15 mm line aperture');

// ---- 5. getApertures ------------------------------------------------------
const apF = Gerber.getApertures(board, 'F.Cu');

const oAp = Object.keys(apF).map(function (k) { return apF[k]; })
  .find(function (a) { return a.shape === 'O'; });
assert.ok(oAp, 'F.Cu has an O aperture for the roundrect pad');
assert.deepStrictEqual(oAp.size, [1.0, 0.6], 'O aperture size');
assert.strictEqual(oAp.drill, null, 'smd pad has no drill');

const wideAp = Object.keys(apF).map(function (k) { return apF[k]; })
  .find(function (a) { return a.shape === 'C' && a.size[0] === 0.5; });
assert.ok(wideAp, 'F.Cu line aperture for the wider track (0.5)');

const viaAp = Object.keys(apF).map(function (k) { return apF[k]; })
  .find(function (a) { return a.shape === 'C' && a.size[0] === 0.6; });
assert.ok(viaAp, 'F.Cu via aperture (0.6)');

const apB = Gerber.getApertures(board, 'B.Cu');
const rAp = Object.keys(apB).map(function (k) { return apB[k]; })
  .find(function (a) { return a.shape === 'R'; });
assert.ok(rAp, 'B.Cu has an R aperture for the rect pad');
assert.deepStrictEqual(rAp.size, [1.2, 0.8], 'R aperture size');

// ==== 6. Mask / Paste / Silk layers ========================================

function buildFabBoard() {
  return {
    nets: [],
    outline: [[[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]]],
    footprints: [
      {
        id: 'fp1', lib: 'libA', ref: 'R1', value: 'x', at: [5, 4], angle: 0, layer: 'F.Cu',
        pads: [
          { number: '1', type: 'smd', shape: 'rect', at: [5, 4], angle: 0, size: [1.0, 0.6], drill: null, layers: ['F.Cu', 'F.Paste', 'F.Mask'], netId: null },
          { number: '2', type: 'tht', shape: 'circle', at: [7, 4], angle: 0, size: [2.0, 2.0], drill: 1.0, layers: ['*.Cu', '*.Mask'], netId: null }
        ],
        silk: []
      },
      {
        id: 'fp2', lib: '', ref: 'R2', value: 'y', at: [3, 6], angle: 90, layer: 'B.Cu',
        pads: [
          { number: '1', type: 'smd', shape: 'rect', at: [3, 6], angle: 0, size: [0.8, 0.5], drill: null, layers: ['B.Cu', 'B.Paste', 'B.Mask'], netId: null }
        ],
        silk: [
          { type: 'line', pts: [[-1, 0], [1, 0]] },   // stored with the default F.SilkS label
          { type: 'text', at: [0, 1.5], size: 1.2, text: 'R2' }
        ]
      }
    ],
    tracks: [],
    vias: [{ id: 1, at: [9, 1], size: 0.6, drill: 0.3, netId: null }]
  };
}

const fab = buildFabBoard();
const R1P1 = 'X' + fmt(5) + 'Y' + fmt(4) + 'D03*';
const R1P2 = 'X' + fmt(7) + 'Y' + fmt(4) + 'D03*';
const R2P1 = 'X' + fmt(3) + 'Y' + fmt(6) + 'D03*';
const VIA = 'X' + fmt(9) + 'Y' + fmt(1) + 'D03*';

// ---- solder mask ----------------------------------------------------------
const fmask = Gerber.exportMaskLayer(fab, 'F.Mask');
assert.ok(fmask.includes(R1P1), 'front SMD pad opens F.Mask');
assert.ok(/%ADD\d+R,1\.100000X0\.700000\*%/.test(fmask), 'mask aperture expanded by 0.05 mm per edge');
assert.ok(fmask.includes(R1P2), '*.Cu THT pad opens F.Mask too');
assert.ok(/%ADD\d+C,2\.100000\*%/.test(fmask), 'THT mask opening is an expanded circle');
assert.ok(!fmask.includes(VIA), 'vias stay tented (no F.Mask opening)');
assert.ok(!fmask.includes(R2P1), 'back-side pad not on F.Mask');

const bmask = Gerber.exportMaskLayer(fab, 'B.Mask');
assert.ok(bmask.includes(R2P1), 'back SMD pad opens B.Mask');
assert.ok(bmask.includes(R1P2), '*.Cu THT pad opens B.Mask as well');
assert.ok(!bmask.includes(R1P1), 'front-only SMD pad not on B.Mask');

// ---- solder paste ----------------------------------------------------------
const fpaste = Gerber.exportPasteLayer(fab, 'F.Paste');
assert.ok(fpaste.includes(R1P1), 'front SMD pad gets paste');
assert.ok(/%ADD\d+R,1\.000000X0\.600000\*%/.test(fpaste), 'paste aperture matches copper size exactly');
assert.ok(!fpaste.includes(R1P2), 'THT pad gets no paste');
assert.ok(!fpaste.includes(R2P1), 'back pad not on F.Paste');

const bpaste = Gerber.exportPasteLayer(fab, 'B.Paste');
assert.ok(bpaste.includes(R2P1), 'back SMD pad gets paste');
assert.ok(!bpaste.includes(R1P2), 'THT pad excluded from both pastes');

// ---- side derived from copper membership, not mask/paste labels -----------
const minimal = buildFabBoard();
minimal.footprints[0].pads[0].layers = ['F.Cu']; // no F.Mask / F.Paste entries
assert.ok(Gerber.exportMaskLayer(minimal, 'F.Mask').includes(R1P1),
  'pad with bare [F.Cu] still opens F.Mask');
assert.ok(!Gerber.exportMaskLayer(minimal, 'B.Mask').includes(R1P1),
  'bare [F.Cu] pad does not open B.Mask');
assert.ok(Gerber.exportPasteLayer(minimal, 'F.Paste').includes(R1P1),
  'pad with bare [F.Cu] still gets paste');

// ---- silkscreen ------------------------------------------------------------
const stubLib = {
  getFootprint: function (name) {
    return name === 'libA' ? {
      silk: [
        { type: 'line', pts: [[-3, 2], [3, 2]] },
        { type: 'rect', start: [-3, -2], end: [3, 2] },
        { type: 'circle', at: [0, 0], r: 2 },
        { type: 'text', at: [0, 3], size: 1.5, text: 'libA' } // skipped: no stroking yet
      ]
    } : null;
  }
};

const fsilk = Gerber.exportSilkLayer(fab, 'F.SilkS', stubLib.getFootprint);
assert.ok(fsilk.startsWith('%FSLAX44Y44*%'), 'silk header present');
assert.ok(/%ADD10C,0\.120000\*%/.test(fsilk), 'single fixed-width stroke aperture');
assert.ok(!/D03\*/.test(fsilk), 'silkscreen has no flashes');
const fStrokes = (fsilk.match(/D01\*/g) || []).length;
assert.strictEqual(fStrokes,
  1 /* line */ + 4 /* rect */ + 32 /* circle chords */,
  'line + rect + 32-chord circle drawn; text item skipped');

const bsilk = Gerber.exportSilkLayer(fab, 'B.SilkS', stubLib.getFootprint);
assert.strictEqual((bsilk.match(/D01\*/g) || []).length, 1, 'only fp2 art lands on B.SilkS');
assert.ok(bsilk.includes('X30000Y50000D02*'),
  'fp2 default-labelled art rotated to world (local [-1,0] @90 deg -> [3,5]) and mapped to the back side');
assert.ok(!bsilk.includes('X30000Y60000'), 'art start point is the rotated one, not the unrotated local point');
assert.ok(!fsilk.includes('X30000Y50000'), 'fp2 back art not duplicated onto F.SilkS');
assert.ok(!fsilk.includes('X15000Y60000') && !bsilk.includes('X15000Y60000'),
  'silk text item coords never emitted');

// ---- every layer is a complete RS-274X image -------------------------------
const fabAll = Gerber.exportAll(fab, stubLib.getFootprint);
for (const key of Object.keys(fabAll)) {
  assert.ok(fabAll[key].endsWith('M02*\n'), key + ' ends with M02');
  assert.ok(fabAll[key].includes('%MOMM*%'), key + ' declares millimetres');
}

// ---- real-board smoke: all nine generated files parse in the viewer --------
const fs = require('fs');
const path = require('path');
const realPath = path.join(__dirname, '..', 'lib-build', 'real-board.kicad_pcb');
if (fs.existsSync(realPath)) {
  const kicad = require('../js/kicad_pcb.js');
  const gv = require('../js/gerber_viewer.js');
  const realBoard = kicad.parseBoard(fs.readFileSync(realPath, 'utf8'));
  const realOut = Gerber.exportAll(realBoard);
  for (const key of Object.keys(realOut)) {
    const img = gv.parse(realOut[key]);
    assert.ok(img && Array.isArray(img.ops), key + ' parses in the gerber viewer');
  }
  assert.ok(gv.parse(realOut['F.Cu']).ops.length > 10, 'real board copper has plenty of ops');
  console.log('Real-board smoke: nine layers parsed (' +
    Object.keys(realOut).map(function (k) { return k + '=' + gv.parse(realOut[k]).ops.length; }).join(', ') + ')');
}

console.log('All Gerber exporter tests passed.');
