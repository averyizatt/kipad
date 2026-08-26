'use strict';

/** Project-wide global/hierarchical connectivity and ERC regressions. */
const assert = require('assert');
const Sch = require('../js/schematic.js');
const Project = require('../js/project.js');
const Erc = require('../js/erc.js');

function sheetWithLabel(text, type, y) {
  const sch = Sch.makeSchematic();
  Sch.addWire(sch, [[0, y], [10, y]]);
  Sch.addLabel(sch, text, [0, y], 0, type);
  return sch;
}

function twoSheetProject(a, b) {
  const project = Project.fromSchematic(a, { sheetId: 'root', sheetName: 'Root' });
  Project.addSheet(project, 'Child', b, { id: 'child' });
  return project;
}

// Local labels remain sheet-scoped even when their text matches.
let project = twoSheetProject(
  sheetWithLabel('DATA', 'local', 0),
  sheetWithLabel('DATA', 'local', 20)
);
let nets = Project.resolveConnectivity(project, null);
assert.strictEqual(nets.length, 2, 'same-name local labels do not cross sheet boundaries');
assert.deepStrictEqual(nets.map(n => n.sheetIds), [['root'], ['child']]);

// Global and hierarchical labels share named project scope.
project = twoSheetProject(
  sheetWithLabel('DATA', 'global', 0),
  sheetWithLabel('DATA', 'global', 20)
);
nets = Project.resolveConnectivity(project, null);
assert.strictEqual(nets.length, 1, 'same-name global labels join sheets');
assert.strictEqual(nets[0].name, 'DATA');
assert.deepStrictEqual(nets[0].sheetIds, ['root', 'child']);

project = twoSheetProject(
  sheetWithLabel('CLOCK', 'hierarchical', 0),
  sheetWithLabel('CLOCK', 'global', 20)
);
nets = Project.resolveConnectivity(project, null);
assert.strictEqual(nets.length, 1, 'hierarchical and global labels with the same name join');
assert.deepStrictEqual(nets[0].labels.map(l => l.type), ['hierarchical', 'global']);
assert.strictEqual(JSON.stringify(nets), JSON.stringify(Project.resolveConnectivity(project, null)),
  'project connectivity is deterministic');

// Hierarchical KiCad labels survive model IO instead of being flattened.
let hierarchical = Sch.makeSchematic();
Sch.addLabel(hierarchical, 'PORT', [3, 4], 90, 'hierarchical');
let serialized = Sch.serializeSch(hierarchical);
assert.ok(serialized.includes('(hierarchical_label "PORT" (shape input) (at 3 4 90)'),
  'hierarchical label serializes with the KiCad tag');
let parsed = Sch.parseSch(serialized, null);
assert.strictEqual(parsed.labels[0].type, 'hierarchical');
assert.strictEqual(Sch.serializeSch(parsed), serialized, 'hierarchical label round-trip is stable');

// A shared global name that aliases different labels on different sheets is
// reported with sheet context. Same-name globals alone are clean.
const rootConflict = sheetWithLabel('BUS', 'global', 0);
Sch.addLabel(rootConflict, 'LEFT_SIDE', [10, 0], 0, 'local');
const childConflict = sheetWithLabel('BUS', 'hierarchical', 20);
Sch.addLabel(childConflict, 'RIGHT_SIDE', [10, 20], 0, 'local');
project = twoSheetProject(rootConflict, childConflict);
let violations = Erc.runProjectERC(project, null);
let cross = violations.filter(v => v.code === 'CROSS_SHEET_LABEL_CONFLICT');
assert.deepStrictEqual(cross.map(v => v.message), [
  'Cross-sheet net label "LEFT_SIDE" conflicts with "BUS"',
  'Cross-sheet net label "RIGHT_SIDE" conflicts with "BUS"'
]);
assert.ok(cross.every(v => v.sheetId && v.sheetName), 'cross-sheet conflicts carry sheet locators');

project = twoSheetProject(
  sheetWithLabel('CLEAN', 'global', 0),
  sheetWithLabel('CLEAN', 'hierarchical', 20)
);
assert.strictEqual(Erc.runProjectERC(project, null)
  .filter(v => /^CROSS_SHEET_/.test(v.code)).length, 0, 'same-name scoped labels are conflict-free');

// Different power identities joined through a project label are a cross-sheet
// short even though each individual sheet is locally valid.
const powerDef = { pins: [{ number: '1', name: 'PWR', type: 'power_in', at: [0, 0] }] };
const getSymbol = () => powerDef;
function powerSheet(value) {
  const sch = Sch.makeSchematic();
  sch.symbols.push({ id: 'sym-' + value, libId: value, ref: '#PWR-' + value,
    value, at: [0, 0], angle: 0, footprint: '' });
  Sch.addLabel(sch, 'SUPPLY', [0, 0], 0, 'global');
  return sch;
}
project = twoSheetProject(powerSheet('GND'), powerSheet('VCC'));
cross = Erc.runProjectERC(project, getSymbol).filter(v => v.code === 'CROSS_SHEET_POWER_CONFLICT');
assert.strictEqual(cross.length, 1);
assert.ok(cross[0].message.includes('GND') && cross[0].message.includes('VCC'));
assert.strictEqual(cross[0].sheetId, 'child');

console.log('PROJECT CONNECTIVITY TESTS PASSED');
