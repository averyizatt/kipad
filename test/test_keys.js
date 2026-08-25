'use strict';
/* KipadKeys resolver tests — KiCad-parity keyboard bindings. */
const assert = require('assert');
const K = require('../js/keys.js');

let pass = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✓ ' + name); } else { console.log('  ✗ FAIL: ' + name); process.exitCode = 1; } }

const ev = (key, m) => Object.assign({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, m || {});
const pcb = { mode: 'pcb', hasSelection: true };
const pcbNoSel = { mode: 'pcb', hasSelection: false };
const sch = { mode: 'schematic', hasSelection: true };

// --- modifier combos ---
ok(K.resolve(ev('s', { ctrlKey: true }), pcb) === 'save', 'Ctrl+S → save');
ok(K.resolve(ev('S', { metaKey: true }), pcb) === 'save', 'Cmd+Shift-caps S → save');
ok(K.resolve(ev('o', { ctrlKey: true }), sch) === 'open', 'Ctrl+O → open');
ok(K.resolve(ev('z', { ctrlKey: true }), pcb) === 'undo', 'Ctrl+Z → undo');
ok(K.resolve(ev('z', { ctrlKey: true, shiftKey: true }), pcb) === 'redo', 'Ctrl+Shift+Z → redo');
ok(K.resolve(ev('y', { metaKey: true }), sch) === 'redo', 'Cmd+Y → redo');
ok(K.resolve(ev('x', { ctrlKey: true }), pcb) === null, 'unknown Ctrl combo → null (no tool leak)');
ok(K.resolve(ev('s', { altKey: true }), pcb) === null, 'Alt combos ignored');
ok(K.resolve(ev('a', { ctrlKey: true }), pcb) === 'selectAll', 'Ctrl+A in PCB → selectAll');
ok(K.resolve(ev('A', { metaKey: true }), pcb) === 'selectAll', 'Cmd+A (caps) in PCB → selectAll');
ok(K.resolve(ev('a', { ctrlKey: true, shiftKey: true }), pcb) === 'selectAll', 'Ctrl+Shift+A still selectAll');
ok(K.resolve(ev('a', { ctrlKey: true }), sch) === null, 'Ctrl+A in schematic → null (no multi-select there)');
ok(K.resolve(ev('a', { ctrlKey: true }), { mode: 'launcher' }) === null, 'Ctrl+A in launcher → null');

// --- zoom / fit ---
ok(K.resolve(ev('+'), pcb) === 'zoomIn' && K.resolve(ev('='), pcb) === 'zoomIn', '+ and = → zoomIn');
ok(K.resolve(ev('-'), pcb) === 'zoomOut' && K.resolve(ev('_'), pcb) === 'zoomOut', '- and _ → zoomOut');
ok(K.resolve(ev('Home'), pcb) === 'zoomFit', 'Home → zoomFit');
ok(K.resolve(ev('+'), { mode: 'launcher' }) === null, 'launcher mode ignores zoom');

// --- properties ---
ok(K.resolve(ev('e'), pcb) === 'props', 'E with selection → props');
ok(K.resolve(ev('e'), pcbNoSel) === null, 'E without selection → null');
ok(K.resolve(ev('e'), sch) === 'props', 'E in schematic with selection → props');
ok(K.resolve(ev('e'), { mode: 'schematic', hasSelection: false }) === null, 'E in schematic without selection → null');

// --- add footprint / symbol ---
ok(K.resolve(ev('a'), pcbNoSel) === 'addFootprint', 'A in PCB (even without selection) → addFootprint');
ok(K.resolve(ev('a'), sch) === 'addSymbol', 'A in schematic → addSymbol');
ok(K.resolve(ev('a'), { mode: 'launcher' }) === null, 'A in launcher → null');

// --- arrow nudge ---
for (const [key, act] of [['ArrowLeft', 'nudgeLeft'], ['ArrowRight', 'nudgeRight'], ['ArrowUp', 'nudgeUp'], ['ArrowDown', 'nudgeDown']])
  ok(K.resolve(ev(key), pcb) === act, key + ' with selection → ' + act);
ok(K.resolve(ev('ArrowUp'), pcbNoSel) === null, 'arrows without selection → null');
ok(K.resolve(ev('ArrowUp', { shiftKey: true }), pcb) === 'nudgeUp', 'Shift+arrow still nudges');

// --- guards ---
ok(K.resolve(ev(null), pcb) === null, 'missing key → null');
ok(K.resolve(ev('Escape'), pcb) === null, 'plain keys not owned here → null (legacy switches handle them)');
ok(K.resolve(ev('r', {}), { mode: 'launcher' }) === null, 'launcher mode blocks plain letters too');

console.log(`\ntest_keys: ${pass} checks passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
