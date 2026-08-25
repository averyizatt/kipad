'use strict';

/* Node test for the KipadStrokeFont single-stroke vector font and its use
 * in the Gerber silkscreen exporter. Run: node test/test_strokefont.js */

const assert = require('assert');
const SF = require('../js/strokefont.js');
const Gerber = require('../js/gerber.js');

let checks = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

/* ---- glyph coverage ---------------------------------------------------- */

for (let code = 32; code <= 126; code++) {
  const ch = String.fromCharCode(code);
  if (ch === ' ') continue;
  const g = SF.glyphOf(ch);
  ok(g && Array.isArray(g.s) && g.s.length >= 1,
    'glyph defined for ' + JSON.stringify(ch) + ' (code ' + code + ')');
  for (const pl of g.s) {
    ok(Array.isArray(pl) && pl.length >= 2,
      'glyph polylines have >=2 points for ' + JSON.stringify(ch));
    for (const p of pl) {
      ok(p[0] >= -0.06 && p[0] <= g.w + 0.06,
        'x bounds for ' + JSON.stringify(ch) + ': ' + p[0]);
      ok(p[1] >= -1.1 && p[1] <= 0.35,
        'y bounds for ' + JSON.stringify(ch) + ': ' + p[1]);
    }
  }
}
ok(SF.glyphCount >= 94, 'at least 94 printable-ASCII glyphs defined');

/* ---- metrics ------------------------------------------------------------ */

ok(SF.measure('') === 0, 'empty string measures 0');
ok(SF.measure(' ') > 0, 'space has positive advance');
ok(SF.measure('i') < SF.measure('W'), 'narrow glyph narrower than wide');
const wAB = SF.measure('AB');
const wA = SF.measure('A'), wB = SF.measure('B');
ok(Math.abs(wAB - (wA + SF.CHAR_GAP + wB)) < 1e-9,
  'measure adds one inter-char gap between glyphs');

/* ---- layout ------------------------------------------------------------- */

ok(SF.strokesFor('').length === 0, 'strokesFor("") empty');
ok(SF.strokesFor('   ').length === 0, 'strokesFor(whitespace) empty');

function allPts(polys) {
  return polys.reduce((a, pl) => a.concat(pl), []);
}

// justify left puts the pen at x (ink starts where the first glyph does)
let minX = Math.min(...allPts(SF.strokesFor('HELLO', { justify: 'left' })).map(p => p[0]));
ok(minX >= -0.01 && minX < 0.1, 'left justify starts at anchor x');

minX = Math.min(...allPts(SF.strokesFor('HELLO', { justify: 'right' })).map(p => p[0]));
ok(Math.abs(minX - -SF.measure('HELLO')) < 0.05,
  'right justify ends at anchor (minX == -width)');

const mid = SF.strokesFor('HELLO', { justify: 'center' });
const xs = allPts(mid).map(p => p[0]);
const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
ok(Math.abs(cx) < 0.15, 'center justify centres the run on the anchor');

// vAlign middle: cap letters span roughly half a cap height above/below
const ys = allPts(SF.strokesFor('H')).map(p => p[1]);
ok(Math.min(...ys) < -0.45 && Math.min(...ys) > -0.62,
  'middle vAlign puts cap top just below -size/2');
ok(Math.max(...ys) > 0.45 && Math.max(...ys) < 0.65,
  'middle vAlign puts baseline near +size/2');

// rotation: every rotated point equals manual matrix application
{
  const flat = SF.strokesFor('R7', { size: 2 });
  const rot = SF.strokesFor('R7', { size: 2, angle: 90, x: 10, y: -4 });
  const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
  let matched = 0;
  for (const [lx, ly] of allPts(flat)) {
    const ex = 10 + lx * c - ly * s;
    const ey = -4 + lx * s + ly * c;
    ok(rot.some(pl => pl.some(p =>
      Math.abs(p[0] - ex) < 1e-9 && Math.abs(p[1] - ey) < 1e-9)),
      'rotated point (' + lx.toFixed(3) + ',' + ly.toFixed(3) + ') present');
    matched++;
    if (matched > 12) break; // sample enough points
  }
}

// dots expand to drawable segments
{
  const i = SF.strokesFor('i', { size: 1 });
  const lens = i.map(pl => Math.hypot(pl[pl.length - 1][0] - pl[0][0],
    pl[pl.length - 1][1] - pl[0][1]));
  ok(lens.every(l => l > 0.01), 'every polyline in "i" has nonzero length');
}

