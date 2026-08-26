'use strict';

/**
 * KipadProject — dependency-free multi-sheet project model.
 *
 * This module deliberately contains no UI or electrical connectivity logic.
 * A project owns one or more named schematic models and may also carry the
 * existing board model.  Existing callers can continue to use
 * KipadSchematic.makeSchematic() directly; fromSchematic()/normalize() wrap a
 * legacy single-sheet model without changing it.
 *
 * UMD: browser global `KipadProject` / CommonJS.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadProject = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'kipad-project';
  var VERSION = 1;

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isSchematic(value) {
    return !!value && typeof value === 'object' &&
      Array.isArray(value.symbols) && Array.isArray(value.wires) &&
      Array.isArray(value.labels) && Array.isArray(value.junctions);
  }

  function emptySchematic(makeSchematic) {
    if (typeof makeSchematic === 'function') return makeSchematic();
    return {
      version: '20231120', paper: 'A4', symbols: [], wires: [], labels: [],
      junctions: [], noConnects: []
    };
  }

  function safeName(value, fallback) {
    var name = String(value === undefined || value === null ? '' : value).trim();
    return name || fallback;
  }

  function nextSheetId(project) {
    var used = {};
    (project.sheets || []).forEach(function (sheet) { used[sheet.id] = true; });
    var n = 1;
    while (used['sheet-' + n]) n++;
    return 'sheet-' + n;
  }

  function makeSheet(project, name, schematic, id, makeSchematic) {
    return {
      id: safeName(id, nextSheetId(project)),
      name: safeName(name, 'Sheet ' + ((project.sheets || []).length + 1)),
      schematic: schematic || emptySchematic(makeSchematic)
    };
  }

  /** Create a project with one root sheet, preserving the supplied model. */
  function makeProject(options) {
    options = options || {};
    var project = {
      format: FORMAT,
      version: VERSION,
      name: safeName(options.name, 'kipad'),
      sheets: [],
      activeSheetId: null,
      board: options.board === undefined ? null : options.board
    };
    var sheet = makeSheet(project, options.sheetName || 'Main',
      options.schematic, options.sheetId, options.makeSchematic);
    project.sheets.push(sheet);
    project.activeSheetId = sheet.id;
    return project;
  }

  function fromSchematic(schematic, options) {
    if (!isSchematic(schematic)) throw new Error('KipadProject.fromSchematic: expected a schematic model');
    options = options || {};
    options.schematic = schematic;
    return makeProject(options);
  }

  function isProject(value) {
    return !!value && typeof value === 'object' && value.format === FORMAT &&
      Array.isArray(value.sheets);
  }

  function getSheet(project, idOrName) {
    if (!project || !Array.isArray(project.sheets)) return null;
    for (var i = 0; i < project.sheets.length; i++) {
      var sheet = project.sheets[i];
      if (sheet.id === idOrName || sheet.name === idOrName) return sheet;
    }
    return null;
  }

  function activeSheet(project) {
    if (!project || !Array.isArray(project.sheets)) return null;
    return getSheet(project, project.activeSheetId) || project.sheets[0] || null;
  }

  function addSheet(project, name, schematic, options) {
    if (!isProject(project)) throw new Error('KipadProject.addSheet: expected a project model');
    options = options || {};
    var sheet = makeSheet(project, name, schematic, options.id, options.makeSchematic);
    if (getSheet(project, sheet.id)) throw new Error('KipadProject.addSheet: duplicate sheet id ' + sheet.id);
    project.sheets.push(sheet);
    if (!project.activeSheetId) project.activeSheetId = sheet.id;
    return sheet;
  }

  function setActiveSheet(project, idOrName) {
    var sheet = getSheet(project, idOrName);
    if (!sheet) return null;
    project.activeSheetId = sheet.id;
    return sheet;
  }

  /**
   * Normalize either a version-1 project or an old single schematic object.
   * Returned projects are independent deep copies, as parsed save data should
   * never retain references to caller-owned models.
   */
  function normalize(value, options) {
    options = options || {};
    if (isSchematic(value)) {
      return fromSchematic(clone(value), {
        name: options.name,
        sheetName: options.sheetName,
        sheetId: options.sheetId,
        makeSchematic: options.makeSchematic
      });
    }
    if (!isProject(value)) throw new Error('KipadProject.normalize: unsupported project data');
    if (value.version !== VERSION) throw new Error('KipadProject.normalize: unsupported version ' + value.version);

    var project = {
      format: FORMAT,
      version: VERSION,
      name: safeName(value.name, 'kipad'),
      sheets: [],
      activeSheetId: value.activeSheetId || null,
      board: value.board === undefined ? null : clone(value.board)
    };
    value.sheets.forEach(function (raw, i) {
      if (!raw || !isSchematic(raw.schematic))
        throw new Error('KipadProject.normalize: sheet ' + (i + 1) + ' has no valid schematic');
      var sheet = makeSheet(project, raw.name, clone(raw.schematic), raw.id, options.makeSchematic);
      if (getSheet(project, sheet.id)) throw new Error('KipadProject.normalize: duplicate sheet id ' + sheet.id);
      project.sheets.push(sheet);
    });
    if (!project.sheets.length) {
      var root = makeSheet(project, 'Main', null, null, options.makeSchematic);
      project.sheets.push(root);
    }
    if (!getSheet(project, project.activeSheetId)) project.activeSheetId = project.sheets[0].id;
    return project;
  }

  function serializeProject(project) {
    var clean = normalize(project);
    return JSON.stringify(clean, null, 2) + '\n';
  }

  function parseProject(text, options) {
    if (typeof text !== 'string') throw new Error('KipadProject.parseProject: expected text');
    var value;
    try { value = JSON.parse(text); }
    catch (e) { throw new Error('KipadProject.parseProject: invalid JSON (' + e.message + ')'); }
    return normalize(value, options);
  }

  return {
    FORMAT: FORMAT, VERSION: VERSION,
    makeProject: makeProject, fromSchematic: fromSchematic,
    isProject: isProject, isSchematic: isSchematic,
    addSheet: addSheet, getSheet: getSheet, activeSheet: activeSheet,
    setActiveSheet: setActiveSheet, normalize: normalize,
    serializeProject: serializeProject, parseProject: parseProject
  };
});
