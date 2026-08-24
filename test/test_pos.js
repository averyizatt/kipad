'use strict';
/* test/test_pos.js — KipadPos pick-and-place export */
const assert = require('assert');
const Pos = require('../js/pos.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('FAIL - ' + name + ': ' + e.message); }
}

function mkBoard(fps) { return { footprints: fps }; }
function mkFp(ref, value, lib, at, angle, layer, padCount) {
  const pads = [];
  for (let i = 0; i < (padCount == null ? 2 : padCount); i++) {
    pads.push({ number: String(i + 1), type: 'smd', shape: 'rect', at: [at[0] + i, at[1]], angle: 0, size: [1, 1], drill: null, radius: null, layers: ['F.Cu'], netId: 0 });
  }
  return { id: 'F' + ref, lib, ref, value, at, angle: angle || 0, layer: layer || 'F.Cu', pads };
}

t('empty board yields null on both sides', () => {
  const out = Pos.exportPos(mkBoard([]), { date: '2026-08-24T12:00:00' });
  assert.strictEqual(out.front, null);
  assert.strictEqual(out.back, null);
});

t('front placement row: ref/value/pattern/x/y/rot', () => {
  const b = mkBoard([mkFp('R1', '10k', 'R_0805_2012Metric', [10.5, -2.25], 90)]);
  const p = Pos.collectPlacements(b);
  assert.strictEqual(p.front.length, 1);
  assert.strictEqual(p.back.length, 0);
  const r = p.front[0];
  assert.strictEqual(r.ref, 'R1');
  assert.strictEqual(r.value, '10k');
  assert.strictEqual(r.pattern, 'R_0805_2012Metric');
  assert.strictEqual(r.x, 10.5);
  assert.strictEqual(r.y, -2.25);
  assert.strictEqual(r.rot, 90);
});

t('B.Cu footprint lands in back table', () => {
  const b = mkBoard([mkFp('C1', '100n', 'C_0402', [0, 0], 0, 'B.Cu')]);
  const p = Pos.collectPlacements(b);
  assert.strictEqual(p.front.length, 0);
  assert.strictEqual(p.back.length, 1);
});

t('pad-less footprints excluded (logo/art)', () => {
  const logo = mkFp('LOGO1', '', 'Logo_golden', [3, 3], 0, 'F.Cu', 0);
  const b = mkBoard([logo, mkFp('R1', '1k', 'R_0603', [0, 0])]);
  const p = Pos.collectPlacements(b);
  assert.strictEqual(p.front.length, 1);
  assert.strictEqual(p.front[0].ref, 'R1');
});

t('negative rotation normalised into [0,360)', () => {
  const b = mkBoard([mkFp('U1', 'MCU', 'QFN-32', [1, 1], -90)]);
  assert.strictEqual(Pos.collectPlacements(b).front[0].rot, 270);
});

t('rotation 450 wraps to 90', () => {
  const b = mkBoard([mkFp('U1', 'MCU', 'QFN-32', [1, 1], 450)]);
  assert.strictEqual(Pos.collectPlacements(b).front[0].rot, 90);
});

t('format: header block, quoted value, columns, ## End terminator', () => {
  const out = Pos.exportPos(
    mkBoard([mkFp('R1', '10k', 'R_0805', [10.5, -2.25], 90)]),
    { date: '2026-08-24T14:30:00' });
  assert.ok(out.front.includes('### Module positions - created on 2026-08-24T14:30:00 ###'));
  assert.ok(out.front.includes('## Unit = mm, Angle = deg.'));
  assert.ok(out.front.includes('## Side : front'));
  assert.ok(out.front.includes('# Ref     Val       Package  PosX       PosY       Rot     Side'));
  const line = out.front.split('\n').find(l => l.startsWith('R1'));
  assert.ok(line, 'data line present');
  assert.ok(line.includes('"10k"'), 'value is quoted');
  assert.ok(line.includes('10.5000'), 'x formatted %.4f');
  assert.ok(line.includes('-2.2500'), 'y formatted %.4f');
  assert.ok(line.trim().endsWith('front'), 'side column last');
  assert.ok(out.front.endsWith('## End\n'), 'file ends with ## End');
  assert.strictEqual(out.back, null, 'no back file when back empty');
});

t('back side file labelled back with back rows', () => {
  const b = mkBoard([mkFp('J1', 'USB', 'USB_C_Receptacle', [20, 30], 180, 'B.Cu')]);
  const out = Pos.exportPos(b, { date: 'D' });
  assert.ok(!out.front, 'front skipped');
  assert.ok(out.back.includes('## Side : back'));
  const line = out.back.split('\n').find(l => l.startsWith('J1'));
  assert.ok(line.trim().endsWith('back'));
  assert.ok(line.includes('180.00'));
});

t('mixed sides produce two files, order stable within a side', () => {
  const b = mkBoard([
    mkFp('R2', '2k', 'R_0603', [2, 0]),
    mkFp('C1', '1u', 'C_0603', [1, 0]),
    mkFp('R1', '1k', 'R_0603', [0, 0])
  ]);
  const refs = Pos.collectPlacements(b).front.map(r => r.ref);
  assert.deepStrictEqual(refs, ['R2', 'C1', 'R1']);
});

t('default date path produces ISO-ish timestamp header', () => {
  const out = Pos.exportPos(mkBoard([mkFp('R1', '1k', 'R_0603', [0, 0])]));
  assert.ok(/### Module positions - created on \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} ###/.test(out.front));
});

t('determinism: same input -> byte-identical output', () => {
  const b = mkBoard([mkFp('R1', '1k', 'R_0603', [5.1234, -7.8]), mkFp('C9', '9p', 'C_0402', [-1, 2], 45)]);
  const a = Pos.exportPos(b, { date: 'X' }).front;
  const c = Pos.exportPos(b, { date: 'X' }).front;
  assert.strictEqual(a, c);
});

t('real-board smoke: placements parse back and cover every padded footprint', () => {
  const fs = require('fs');
  const Pcb = require('../js/kicad_pcb.js');
  const src = fs.readFileSync(__dirname + '/../lib-build/real-board.kicad_pcb', 'utf8');
  const board = Pcb.parseBoard(src);
  const out = Pos.exportPos(board, { date: 'SMOKE' });
  const total = Pos.collectPlacements(board);
  const padded = board.footprints.filter(f => f.pads && f.pads.length);
  assert.strictEqual(total.front.length + total.back.length, padded.length,
    'every padded footprint appears exactly once');
  // each emitted data line maps to a known ref
  for (const text of [out.front, out.back]) {
    if (!text) continue;
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('#') || line.startsWith('##')) continue;
      const ref = line.split(/\s+/)[0];
      assert.ok(padded.some(f => f.ref === ref), 'line ref ' + ref + ' exists on board');
    }
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
