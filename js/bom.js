'use strict';

/**
 * KipadBom — KiCad-style bill of materials (BOM) generator for schematics.
 *
 * Produces the same family of output as KiCad's Tools > Generate BOM:
 * physical components grouped by Value + Footprint with their reference
 * designators and a quantity column.
 *
 * Conventions (KiCad parity):
 *  - Power symbols are excluded — they are electrical annotations, not
 *    physical parts. Uses KipadSchematic.isPower so ERC/netlist/BOM always
 *    agree on what counts as a power symbol.
 *  - KiCad '#'-prefixed refs (#PWR01-style annotations) are excluded too.
 *  - Refs sort naturally inside groups (R2 before R10); groups order by
 *    their first ref (C1 < L1 < R1 < U1).
 *  - CSV: header `Ref,Qnty,Value,Footprint`; fields containing comma,
 *    quote or whitespace get RFC-4180 quoting; refs join with single
 *    spaces ("R1 R2").
 *
 * UMD: browser global `KipadBom` / CommonJS module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadBom = factory();
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var GR = root || globalThis;

  function schMod() {
    return GR.KipadSchematic || (typeof require !== 'undefined' ? require('./schematic.js') : null);
  }

  /**
   * natCmp(a, b) — natural sort: digit runs compare numerically, text runs
   * case-insensitively, so "R2" < "R10" and "C1" < "c2".
   */
  function natCmp(a, b) {
    var ra = String(a), rb = String(b), i = 0, j = 0;
    while (i < ra.length && j < rb.length) {
      var ca = ra[i], cb = rb[j];
      var da = /[0-9]/.test(ca), db = /[0-9]/.test(cb);
      if (da && db) {
        var sa = i, sb = j;
        while (i < ra.length && /[0-9]/.test(ra[i])) i++;
        while (j < rb.length && /[0-9]/.test(rb[j])) j++;
        var na = parseInt(ra.slice(sa, i), 10);
        var nb = parseInt(rb.slice(sb, j), 10);
        if (na !== nb) return na - nb;
        if (sa !== sb) return sa - sb; // leading zeros keep shorter first
      } else {
        ca = ca.toLowerCase(); cb = cb.toLowerCase();
        if (ca !== cb) return ca < cb ? -1 : 1;
        i++; j++;
      }
    }
    return (ra.length - i) - (rb.length - j);
  }

  /**
   * collect(sch, opts?) -> [{ refs:[...], qty, value, footprint }]
   * opts.isPower(sym) overrides the power-symbol predicate (defaults to
   * KipadSchematic.isPower). Deterministic.
   */
  function collect(sch, opts) {
    var Sch = schMod();
    var isPower = (opts && opts.isPower) || (Sch && Sch.isPower) || function () { return false; };
    var groups = {};   // key -> row
    var order = [];    // group keys in first-seen order
    var syms = (sch && sch.symbols) || [];

    for (var i = 0; i < syms.length; i++) {
      var s = syms[i];
      var ref = String(s.ref || '');
      if (!ref || ref[0] === '#') continue;          // annotation refs
      if (isPower(s)) continue;                       // GND/VCC/... not parts
      var value = String(s.value == null ? '' : s.value);
      var fp = String(s.footprint == null ? '' : s.footprint);
      var key = value + '\u0000' + fp;
      if (!groups[key]) { groups[key] = { refs: [], qty: 0, value: value, footprint: fp }; order.push(key); }
      groups[key].refs.push(ref);
      groups[key].qty++;
    }

    order.sort(function (ka, kb) { return natCmp(groups[ka].refs[0], groups[kb].refs[0]); });
    return order.map(function (k) {
      var g = groups[k];
      g.refs.sort(natCmp);
      return g;
    });
  }

  /** csvField(v) — quote only when the field needs it (RFC 4180). */
  function csvField(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n ]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /**
   * formatCsv(rows) -> BOM CSV text (header + one grouped line per part).
   */
  function formatCsv(rows) {
    var out = ['Ref,Qnty,Value,Footprint'];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push(csvField(r.refs.join(' ')) + ',' + r.qty + ',' + csvField(r.value) + ',' + csvField(r.footprint));
    }
    return out.join('\n') + '\n';
  }

  /**
   * exportBom(sch, opts?) -> { rows, csv }
   */
  function exportBom(sch, opts) {
    var rows = collect(sch, opts);
    return { rows: rows, csv: formatCsv(rows) };
  }

  return {
    collect: collect,
    formatCsv: formatCsv,
    exportBom: exportBom,
    natCmp: natCmp
  };
});