// unknown characters advance like blanks instead of crashing
{
  const known = SF.strokesFor('ab').length;
  const unk = SF.strokesFor('\u00e9\u2022');
  ok(Array.isArray(unk), 'unknown chars do not crash');
  ok(SF.strokesFor('\u00e9').length === 0, 'unknown-only string yields no strokes');
  ok(known > 0, 'known string yields strokes');
}

/* ---- gerber silkscreen integration -------------------------------------- */

function silkBoard() {
  return {
    nets: [],
    footprints: [
      {
        id: 'fp1', lib: 'test-lib', ref: 'R1', value: '10k',
        at: [10, 10], angle: 0, layer: 'F.Cu', pads: []
      },
      {
        id: 'fp2', lib: 'back-lib', ref: 'B1', value: 'x',
        at: [30, 10], angle: 0, layer: 'B.Cu', pads: []
      }
    ],
    texts: [],
    tracks: [], vias: [], zones: []
  };
}

function countD01(img) {
  return img.split('\n').filter(l => l.endsWith('D01*')).length;
}

const LIBS = {
  'test-lib': { courtyard: { min: [-2, -1.5], max: [2, 1.5] }, silk: [{ type: 'line', layer: 'F.SilkS', pts: [[0, 0], [1, 0]] }] },
  'back-lib': { courtyard: { min: [-2, -1.5], max: [2, 1.5] }, silk: [] }
};
const getFp = name => LIBS[name] || null;

// baseline: refs + art line only
{
  const b = silkBoard();
  const f = Gerber.exportSilkLayer(b, 'F.SilkS', getFp);
  const bk = Gerber.exportSilkLayer(b, 'B.SilkS', getFp);
  ok(countD01(f) >= 2, 'baseline F.SilkS exports art line + ref strokes');
  // R1 ref sits above the courtyard at y = 10 - (1.5 + 0.8); some stroke
  // vertex must land near that band
  const band = f.split('\n').some(l => l.startsWith('X') && l.endsWith('D01*') &&
    Math.abs(parseInt(l.match(/Y(-?\d+)/)[1]) / 10000 - 7.7) < 0.25);
  ok(band, 'ref label stroked around expected offset above courtyard');

  ok(countD01(bk) > 0, 'B-side footprint gets its ref on B.SilkS');
  ok(!bk.includes('X100000Y100000'), 'front silk art never lands on back side');
}

// board text lands on its own layer with its own width aperture
{
  const b = silkBoard();
  b.texts.push({
    id: 'T1', text: 'GND', at: [20, 20], layer: 'F.SilkS',
    size: 1.5, thickness: 0.3, angle: 0, justify: 'center'
  });
  const before = countD01(Gerber.exportSilkLayer(silkBoard(), 'F.SilkS', getFp));
  const f = Gerber.exportSilkLayer(b, 'F.SilkS', getFp);
  const bk = Gerber.exportSilkLayer(b, 'B.SilkS', getFp);
  ok(countD01(f) > before, 'board text adds draws to F.SilkS');
  ok(/%ADD\d+C,0\.300000\*%/.test(f), 'text thickness aperture defined');
  // GND strokes must exist somewhere on F but not B
  ok(!/%ADD\d+C,0\.300000\*%/.test(bk), 'no text aperture on untouched side');
}

// rotated text differs from unrotated at the same anchor
{
  const mk = angle => {
    const b = silkBoard();
    b.texts.push({ id: 'T', text: 'ABC', at: [20, 20], layer: 'F.SilkS', size: 2, thickness: 0.3, angle, justify: 'center' });
    return Gerber.exportSilkLayer(b, 'F.SilkS', getFp);
  };
  ok(mk(0) !== mk(90), 'rotated text produces different geometry');
}

// footprint art text items are stroked through fpToWorld
{
  const b = silkBoard();
  LIBS['test-lib'].silk.push({ type: 'text', at: [0, -2], text: '10k', size: 1 });
  try {
    const f = Gerber.exportSilkLayer(b, 'F.SilkS', getFp);
    ok(countD01(f) > 3, 'art text item contributes strokes');
  } finally {
    LIBS['test-lib'].silk.pop();
  }
}

console.log('OK — ' + checks + ' checks passed (strokefont + silk text)');
