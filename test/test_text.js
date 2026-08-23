'use strict';

const assert = require('assert');
global.KipadFootprints = require('../js/footprints.js');
const B = require('../js/board.js');
const Pcb = require('../js/kicad_pcb.js');

const board = B.makeBoard();
assert.deepStrictEqual(board.texts, []);

const a = B.addText(board, { text: 'REV A', at: [10, 20], layer: 'F.SilkS', size: 1.2,
  thickness: 0.2, angle: 90, justify: 'left' });
assert.strictEqual(a.text, 'REV A');
assert.strictEqual(a.layer, 'F.SilkS');
assert.strictEqual(B.hitText(board, 10, 20, 0.1).id, a.id);
assert.strictEqual(B.hitText(board, 50, 50, 0.1), null);

assert.strictEqual(B.moveText(board, a.id, [3, 4]), true);
assert.deepStrictEqual(a.at, [3, 4]);

const b = B.addText(board, { text: 'BACK', at: [1, 2], layer: 'B.SilkS', angle: -90,
  size: 2, thickness: 0.4, justify: 'right' });
assert.strictEqual(b.angle, 270);
assert.strictEqual(b.layer, 'B.SilkS');

const text = Pcb.serializeBoard(board);
assert(/\(gr_text\s+"REV A"/.test(text));
assert(/\(layer\s+"F\.SilkS"/.test(text));
assert(/\(layer\s+"B\.SilkS"/.test(text));

const reopened = Pcb.parseBoard(text);
assert.strictEqual(reopened.texts.length, 2);
const ra = reopened.texts.find(t => t.text === 'REV A');
assert.deepStrictEqual(ra.at, [3, 4]);
assert.strictEqual(ra.size, 1.2);
assert.strictEqual(ra.thickness, 0.2);
assert.strictEqual(ra.angle, 90);
assert.strictEqual(ra.justify, 'left');
assert.strictEqual(reopened.texts.find(t => t.text === 'BACK').layer, 'B.SilkS');

assert.strictEqual(B.removeText(board, a.id), true);
assert.strictEqual(B.removeText(board, a.id), false);
assert.strictEqual(board.texts.length, 1);

console.log('test_text: all tests passed');
