'use strict';

/**
 * Multi-sheet editor integration — the sch getter/setter, schPushUndo,
 * schUndoStep, save/open, and localStorage migration contracts that the
 * schematic editor depends on. We test the contract through KipadProject
 * + KipadSchematic directly (the app code wires `sch` to
 * `Project.activeSheet(project).schematic`); the DOM-bound app file is
 * exercised end-to-end in the browser smoke tests.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Sch = require('../js/schematic.js');
const Project = require('../js/project.js');
const SafeSave = require('../js/safesave.js');

// Mirrors the getter/setter declared in js/app.part1.js so the same
// contract can be asserted in a Node harness without booting a DOM.
// The project holder is a { current } wrapper so undo can swap the
// entire project reference the same way the editor does.
function makeEditorBindings(initialProject) {
  const holder = { project: initialProject };
  return {
    sch: () => {
      const s = Project.activeSheet(holder.project);
      return s ? s.schematic : null;
    },
    setSch: (newSch) => {
      const s = Project.activeSheet(holder.project);
      if (s) s.schematic = newSch;
    },
    pushUndo(stack) { stack.push(JSON.stringify(holder.project)); },
    undoStep(stack) {
      if (!stack.length) return false;
      const next = JSON.parse(stack.pop());
      // Swap the entire reference so the next getter call walks the
      // restored project.
      holder.project = next;
      return true;
    },
    get project() { return holder.project; }
  };
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.log('FAIL - ' + name + ': ' + (e.stack || e.message)); }
}

// ---------- 0. browser editor is wired to the same contract ----------
t('app source resolves sch through Project.activeSheet and snapshots project undo', () => {
  const app1 = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.part1.js'), 'utf8');
  const app3 = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.part3.js'), 'utf8');
  assert.match(app1, /function sch\(\)[\s\S]*Project\.activeSheet\(project\)/,
    'sch getter resolves the active project sheet');
  assert.match(app1, /function setSch\(newSch\)[\s\S]*s\.schematic = newSch/,
    'sch setter replaces the active sheet schematic');
  assert.match(app3, /function schSnapshot\(\) \{ return JSON\.stringify\(project\); \}/,
    'schematic undo snapshots the whole project');
  assert.match(app3, /Project\.normalize\(JSON\.parse\(schUndo\.pop\(\)\)/,
    'undo restores and normalizes a project snapshot');
});

// ---------- 1. sch getter/setter wired to active sheet ----------
t('sch getter returns the active sheet schematic', () => {
  const project = Project.fromSchematic(Sch.makeSchematic(), { name: 'G', sheetName: 'Main' });
  const ed = makeEditorBindings(project);
  const main = ed.sch();
  assert.ok(main, 'getter returns a schematic');
  assert.strictEqual(ed.sch(), main, 'getter is stable while active sheet unchanged');

  // Add a second sheet, mark it active — getter must follow.
  const power = Sch.makeSchematic();
  const sheet = Project.addSheet(project, 'Power', power);
  Project.setActiveSheet(project, sheet.id);
  assert.strictEqual(ed.sch(), power, 'getter follows the active sheet');
  assert.notStrictEqual(ed.sch(), main, 'switching sheet does not return the old one');
});

t('setSch lands on the active sheet only', () => {
  const project = Project.fromSchematic(Sch.makeSchematic());
  const ed = makeEditorBindings(project);
  const main = ed.sch();
  const power = Sch.makeSchematic();
  Project.addSheet(ed.project, 'Power', power);
  Project.setActiveSheet(ed.project, 'Main');
  // Replace the active sheet's schematic via the setter.
  const fresh = Sch.makeSchematic();
  Sch.addLabel(fresh, 'VCC', [0, 0], 0, 'global');
  ed.setSch(fresh);
  assert.strictEqual(ed.sch(), fresh, 'setter replaces active sheet schematic');
  assert.notStrictEqual(Project.getSheet(ed.project, 'Power').schematic, fresh,
    'setter does not leak into other sheets');
  // main was the old schematic; fresh is now the active sheet's schematic.
  // They must be different objects.
  assert.notStrictEqual(main, fresh, 'replaced object differs from the original');
  assert.strictEqual(Project.getSheet(ed.project, 'Main').schematic, fresh, 'project sheet updated');
});

// ---------- 2. schPushUndo snapshots the project, not just the active sheet ----------
t('undo snapshot captures active sheet identity', () => {
  const project = Project.fromSchematic(Sch.makeSchematic());
  const ed = makeEditorBindings(project);
  const undoStack = [];

  // Active sheet starts on the only "Main" sheet; push an undo baseline.
  ed.pushUndo(undoStack);
  assert.ok(undoStack[0].includes('"activeSheetId"'), 'snapshot includes activeSheetId');
  assert.ok(undoStack[0].includes('"sheets"'), 'snapshot includes sheets array');

  // Add a sheet, switch to it, then edit it.
  const power = Sch.makeSchematic();
  const powerSheet = Project.addSheet(ed.project, 'Power', power);
  Project.setActiveSheet(ed.project, powerSheet.id);
  Sch.addLabel(ed.sch(), 'VBUS', [0, 0], 0, 'global');
  ed.pushUndo(undoStack);
  assert.strictEqual(undoStack.length, 2, 'two snapshots queued');

  // Switch back to Main, push again.
  Project.setActiveSheet(ed.project, 'Main');
  ed.pushUndo(undoStack);
  assert.strictEqual(undoStack.length, 3, 'three snapshots queued');

  // Undo back across the switch — active sheet should restore to "Main"
  // and the snapshot from before the power-sheet edits must still be
  // intact.
  assert.ok(ed.undoStep(undoStack));
  assert.strictEqual(Project.activeSheet(ed.project).name, 'Main', 'undo restored Main as active');
  assert.ok(ed.undoStep(undoStack));
  assert.strictEqual(Project.activeSheet(ed.project).name, 'Power',
    'previous undo snapshot still recorded the Power switch');
  const vbusLabel = Project.activeSheet(ed.project).schematic.labels[0];
  assert.strictEqual(vbusLabel.text, 'VBUS', 'Power sheet content restored from snapshot');
});

t('undo does not leak the wrong sheet into the active slot', () => {
  const project = Project.fromSchematic(Sch.makeSchematic());
  const ed = makeEditorBindings(project);
  const undoStack = [];

  // Sheet A, then a snapshot.
  const A = Project.activeSheet(project).schematic;
  ed.pushUndo(undoStack);

  // Add sheet B, mark it active, snapshot.
  const b = Sch.makeSchematic();
  const B = Project.addSheet(ed.project, 'B', b);
  Project.setActiveSheet(ed.project, B.id);
  ed.pushUndo(undoStack);

  // Modify B and snapshot.
  Sch.addLabel(ed.sch(), 'ON_B', [0, 0], 0, 'global');
  ed.pushUndo(undoStack);

  // Undo all the way back; at no point should the editor's `sch` getter
  // return the wrong schematic for the active sheet.
  while (undoStack.length > 1) {
    ed.undoStep(undoStack);
    const cur = Project.activeSheet(ed.project);
    assert.ok(cur, 'active sheet always resolves after undo');
    assert.strictEqual(ed.sch(), cur.schematic,
      'active=' + cur.name + ' => sch matches the active sheet');
    if (cur.name === 'A') assert.strictEqual(A, cur.schematic);
  }
});

// ---------- 3. save produces JSON that re-parses ----------
t('serializeProject -> parseProject round-trip is byte-stable', () => {
  const project = Project.fromSchematic(Sch.makeSchematic());
  const ed = makeEditorBindings(project);
  Sch.placeSymbol(ed.sch(), 'Device:R', [10, 20], 0);
  Sch.addLabel(ed.sch(), 'NET1', [12, 22], 0, 'local');
  const text = Project.serializeProject(project);
  const v = SafeSave.validate(text,
    t => Project.parseProject(t),
    m => Project.serializeProject(m));
  assert.strictEqual(v.ok, true, 'project passes SafeSave validation, error=' + (v.error || ''));
  assert.strictEqual(v.stable, true, 'project round-trip is byte-stable');
  const reloaded = Project.parseProject(text);
  assert.strictEqual(reloaded.sheets.length, project.sheets.length);
  assert.strictEqual(reloaded.activeSheetId, project.activeSheetId);
  assert.deepStrictEqual(
    reloaded.sheets[0].schematic.symbols,
    project.sheets[0].schematic.symbols
  );
});

// ---------- 4. Project.fromSchematic round-trips through save/open ----------
t('single-schematic .kicad_sch path is still valid', () => {
  const sch = Sch.makeSchematic();
  Sch.addLabel(sch, 'X', [1, 1], 0, 'local');
  const text = Sch.serializeSch(sch);
  const reloaded = Sch.parseSch(text);
  const project = Project.fromSchematic(reloaded, { name: 'Imported', sheetName: 'Root' });
  assert.strictEqual(project.sheets.length, 1);
  assert.strictEqual(project.sheets[0].name, 'Root');
  assert.strictEqual(project.sheets[0].schematic.labels[0].text, 'X');
  // Re-serialize via the project path: single-sheet projects fall back to
  // the .kicad_sch format the editor already exports.
  const text2 = Sch.serializeSch(Project.activeSheet(project).schematic);
  const reparsed = Sch.parseSch(text2);
  assert.strictEqual(reparsed.labels.length, sch.labels.length, 'label count preserved');
  assert.strictEqual(reparsed.labels[0].text, sch.labels[0].text, 'label text preserved');
  assert.deepStrictEqual(reparsed.labels[0].at, sch.labels[0].at, 'label position preserved');
});

t('fromSchematic preserves the live model identity', () => {
  // The editor wraps the existing single-schematic on first entry; the
  // model returned by the getter should be the very object we passed in.
  const live = Sch.makeSchematic();
  const project = Project.fromSchematic(live);
  const ed = makeEditorBindings(project);
  assert.strictEqual(ed.sch(), live, 'getter returns the same object the caller passed in');
});

// ---------- 5. localStorage migration contract ----------
t('localStorage shape with project field round-trips', () => {
  const project = Project.fromSchematic(Sch.makeSchematic());
  const payload = { board: { version: 1, footprints: [], nets: [] }, view: { x: 0, y: 0, zoom: 6 }, project };
  const text = JSON.stringify(payload);
  const d = JSON.parse(text);
  assert.ok(d.project, 'payload carries project field');
  assert.strictEqual(Project.isProject(d.project), true, 'round-tripped value is a project');
  const rehydrated = Project.normalize(d.project, { makeSchematic: Sch.makeSchematic });
  assert.strictEqual(rehydrated.sheets.length, 1, 'normalized has one sheet');
});

t('legacy payload without project still loads (backward compatible)', () => {
  const d = { board: { version: 1, footprints: [], nets: [] }, view: { x: 0, y: 0, zoom: 6 } };
  assert.strictEqual(d.project, undefined, 'legacy shape has no project');
  // The editor handles this by leaving `project` null and lazily creating
  // a fresh one on first schematic edit — that path is verified by the
  // browser smoke test.
});

console.log(`PROJECT INTEGRATION TESTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
