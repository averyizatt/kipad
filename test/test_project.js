'use strict';

/** Dependency-free tests for the multi-sheet project model. */
const assert = require('assert');
const Sch = require('../js/schematic.js');
const Project = require('../js/project.js');

// Existing single-sheet models remain valid and are wrapped by reference.
const main = Sch.makeSchematic();
main.paper = 'A3';
Sch.addLabel(main, 'INPUT', [10, 20], 0, 'global');
const project = Project.fromSchematic(main, { name: 'Controller', sheetName: 'Main' });
assert.strictEqual(project.sheets.length, 1);
assert.strictEqual(Project.activeSheet(project).schematic, main,
  'wrapping does not replace the existing live single-sheet model');

// Multiple named sheets can coexist and active-sheet selection is stable.
const power = Sch.makeSchematic();
Sch.addLabel(power, 'VCC', [5, 5], 0, 'global');
const powerSheet = Project.addSheet(project, 'Power', power);
assert.strictEqual(project.sheets.length, 2);
assert.notStrictEqual(powerSheet.id, project.sheets[0].id);
assert.strictEqual(Project.getSheet(project, 'Power'), powerSheet);
assert.strictEqual(Project.setActiveSheet(project, powerSheet.id), powerSheet);
assert.strictEqual(Project.activeSheet(project).name, 'Power');
assert.strictEqual(Project.setActiveSheet(project, 'missing'), null);
assert.strictEqual(Project.activeSheet(project).name, 'Power', 'failed selection leaves active sheet unchanged');
assert.strictEqual(Project.renameSheet(project, powerSheet.id, 'Power Supply').name, 'Power Supply');
assert.strictEqual(Project.renameSheet(project, 'missing', 'Nope'), null);
assert.strictEqual(Project.removeSheet(project, project.sheets[0].id).name, 'Main');
assert.strictEqual(project.sheets.length, 1);
assert.strictEqual(Project.removeSheet(project, powerSheet.id), null, 'last sheet cannot be removed');
Project.addSheet(project, 'Main', main);

// Project JSON preserves sheet names, active identity, each schematic and board.
project.board = { version: 1, footprints: [], nets: [{ id: 0, name: '' }] };
const text = Project.serializeProject(project);
assert.ok(text.endsWith('\n'));
assert.ok(text.includes('"format": "kipad-project"'));
const loaded = Project.parseProject(text);
assert.strictEqual(loaded.name, 'Controller');
assert.deepStrictEqual(loaded.sheets.map(s => s.name), ['Power Supply', 'Main']);
assert.strictEqual(Project.activeSheet(loaded).name, 'Power Supply');
assert.strictEqual(loaded.sheets[1].schematic.paper, 'A3');
assert.strictEqual(loaded.sheets[1].schematic.labels[0].text, 'INPUT');
assert.strictEqual(loaded.sheets[0].schematic.labels[0].text, 'VCC');
assert.deepStrictEqual(loaded.board, project.board);
assert.notStrictEqual(loaded.sheets[0].schematic, main, 'parse returns independent models');
assert.strictEqual(Project.serializeProject(loaded), text, 'project representation is stable');

// Backward compatibility: old saved schematic JSON loads as a one-sheet project.
const legacy = Project.parseProject(JSON.stringify(main), { name: 'Imported', sheetName: 'Legacy Root' });
assert.strictEqual(legacy.name, 'Imported');
assert.strictEqual(legacy.sheets.length, 1);
assert.strictEqual(legacy.sheets[0].name, 'Legacy Root');
assert.deepStrictEqual(legacy.sheets[0].schematic, main);

// Invalid or future data fails clearly instead of silently discarding sheets.
assert.throws(() => Project.parseProject('{bad json'), /invalid JSON/);
assert.throws(() => Project.parseProject(JSON.stringify({ format: 'kipad-project', version: 2, sheets: [] })),
  /unsupported version/);
assert.throws(() => Project.addSheet(project, 'Duplicate', Sch.makeSchematic(), { id: powerSheet.id }),
  /duplicate sheet id/);

console.log('PROJECT MODEL TESTS PASSED');
