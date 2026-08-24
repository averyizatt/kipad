'use strict';

/**
 * KipadSymFields — KiCad-style "Edit Symbol Fields" model helpers.
 *
 * Backs the schematic Tools > Edit Symbol Fields dialog: one row per
 * physical (non-power, non-annotation) symbol exposing the fields that
 * drive ERC / BOM / netlist / Update-PCB:
 *   ref        reference designator ("R3")
 *   value      value field ("10k")
 *   footprint  footprint assignment ("Resistor_SMD:R_0603_1608Metric", "" = unassigned)
 *
 * Conventions (KiCad parity):
 *  - Power symbols are excluded via KipadSchematic.isPower so fields/BOM/
 *    ERC/netlist always agree on what counts as a power symbol.
 *  - '#'-prefixed refs (#PWR01-style annotations) are excluded too.
 *  - Rows sort naturally by ref (R2 < R10).
 *  - applyRow never clears a ref to empty/whitespace (KiCad keeps the old
 *    designator; use Delete on the canvas to remove parts). Value and
 *    footprint MAY be cleared — unassigned is a legal state.
 *
 * UMD: browser global `KipadSymFields` / CommonJS module.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadSymFields = factory();
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var GR = root || globalThis;

  function schMod() {
    return GR.KipadSchematic || (typeof require !== 'undefined' ? require('./schematic.js') : null);
  }

  /** natCmp(a, b) — natural sort: digit runs compare numerically. */
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
        if (sa !== sb) return sa - sb;
      } else {
        ca = ca.toLowerCase(); cb = cb.toLowerCase();
        if (ca !== cb) return ca < cb ? -1 : 1;
        i++; j++;
      }
    }
    return (ra.length - i) - (rb.length - j);
  }

  function isPhysical(sym) {
    var Sch = schMod();
    if (Sch && typeof Sch.isPower === 'function' && Sch.isPower(sym)) return false;
    if (/^#/.test(sym.ref || '')) return false;
    return true;
  }

  /**
   * rows(sch) — editable symbol rows, natural-sorted by ref:
   * [{id, ref, value, footprint}]
   */
  function rows(sch) {
    var out = [];
    if (!sch || !Array.isArray(sch.symbols)) return out;
    sch.symbols.forEach(function (s) {
      if (!isPhysical(s)) return;
      out.push({
        id: s.id,
        ref: String(s.ref || ''),
        value: String(s.value || ''),
        footprint: String(s.footprint || '')
      });
    });
    out.sort(function (a, b) { return natCmp(a.ref, b.ref); });
    return out;
  }

  /**
   * applyRow(sym, patch) — mutate one symbol from dialog input values.
   * patch = {ref?, value?, footprint?} (raw input strings).
   * Returns array of changed field names (['ref','value',...]); empty when
   * nothing changed or the symbol is missing. Blank refs keep the old one.
   */
  function applyRow(sym, patch) {
    if (!sym || !patch) return [];
    var changed = [];
    if (typeof patch.ref === 'string') {
      var ref = patch.ref.trim();
      if (ref && ref !== sym.ref) { sym.ref = ref; changed.push('ref'); }
    }
    ['value', 'footprint'].forEach(function (k) {
      if (typeof patch[k] === 'string') {
        var v = patch[k].trim();
        var cur = String(sym[k] || '');
        if (v !== cur) { sym[k] = v; changed.push(k); }
      }
    });
    return changed;
  }

  return {
    rows: rows,
    applyRow: applyRow,
    natCmp: natCmp,
    isPhysical: isPhysical
  };
});
