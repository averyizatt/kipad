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
 *   POWERPIN_CONFLICT— two different power nets shorted on one node
 *                      (e.g. a GND symbol wired to a VCC symbol)
 *   MISSING_FOOTPRINT — non-power symbol with no footprint assigned; the
 *                      PCB exporter will substitute a ref-prefix default
 *   FOOTPRINT_NOT_FOUND — explicitly assigned footprint name that the
 *                      footprint registry cannot resolve (Update PCB would
 *                      silently fall back to the ref-prefix default)
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
   * No-connect flag locations (sch.noConnects). A pin whose tip lies within
   * NC_RADIUS of a flag is "intentionally unconnected" — exempt from
   * UNCONNECTED_PIN and SINGLE_PIN_NET. Radius is generous (half the common
   * 1.27 mm pin pitch) so hand-placed flags still catch their pin.
   */
  var NC_RADIUS = 0.635;
  function noConnectAts(sch) {
    return (sch && sch.noConnects) ? sch.noConnects.map(function (n) { return n.at; }) : [];
  }
  function pinHasNoConnect(sch, at) {
    var ats = noConnectAts(sch);
    for (var i = 0; i < ats.length; i++) if (dist(at, ats[i]) <= NC_RADIUS) return true;
    return false;
  }

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

  /** runERC(sch, getSymbol [, getFootprint]) -> violations array (deterministic order).
 *  getFootprint(name)->fp|null enables the FOOTPRINT_NOT_FOUND registry check. */
  function runERC(sch, getSymbol, getFootprint) {
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

    // Map each pin to its electrical node group (and keep the symValue-stamped
    // record reachable from the group's plain pin records).
    var pinGroup = {};
    var stamped = {};      // symId|number -> stamped position record
    symbols.forEach(function (sym) {
      (pinsOf[sym.id] || []).forEach(function (p) { stamped[sym.id + '|' + p.number] = p; });
    });
    groups.forEach(function (g) {
      g.pins.forEach(function (p) { pinGroup[p.symId + '|' + p.number] = g; });
    });

    // ---- 1. unconnected pins ----
    var unconnected = {};   // symId|number -> true (already reported)
    symbols.forEach(function (sym) {
      (pinsOf[sym.id] || []).forEach(function (p) {
        if (p.type === 'no_connect') return;      // explicit no-connect flag
        if (powerNetName(p)) return;              // named power pin (GND/VCC…)
        if (pinHasNoConnect(sch, p.at)) return;   // placed no-connect flag on the tip
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
      if (pinHasNoConnect(sch, p.at)) return;      // flagged no-connect
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

    // ---- 4b. footprint assignment ----
    // KiCad flags symbols without a footprint link. Here the PCB exporter
    // substitutes a ref-prefix default (R -> 0603 chip resistor …), so an
    // unassigned footprint is only a warning — but an explicitly assigned
    // name the registry cannot resolve means the user's choice gets silently
    // overridden during Update PCB from Schematic, which is an error.
    var isPowerSym = Sch.isPower || function (s) {
      return /^(GND|VCC|VP|VN|\+5V|\+3V3|-5V|VSS|VDD|PWR)/i.test(s.value || s.libId);
    };
    symbols.forEach(function (s) {
      if (isPowerSym(s)) return;
      if (String(s.ref || '').charAt(0) === '#') return; // KiCad #PWR/#FLG-style refs never take footprints
      var fp = String(s.footprint || '').trim();
      if (!fp) {
        add({
          severity: 'warning',
          code: 'MISSING_FOOTPRINT',
          message: 'Missing footprint on ' + (refOf[s.id] || s.libId || 'symbol') + ' — a ref-prefix default will be used',
          symbolId: s.id,
          x: s.at[0], y: s.at[1]
        });
        return;
      }
      if (typeof getFootprint !== 'function') return;   // no registry available
      var fpName = fp.indexOf(':') >= 0 ? fp.slice(fp.indexOf(':') + 1) : fp; // same strip as updatePCB
      if (fpName && !getFootprint(fpName)) {
        add({
          severity: 'error',
          code: 'FOOTPRINT_NOT_FOUND',
          message: 'Footprint "' + fp + '" not found in the library — Update PCB will substitute a default',
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

    // ---- 5b. power-pin conflicts (two different power nets on one node) ----
    // A GND symbol wired to a VCC symbol shorts two nets that must stay
    // separate; KiCad reports this as an error. Same-name repeats (two GND
    // symbols tied together) are fine.
    groups.forEach(function (g) {
      var firstName = null;  // first power net name seen on the node
      g.pins.forEach(function (gp) {
        var sp = stamped[gp.symId + '|' + gp.number];
        if (!sp) return;
        var pn = powerNetName(sp);
        if (!pn) return;
        if (!firstName) { firstName = pn; return; }
        if (pn === firstName) return;
        add({
          severity: 'error',
          code: 'POWERPIN_CONFLICT',
          message: 'Power net "' + pn + '" is shorted to "' + firstName + '"',
          symbolId: sp.symId, pinId: sp.number, netName: pn,
          x: sp.at[0], y: sp.at[1]
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
    var ncAts = noConnectAts(sch);   // a flag legitimately terminates a wire
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
        for (var q = 0; q < ncAts.length && dangling; q++) if (dist(e, ncAts[q]) <= NC_RADIUS) dangling = false;
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

  /**
   * markers(violations, zoom) -> drawable marker list for renderSchematic.
   *
   * KiCad-style ERC markers: an X-in-circle glyph centred on the violation's
   * world coordinates. Pure geometry — no DOM/canvas — so it is unit-testable:
   *   - dedupes violations sharing a location (rounded to 0.05 mm), first wins
   *   - severity colour: error #cc0000, warning #b8860b
   *   - world radius 0.9 mm scaled by zoom, clamped to 5–16 screen px so
   *     markers stay tappable when zoomed out and do not dwarf symbols zoomed in
   * Returns [{ x, y, r, color, code, message, severity }] (x/y world mm, r screen px).
   */
  function markers(violations, zoom) {
    var z = Number(zoom) || 3;
    var seen = {};
    var out = [];
    (violations || []).forEach(function (v) {
      if (typeof v.x !== 'number' || typeof v.y !== 'number' || !isFinite(v.x) || !isFinite(v.y)) return;
      var key = Math.round(v.x / 0.05) + ',' + Math.round(v.y / 0.05);
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        x: v.x,
        y: v.y,
        r: Math.max(5, Math.min(16, 0.9 * z)),
        color: v.severity === 'error' ? '#cc0000' : '#b8860b',
        code: v.code,
        message: v.message,
        severity: v.severity
      });
    });
    return out;
  }

  return {
    runERC: runERC,
    counts: counts,
    markers: markers,
    powerNetName: powerNetName,
    pinHasNoConnect: pinHasNoConnect,
    NC_RADIUS: NC_RADIUS,
    EPS: EPS
  };
});
