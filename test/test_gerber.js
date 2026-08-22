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
assert.deepStrictEqual(Object.keys(all).sort(), ['B.Cu', 'Edge.Cuts', 'F.Cu'],
  'exportAll keys');

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

console.log('All Gerber exporter tests passed.');
