'use strict';

/**
 * KipadNetlist — KiCad-format netlist export (.net) for schematics.
 *
 * Emits KiCad's classic `(export (version "D") ...)` sexpr netlist: design
 * header, components, libparts and nets — the format real KiCad imports via
 * Tools > Update PCB from Netlist (footprint assignment + board import).
 *
 * Conventions (KiCad parity, same rules as ERC/BOM):
 *  - Topology comes from KipadSchematic.extractNets() so netlist/ERC/BOM
 *    always agree on connectivity and power-net naming.
 *  - Power symbols are excluded as components AND their pins are dropped
 *    from node lists (they are annotation-only; refs like #PWR01 never
 *    appear in the output). Same isPower / '#'-ref rule as BOM.
 *  - Nets keep their schematic names: label text, power name (GND/VCC/…)
 *    or auto N-1/N-2. Sorted by name; codes are 1..n in that order.
 *  - Components sort naturally by ref (R2 < R10); libparts are deduped per
 *    (lib, part) and carry Reference/Value fields plus the registry pin
 *    list (num/name/electrical type).
 *  - All strings quoted; backslash + double-quote escaped.
 *
 * UMD: browser global `KipadNetlist` / CommonJS module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadNetlist = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  function schMod() {
    return (typeof self !== 'undefined' ? self.KipadSchematic : null) ||
           (typeof window !== 'undefined' ? window.KipadSchematic : null) ||
           (typeof require !== 'undefined' ? require('./schematic.js') : null);
  }

  /** Natural comparator: R2 < R10, case-insensitive on letter runs. */
  function natCmp(a, b) {
    a = String(a); b = String(b);
    var ra = /(\d+)|(\D+)/g, rb = /(\d+)|(\D+)/g, ma, mb;
    while (true) {
      ma = ra.exec(a); mb = rb.exec(b);
      if (!ma && !mb) return 0;
      if (!ma) return -1;
      if (!mb) return 1;
      if (ma[1] && mb[1]) {
        var na = parseInt(ma[1], 10), nb = parseInt(mb[1], 10);
        if (na !== nb) return na < nb ? -1 : 1;
      } else {
        var la = ma[0].toLowerCase(), lb = mb[0].toLowerCase();
        if (la !== lb) return la < lb ? -1 : 1;
      }
    }
  }

  function q(s) {
    return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  /** Split "Lib:Part" -> {lib, part}; bare names land in Device. */
  function splitLibId(libId) {
    var s = String(libId || '');
    var i = s.indexOf(':');
    if (i >= 0) return { lib: s.slice(0, i), part: s.slice(i + 1) };
    return { lib: 'Device', part: s };
  }

  function isAnnoRef(ref) {
    return /^#/.test(String(ref || ''));
  }

  /**
   * collect(sch, getSymbol, opts) -> { components, libparts, nets }
   * opts: {} (reserved). Deterministic given the same schematic.
   */
  function collect(sch, getSymbol, opts) {
    opts = opts || {};
    var Sch = schMod();
    var isPower = (Sch && Sch.isPower) || function (s) {
      return /^(GND|VCC|VP|VN|\+5V|\+3V3|-5V|VSS|VDD|PWR)/i.test(s.value || s.libId);
    };

    // ---- components (+ sym lookup table for net nodes) ----
    var comps = [];
    var defsByRef = {};
    (sch.symbols || []).forEach(function (s) {
      if (!s.ref || isAnnoRef(s.ref) || isPower(s)) return;
      var def = getSymbol ? getSymbol(s.libId) : null;
      var lr = splitLibId(s.libId);
      defsByRef[s.ref] = def;
      comps.push({
        ref: s.ref,
        value: s.value || '',
        footprint: s.footprint || '',
        lib: lr.lib,
        part: lr.part,
        desc: (def && def.desc) || ''
      });
    });
    comps.sort(function (a, b) { return natCmp(a.ref, b.ref); });

    // ---- libparts: deduped defs actually used by exported components ----
    var seenLp = {};
    var libparts = [];
    comps.forEach(function (c) {
      var key = c.lib + '\u0000' + c.part;
      if (seenLp[key]) return;
      seenLp[key] = true;
      var def = defsByRef[c.ref];
      var pins = ((def && def.pins) || []).map(function (p) {
        return {
          num: String(p.number),
          name: p.name || '~',
          type: p.type || 'passive'
        };
      }).sort(function (a, b) { return natCmp(a.num, b.num); });
      libparts.push({
        lib: c.lib,
        part: c.part,
        desc: c.desc,
        refPrefix: (def && def.ref) || c.ref.replace(/[0-9]+$/, ''),
        value: (def && def.value) || c.value,
        footprintHint: (def && def.footprint) || '',
        pins: pins
      });
    });
    libparts.sort(function (a, b) {
      return natCmp(a.lib, b.lib) || natCmp(a.part, b.part);
    });

    // ---- nets: extractNets topology, drop power/annotation nodes ----
    var nets = [];
    if (Sch && Sch.extractNets) {
      Sch.extractNets(sch, getSymbol).forEach(function (n) {
        var nodes = [];
        (n.pins || []).forEach(function (p) {
          var e = { sym: null, def: null };
          for (var si = 0; si < (sch.symbols || []).length; si++) {
            if (sch.symbols[si].id === p.symId) {
              e.sym = sch.symbols[si];
              if (defsByRef[e.sym.ref] !== undefined) e.def = defsByRef[e.sym.ref];
              else if (getSymbol && !isPower(e.sym)) e.def = getSymbol(e.sym.libId);
              break;
            }
          }
          if (!e.sym) return;                   // dangling sym id
          // same exclusion rule as components: no ref / annotation / power
          if (!e.sym.ref || isAnnoRef(e.sym.ref) || isPower(e.sym)) return;
          var pinName = p.name, pinType = p.type;
          if ((pinName == null || pinType == null) && e.def && e.def.pins) {
            var dp = e.def.pins.filter(function (x) { return String(x.number) === String(p.number); })[0];
            if (dp) { pinName = dp.name; pinType = dp.type; }
          }
          nodes.push({
            ref: e.sym.ref,
            num: String(p.number),
            pinfunction: pinName != null ? (pinName || '~') : null,
            pintype: pinType != null ? (pinType || 'passive') : null
          });
        });
        if (!nodes.length) return;              // pure power/annotation net
        nodes.sort(function (a, b) { return natCmp(a.ref, b.ref) || natCmp(a.num, b.num); });
        nets.push({ name: n.name, nodes: nodes });
      });
    }
    nets.sort(function (a, b) { return natCmp(a.name, b.name); });

    return { components: comps, libparts: libparts, nets: nets };
  }

  /**
   * formatNetlist(data, meta) -> text
   * meta: { source?, date?, tool? } — pass a fixed date for determinism.
   */
  function formatNetlist(data, meta) {
    meta = meta || {};
    var L = [];
    L.push('(export (version "D")');
    L.push('  (design');
    L.push('    (source ' + q(meta.source || 'kipad-schematic.kicad_sch') + ')');
    L.push('    (date ' + q(meta.date || kicadDate(new Date())) + ')');
    L.push('    (tool ' + q(meta.tool || 'Kipad PWA') + ')');
    L.push('  )');

    L.push('  (components');
    data.components.forEach(function (c) {
      L.push('    (comp (ref ' + q(c.ref) + ')');
      L.push('      (value ' + q(c.value) + ')');
      if (c.footprint) L.push('      (footprint ' + q(c.footprint) + ')');
      L.push('      (libsource (lib ' + q(c.lib) + ') (part ' + q(c.part) + ')' +
             (c.desc ? ' (description ' + q(c.desc) + ')' : '') + ')');
      L.push('      (sheetpath (names /) (tstamps /))');
      L.push('    )');
    });
    L.push('  )');

    L.push('  (libparts');
    data.libparts.forEach(function (lp) {
      L.push('    (libpart (lib ' + q(lp.lib) + ') (part ' + q(lp.part) + ')');
      if (lp.desc) L.push('      (description ' + q(lp.desc) + ')');
      if (lp.footprintHint) L.push('      (footprints (fp ' + q(lp.footprintHint) + '))');
      L.push('      (fields');
      L.push('        (field (name "Reference") ' + q(lp.refPrefix) + ')');
      L.push('        (field (name "Value") ' + q(lp.value) + '))');
      if (lp.pins.length) {
        L.push('      (pins');
        lp.pins.forEach(function (p, i) {
          L.push('        (pin (num ' + q(p.num) + ') (name ' + q(p.name) + ') (type ' + q(p.type) + '))' + (i + 1 < lp.pins.length ? '' : ')'));
        });
      }
      L.push('    )');
    });
    L.push('  )');

    L.push('  (nets');
    data.nets.forEach(function (n, i) {
      L.push('    (net (code ' + q(String(i + 1)) + ') (name ' + q(n.name) + ')');
      n.nodes.forEach(function (nd) {
        var extra = '';
        if (nd.pinfunction != null) extra += ' (pinfunction ' + q(nd.pinfunction) + ')';
        if (nd.pintype != null) extra += ' (pintype ' + q(nd.pintype) + ')';
        L.push('      (node (ref ' + q(nd.ref) + ') (pin ' + q(nd.num) + ')' + extra + ')');
      });
      L.push('    )');
    });
    L.push('  )');
    L.push(')');
    return L.join('\n') + '\n';
  }

  /** KiCad-style UTC date: "Mon 24 Aug 2026 15:36:00 UTC" */
  function kicadDate(d) {
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return days[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' +
           d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' +
           p(d.getUTCSeconds()) + ' UTC';
  }

  /** exportNetlist(sch, getSymbol, opts) -> { text, data } */
  function exportNetlist(sch, getSymbol, opts) {
    var data = collect(sch, getSymbol, opts);
    return { text: formatNetlist(data, opts && opts.meta), data: data };
  }

  return {
    collect: collect,
    formatNetlist: formatNetlist,
    exportNetlist: exportNetlist,
    natCmp: natCmp,
    kicadDate: kicadDate,
    splitLibId: splitLibId
  };
});
