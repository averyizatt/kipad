'use strict';

/**
 * KipadErc — Electrical Rules Check (ERC) for the schematic editor.
 *
 * Pure logic, no DOM. UMD: browser global `KipadErc` / CommonJS. Mirrors the
 * PCB-side DRC pattern (B.runDRC in js/board.js) but for schematics: it
 * inspects a KipadSchematic model plus the symbol registry and returns a
 * list of violations.
 *
 * Violation shape:
 *   { severity: 'error'|'warning', code, message,
 *     symbolId?, pinId?, labelId?, wireId?, netName?, x, y }
 * x/y are world (mm) coordinates used to locate/centre the item on canvas.
 *
 * Checks (KiCad semantics, bounded set):
 *   UNCONNECTED_PIN  — pin with no wire/label/junction/other pin on its node
 *                      (power pins whose value names a power net, and
 *                      no_connect pins are exempt)
 *   SINGLE_PIN_NET   — net with exactly one pin and no label
 *   DUPLICATE_REF    — two symbols sharing a reference designator
 *   MISSING_REF      — symbol with an empty reference designator
 *   MISSING_VALUE    — symbol with an empty value
 *   LABEL_CONFLICT   — two different labels on the same electrical node
 *   DANGLING_WIRE    — wire end that touches nothing
 *
 * Topology comes from KipadSchematic.connectivity() — the same union-find
 * + label-to-wire merging used for the schematic→PCB netlist, so ERC and the
 * netlist always agree about what is connected.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadErc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var GR = root || globalThis;
  var EPS = 0.005;           // node coincidence tolerance (schematic.js)
  var LABEL_RADIUS = 1.0;    // label attachment radius (schematic.js)

  function schMod() {
    return GR.KipadSchematic || (typeof require !== 'undefined' ? require('./schematic.js') : null);
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  /**
   * Power net name for a pin, or null. Mirrors the powerName derivation in
   * schematic.js extractNets: power_in/power_out pins whose value is a plain
   * net name (GND/VCC/+5V/...) — or whose pin name is — belong to a named
   * power net even when nothing is wired to them.
   */
  function powerNetName(pin) {
    if (pin.type !== 'power_in' && pin.type !== 'power_out') return null;
    var v = String(pin.symValue || '').trim();
    if (v && /^[A-Za-z0-9_+.-]+$/.test(v) && v.toUpperCase() !== 'POWER') return v;
    return (pin.name && String(pin.name).trim()) || null;
  }

  /** runERC(sch, getSymbol) -> violations array (deterministic order). */
  function runERC(sch, getSymbol) {
    var Sch = schMod();
    var violations = [];
    function add(v) { violations.push(v); }

    var symbols = sch.symbols || [];
    var refOf = {};
    var pinsOf = {};        // symId -> pin position records
    symbols.forEach(function (sym) {
      refOf[sym.id] = sym.ref || sym.libId;
      // pinPositions() has no symValue; ERC needs it for the power-net
      // exemption (GND/VCC pins), so stamp it on the fresh records.
      pinsOf[sym.id] = Sch.pinPositions(sym, getSymbol).map(function (p) {
        p.symValue = sym.value;
        return p;
      });
    });

    var groups = Sch.connectivity(sch, getSymbol);

    // Map each pin to its electrical node group.
    var pinGroup = {};
    groups.forEach(function (g) {
      g.pins.forEach(function (p) { pinGroup[p.symId + '|' + p.number] = g; });
    });

    // ---- 1. unconnected pins ----
    var unconnected = {};   // symId|number -> true (already reported)
    symbols.forEach(function (sym) {
      (pinsOf[sym.id] || []).forEach(function (p) {
        if (p.type === 'no_connect') return;      // explicit no-connect flag
        if (powerNetName(p)) return;              // named power pin (GND/VCC…)
        var g = pinGroup[sym.id + '|' + p.number];
        // Connected only when something else shares the node: another pin, a
        // label, a wire or a junction.
        if (g && (g.pins.length > 1 || g.labels.length > 0 || g.wired)) return;
        add({
          severity: 'warning',
          code: 'UNCONNECTED_PIN',
          message: 'Pin ' + p.number + ' of ' + refOf[sym.id] + ' not connected',
          symbolId: sym.id, pinId: p.number,
          x: p.at[0], y: p.at[1]
        });
        unconnected[sym.id + '|' + p.number] = true;
      });
    });

    // ---- 2. single-pin nets (net with exactly one pin, no label) ----
    // Auto net numbering follows extractNets (N-1, N-2, … in group order).
    var auto = 0;
    groups.forEach(function (g) {
      var name = g.powerName;
      if (!name && !g.labels.length) name = 'N-' + (++auto);
      if (g.pins.length !== 1 || g.labels.length) return;
      var p = g.pins[0];
      if (p.type === 'no_connect') return;
      if (powerNetName(p)) return;                 // lone GND/VCC pin is fine
      if (unconnected[p.symId + '|' + p.number]) return; // already "pin not connected"
      add({
        severity: 'warning',
        code: 'SINGLE_PIN_NET',
        message: 'Net ' + name + ' has only one pin (' + refOf[p.symId] + ' pin ' + p.number + ')',
        symbolId: p.symId, pinId: p.number, netName: name,
        x: p.at[0], y: p.at[1]
      });
    });

    // ---- 3. duplicate reference designators ----
    var byRef = {};
    symbols.forEach(function (s) {
      var r = String(s.ref || '').trim();
      if (!r) return;
      (byRef[r] = byRef[r] || []).push(s);
    });
    Object.keys(byRef).forEach(function (r) {
      var list = byRef[r];
      if (list.length < 2) return;
      list.slice(1).forEach(function (s) {
        add({
          severity: 'error',
          code: 'DUPLICATE_REF',
          message: 'Duplicate reference designator "' + r + '"',
          symbolId: s.id,
          x: s.at[0], y: s.at[1]
        });
      });
    });

    // ---- 4. missing ref / value ----
    symbols.forEach(function (s) {
      var ref = String(s.ref || '').trim();
      var val = String(s.value || '').trim();
      if (!ref) {
        add({
          severity: 'error',
          code: 'MISSING_REF',
          message: 'Missing reference designator (' + (s.libId || 'symbol') + ')',
          symbolId: s.id,
          x: s.at[0], y: s.at[1]
        });
      }
      if (!val) {
        add({
          severity: 'warning',
          code: 'MISSING_VALUE',
          message: 'Missing value on ' + (ref || s.libId || 'symbol'),
          symbolId: s.id,
          x: s.at[0], y: s.at[1]
        });
      }
    });

    // ---- 5. net label conflicts (two different labels, one node) ----
    groups.forEach(function (g) {
      if (g.labels.length < 2) return;
      var first = g.labels[0].text;
      var seen = {};
      g.labels.forEach(function (l) {
        if (l.text === first || seen[l.text]) return;
        seen[l.text] = true;
        add({
          severity: 'error',
          code: 'LABEL_CONFLICT',
          message: 'Label "' + l.text + '" conflicts with label "' + first + '" on the same net',
          labelId: l.id, netName: first,
          x: l.at[0], y: l.at[1]
        });
      });
    });

    // ---- 6. dangling wire ends ----
    var pinTips = [];
    symbols.forEach(function (sym) {
      (pinsOf[sym.id] || []).forEach(function (p) { pinTips.push(p.at); });
    });
    var juncs = (sch.junctions || []).map(function (j) { return j.at; });
    var labAt = (sch.labels || []).map(function (l) { return l.at; });
    var verts = [];
    (sch.wires || []).forEach(function (w) {
      w.pts.forEach(function (p, i) {
        verts.push({ id: w.id, at: p, end: i === 0 || i === w.pts.length - 1 });
      });
    });
    (sch.wires || []).forEach(function (w) {
      [w.pts[0], w.pts[w.pts.length - 1]].forEach(function (e) {
        var dangling = true;
        for (var i = 0; i < pinTips.length && dangling; i++) if (dist(e, pinTips[i]) <= EPS) dangling = false;
        for (var j = 0; j < juncs.length && dangling; j++) if (dist(e, juncs[j]) <= EPS) dangling = false;
        for (var k = 0; k < labAt.length && dangling; k++) if (dist(e, labAt[k]) <= LABEL_RADIUS) dangling = false;
        for (var m = 0; m < verts.length && dangling; m++) {
          if (verts[m].at === e) continue;          // the endpoint itself
          if (dist(e, verts[m].at) <= EPS) dangling = false;  // any other vertex (incl. same-wire loop close)
        }
        if (dangling) {
          add({
            severity: 'warning',
            code: 'DANGLING_WIRE',
            message: 'Dangling wire end — not connected to a pin, label, junction or wire',
            wireId: w.id,
            x: e[0], y: e[1]
          });
        }
      });
    });

    return violations;
  }

  /** counts(violations) -> { errors, warnings } */
  function counts(violations) {
    var errors = 0, warnings = 0;
    violations.forEach(function (v) {
      if (v.severity === 'error') errors++;
      else if (v.severity === 'warning') warnings++;
    });
    return { errors: errors, warnings: warnings };
  }

  return {
    runERC: runERC,
    counts: counts,
    powerNetName: powerNetName,
    EPS: EPS
  };
});
