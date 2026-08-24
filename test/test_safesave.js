'use strict';
/* test/test_safesave.js — KipadSafeSave validation + backup ring */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SafeSave = require('../js/safesave.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('FAIL - ' + name + ': ' + e.message); }
}

function mockStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    _map: m
  };
}

// ---------- validate ----------
t('validate: ok when parse succeeds', () => {
  const v = SafeSave.validate('(board)', () => ({}));
  assert.strictEqual(v.ok, true);
});

t('validate: ok:false with error on parse throw', () => {
  const v = SafeSave.validate('garbage', () => { throw new Error('bad sexpr'); });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.stage, 'parse');
  assert.strictEqual(v.error, 'bad sexpr');
});

t('validate: stable:true on identical re-serialization', () => {
  const v = SafeSave.validate('(a 1)', t => ({ x: t }), m => m.x);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.stable, true);
});

t('validate: stable:false reported but still ok', () => {
  const v = SafeSave.validate('(a 1)', t => ({ x: t }), () => '(a 2)');
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.stable, false);
});

t('validate: reserialize throw -> not ok, stage reserialize', () => {
  const v = SafeSave.validate('(a)', () => ({}), () => { throw new Error('boom'); });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.stage, 'reserialize');
});

// ---------- pushBackup / listBackups / getBackup ----------
t('pushBackup stores newest first with metadata', () => {
  const s = mockStore();
  assert.strictEqual(SafeSave.pushBackup(s, 'k', 'one'), 1);
  assert.strictEqual(SafeSave.pushBackup(s, 'k', 'two'), 2);
  const list = SafeSave.listBackups(s, 'k');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].n, 3); // 'two'
  assert.ok(list[0].t >= list[1].t, 'newest timestamp first');
  assert.strictEqual(SafeSave.getBackup(s, 'k', 0).s, 'two');
  assert.strictEqual(SafeSave.getBackup(s, 'k', 1).s, 'one');
  assert.strictEqual(SafeSave.getBackup(s, 'k').s, 'two', 'default index is newest');
});

t('ring trims to default maxKeep=3, oldest dropped', () => {
  const s = mockStore();
  ['a', 'b', 'c'].forEach(x => SafeSave.pushBackup(s, 'r', x));
  SafeSave.pushBackup(s, 'r', 'd');
  const all = [0, 1, 2].map(i => SafeSave.getBackup(s, 'r', i).s);
  assert.deepStrictEqual(all, ['d', 'c', 'b']);
  assert.strictEqual(SafeSave.getBackup(s, 'r', 3), null);
});

t('custom maxKeep honored', () => {
  const s = mockStore();
  ['1', '2', '3', '4', '5'].forEach(x => SafeSave.pushBackup(s, 'm', x, { maxKeep: 5 }));
  SafeSave.pushBackup(s, 'm', '6', { maxKeep: 5 });
  assert.strictEqual(SafeSave.listBackups(s, 'm').length, 5);
  assert.strictEqual(SafeSave.getBackup(s, 'm', 4).s, '2');
});

t('quota errors drop oldest entries and retry', () => {
  const s = mockStore();
  s.setItem = (k, v) => {
    if (v.length > 110) { const e = new Error('QuotaExceeded'); throw e; }
    s._map.set(k, v);
  };
  // long strings force the combined payload over the fake quota
  SafeSave.pushBackup(s, 'q', 'x'.repeat(20));
  SafeSave.pushBackup(s, 'q', 'y'.repeat(20));
  const kept = SafeSave.pushBackup(s, 'q', 'z'.repeat(20));
  assert.ok(kept >= 1 && kept <= 2, 'kept a trimmed ring, kept=' + kept);
  assert.strictEqual(JSON.parse(s._map.get('q.bak.v1')).length, kept);
});

t('persistent storage failure degrades to 0 without throwing', () => {
  const s = { getItem: () => null, setItem: () => { throw new Error('SecurityError'); } };
  assert.doesNotThrow(() => SafeSave.pushBackup(s, 'x', 'text'));
  assert.strictEqual(SafeSave.pushBackup(s, 'x', 'text'), 0);
});

t('corrupt stored JSON ignored gracefully', () => {
  const s = mockStore();
  s.setItem('corrupt.bak.v1', '{not json');
  assert.deepStrictEqual(SafeSave.listBackups(s, 'corrupt'), []);
  assert.strictEqual(SafeSave.getBackup(s, 'corrupt', 0), null);
  // and a new push starts a fresh valid ring
  SafeSave.pushBackup(s, 'corrupt', 'fresh');
  assert.strictEqual(SafeSave.getBackup(s, 'corrupt', 0).s, 'fresh');
});

t('empty/missing store or text are no-ops', () => {
  assert.strictEqual(SafeSave.pushBackup(null, 'k', 'text'), 0);
  assert.strictEqual(SafeSave.pushBackup(mockStore(), 'k', ''), 0);
  assert.deepStrictEqual(SafeSave.listBackups(null, 'k'), []);
  assert.strictEqual(SafeSave.getBackup(null, 'k', 0), null);
});

// ---------- real-parser smoke ----------
global.KipadFootprints = require('../js/footprints.js');
global.KipadSexpr = require('../js/sexpr.js');
const B = require('../js/board.js');
const Pcb = require('../js/kicad_pcb.js');

t('real board: serialize → validate parses clean and stable', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib-build', 'raw', 'custom_pads.kicad_pcb'), 'utf8');
  const text = Pcb.serializeBoard(Pcb.parseBoard(src));
  B.ensureNetClasses(Pcb.parseBoard(text)); // sanity: parser needs no setup beyond globals
  const v = SafeSave.validate(text,
    tx => Pcb.parseBoard(tx),
    m => Pcb.serializeBoard(m));
  assert.strictEqual(v.ok, true, 'validation ok');
  assert.strictEqual(v.stable, true, 'second-cycle byte-stable');
});

t('real board: garbage rejected by validation gate', () => {
  const v = SafeSave.validate('(kicad_pcb (layer "F.Cu"', tx => Pcb.parseBoard(tx));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.stage, 'parse');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
