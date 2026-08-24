'use strict';

/**
 * KipadSchematic — schematic capture model (Eeschema-like).
 *
 * Pure data + logic, no canvas. UMD: browser global `KipadSchematic` /
 * CommonJS.
 *
 * Schematic model:
 *   { version, paper,
 *     symbols:  [ {id, libId, ref, value, at:[x,y], angle, unit, footprint} ],
 *     wires:    [ {id, pts:[[x,y],...]} ],
 *     labels:   [ {id, text, at:[x,y], angle} ],
 *     junctions:[ {id, at:[x,y]} ],
 *     noConnects:[ {id, at:[x,y]} ] }
 *
 * Pins are resolved from the symbol registry (KipadSymbols) at netlist time.
 * Supports .kicad_sch (KiCad 8) round-trip and "Update PCB from Schematic".
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadSchematic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var GR = root || globalThis;
  var EPS = 0.005;           // mm coincidence tolerance
  var idCounter = 1;
  function nid(prefix) { return (prefix || 's') + (idCounter++); }
  function rotate(rel, deg) {
    var r = deg * Math.PI / 180;
    var c = Math.cos(r), s = Math.sin(r);
    return [rel[0] * c - rel[1] * s, rel[0] * s + rel[1] * c];
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function pointSegDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var L2 = dx * dx + dy * dy;
    if (L2 === 0) return dist(p, a);
    var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    return dist(p, [a[0] + t * dx, a[1] + t * dy]);
  }

  // ---------- model ----------

  function makeSchematic() {
    return { version: '20231120', paper: 'A4', symbols: [], wires: [], labels: [], junctions: [], noConnects: [] };
  }

  /**
   * placeSymbol(sch, name, at, angle) — add a symbol instance from the
   * registry (passed in as `getSymbol` callback or read from KipadSymbols).
   * Returns the new symbol object.
   */
  function placeSymbol(sch, name, at, angle, refOverride, getSymbol) {
    var gs = getSymbol || (GR.KipadSymbols ? GR.KipadSymbols.getSymbol : null);
    var def = gs ? gs(name) : null;
    var prefix = (def && def.ref) ? def.ref : (refOverride ? refOverride.replace(/[0-9]+$/, '') : 'U');
    var existing = sch.symbols.filter(function (s) { return s.ref && s.ref.replace(/[0-9]+$/, '') === prefix; });
    var num = existing.length + 1;
    var sym = {
      id: nid('sym'), libId: name, ref: refOverride || (prefix + num),
      value: (def && def.value) ? def.value : name,
      at: [at[0], at[1]], angle: angle || 0, unit: 1,
      footprint: (def && def.footprint) ? def.footprint : ''
    };
    sch.symbols.push(sym);
    return sym;
  }

  function addWire(sch, pts) {
    if (!pts || pts.length < 2) return null;
    var w = { id: nid('w'), pts: pts.map(function (p) { return [p[0], p[1]]; }) };
    sch.wires.push(w);
    return w;
  }

  // type: 'local' (default) | 'global' — KiCad label flavours. Both name the
  // net the same way; only rendering and serialization differ.
  function addLabel(sch, text, at, angle, type) {
    var l = { id: nid('lbl'), text: String(text), at: [at[0], at[1]], angle: angle || 0,
              type: type === 'global' ? 'global' : 'local' };
    sch.labels.push(l);
    return l;
  }

  function addJunction(sch, at) {
    var j = { id: nid('j'), at: [at[0], at[1]] };
    sch.junctions.push(j);
    return j;
  }

  /**
   * addNoConnect(sch, at) — KiCad-style no-connect flag: an X marker placed
   * on a pin tip to state "intentionally unconnected". Purely a marker — it
   * does NOT join anything electrically; ERC just exempts the flagged pin.
   */
  function addNoConnect(sch, at) {
    if (!Array.isArray(sch.noConnects)) sch.noConnects = [];
    var nc = { id: nid('nc'), at: [at[0], at[1]] };
    sch.noConnects.push(nc);
    return nc;
  }

  function removeNoConnect(sch, id) {
    if (!Array.isArray(sch.noConnects)) return false;
    var before = sch.noConnects.length;
    sch.noConnects = sch.noConnects.filter(function (n) { return n.id !== id; });
    return sch.noConnects.length < before;
  }

  function moveSymbol(sch, symId, at) {
    var s = sch.symbols.find(function (x) { return x.id === symId; });
    if (s) { s.at = [at[0], at[1]]; return s; }
    return null;
  }

  /**
   * pinPositions(symbol, getSymbol) -> [{number, name, type, at:[x,y]}]
   * Absolute pin connection points in schematic space.
   */
  function pinPositions(sym, getSymbol) {
    var gs = getSymbol || (GR.KipadSymbols ? GR.KipadSymbols.getSymbol : null);
    var def = gs ? gs(sym.libId) : null;
    if (!def || !def.pins) return [];
    return def.pins.map(function (p) {
      var rel = rotate(p.at, sym.angle);
      return { number: p.number, name: p.name, type: p.type, at: [sym.at[0] + rel[0], sym.at[1] + rel[1]] };
    });
  }

  /**
   * connectivity(sch, getSymbol) -> [{ pins, labels:[{text,id,at}], powerName }]
   * Union-find over wire vertices, pin connection points and label anchors.
   * Each group is one electrical node: the pins on it, the labels attached to
   * it (with ids + positions for ERC locating) and the power net name derived
   * from power symbols (value GND/VCC/+5V/... or pin name). Shared by
   * extractNets (netlist) and ERC (js/erc.js) so both use the same topology.
   */
  function connectivity(sch, getSymbol) {
    var parent = [];
    function find(a) { while (parent[a] !== undefined && parent[a] !== a) a = parent[a]; return a; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

    // Nodes: wire vertices (index 0..W-1), then junctions, then pins, then labels.
    var nodes = [];
    var pinRefs = [];       // { symId, number, name, type, at, symValue }
    var labelRefs = [];     // { text, id, at }

    sch.wires.forEach(function (w) { w.pts.forEach(function () { nodes.push({ kind: 'wire' }); }); });
    sch.junctions.forEach(function () { nodes.push({ kind: 'junction' }); });
    sch.symbols.forEach(function (sym) {
      pinPositions(sym, getSymbol).forEach(function (p) {
        pinRefs.push({ symId: sym.id, number: p.number, name: p.name, type: p.type, at: p.at, symValue: sym.value });
        nodes.push({ kind: 'pin' });
      });
    });
    sch.labels.forEach(function (l) { labelRefs.push({ text: l.text, id: l.id, at: l.at }); nodes.push({ kind: 'label' }); });

    // Consecutive wire vertices are connected.
    var vi = 0;
    sch.wires.forEach(function (w) {
      for (var i = 0; i + 1 < w.pts.length; i++) union(vi + i, vi + i + 1);
      vi += w.pts.length;
    });

    // Merge any nodes closer than EPS.
    for (var a = 0; a < nodes.length; a++) {
      for (var b = a + 1; b < nodes.length; b++) {
        var pa = nodePos(nodes, a, sch, pinRefs);
        var pb = nodePos(nodes, b, sch, pinRefs);
        if (pa && pb && dist(pa, pb) <= EPS) union(a, b);
      }
    }

    // Labels merge with the nearest node or wire segment if within 1.0 mm.
    labelRefs.forEach(function (lt, li) {
      var liNode = nodes.length - labelRefs.length + li;
      var best = -1, bestD = 1.0;
      // 1) exact node proximity
      for (var k = 0; k < nodes.length; k++) {
        if (k === liNode) continue;
        var p = nodePos(nodes, k, sch, pinRefs);
        if (p) { var d = dist(p, lt.at); if (d <= bestD) { bestD = d; best = k; } }
      }
      // 2) wire segment proximity (label may sit mid-segment)
      var vIdx = 0;
      for (var wi = 0; wi < sch.wires.length; wi++) {
        var w = sch.wires[wi];
        for (var si = 0; si + 1 < w.pts.length; si++) {
          var d = pointSegDist(lt.at, w.pts[si], w.pts[si + 1]);
          if (d <= bestD) { bestD = d; best = vIdx + si; }
        }
        vIdx += w.pts.length;
      }
      if (best >= 0) union(liNode, best);
    });

    // Group by root.
    var groups = {};
    for (var n = 0; n < nodes.length; n++) {
      var r = find(n);
      (groups[r] = groups[r] || []).push(n);
    }

    var out = [];
    Object.keys(groups).forEach(function (r) {
      var members = groups[r];
      var labels = [], pins = [], powerName = null, wired = false;
      members.forEach(function (idx) {
        if (nodes[idx].kind === 'wire' || nodes[idx].kind === 'junction') wired = true;
        if (nodes[idx].kind === 'label') labels.push(labelRefs[idx - wireAndJunctionCount(sch) - pinRefs.length]);
        if (nodes[idx].kind === 'pin') {
          var pr = pinRefs[idx - wireAndJunctionCount(sch)];
          pins.push(pr);
          if (pr.type === 'power_in' && !powerName) {
            var v = String(pr.symValue || '').trim();
            if (v && /^[A-Za-z0-9_+.-]+$/.test(v) && v.toUpperCase() !== 'POWER') powerName = v;
            else if (pr.name) powerName = pr.name;
          }
        }
      });
      if (!pins.length && !labels.length) return;
      out.push({ pins: pins, labels: labels, powerName: powerName, wired: wired });
    });
    return out;
  }

  /**
   * extractNets(sch, getSymbol) -> [{ name, pins:[{symId, number, at}], labels:[text] }]
   * Nets without a label get an auto name (N-1, N-2, ...).
   * Power symbols (value GND/VCC/+5V/... ) name their net by value.
   */
  function extractNets(sch, getSymbol) {
    var auto = 0;
    var nets = [];
    connectivity(sch, getSymbol).forEach(function (g) {
      var labels = g.labels.map(function (l) { return l.text; });
      var name = labels[0] || g.powerName || ('N-' + (++auto));
      nets.push({ name: name, pins: g.pins, labels: labels });
    });

    // Merge nets sharing a name (global nets: VCC, GND, same label text).
    var byName = {};
    nets.forEach(function (net) {
      if (!byName[net.name]) byName[net.name] = { name: net.name, pins: [], labels: [] };
      byName[net.name].pins = byName[net.name].pins.concat(net.pins);
      byName[net.name].labels = byName[net.name].labels.concat(net.labels);
    });
    return Object.keys(byName).map(function (k) { return byName[k]; });
  }

  function wireAndJunctionCount(sch) {
    var w = 0;
    sch.wires.forEach(function (x) { w += x.pts.length; });
    return w + sch.junctions.length;
  }

  function nodePos(nodes, idx, sch, pinRefs) {
    var wc = 0;
    for (var i = 0; i < sch.wires.length; i++) {
      var w = sch.wires[i];
      if (idx < wc + w.pts.length) return w.pts[idx - wc];
      wc += w.pts.length;
    }
    if (idx < wc + sch.junctions.length) return sch.junctions[idx - wc].at;
    var p = pinRefs[idx - wc - sch.junctions.length];
    return p ? p.at : (sch.labels[idx - wc - sch.junctions.length - pinRefs.length] || {}).at;
  }

  // ---------- .kicad_sch serialization (KiCad 8) ----------

  function fmt(v) { return String(Math.round(v * 1000) / 1000); }

  function serializeSch(sch, getSymbol) {
    var gs = getSymbol || (GR.KipadSymbols ? GR.KipadSymbols.getSymbol : null);
    var L = [];
    L.push('(kicad_sch');
    L.push('  (version 20231120)');
    L.push('  (generator "eeschema")');
    L.push('  (generator_version "8.0")');
    L.push('  (uuid "' + (sch.uuid || '00000000-0000-0000-0000-000000000000') + '")');
    L.push('  (paper "' + (sch.paper || 'A4') + '")');
    if (gs) {
      L.push('  (lib_symbols');
      sch.symbols.forEach(function (sym) {
        var def = gs(sym.libId);
        if (!def) return;
        var libName = sym.libId.indexOf(':') >= 0 ? sym.libId : (isPower(sym) ? 'power:' + sym.libId : 'Device:' + sym.libId);
        L.push('    (symbol "' + libName + '"');
        L.push('      (pin_names (offset 1.016)) (in_bom yes) (on_board yes)');
        L.push('      (property "Reference" "' + (def.ref || 'U') + '" (at 0 3.81 0) (effects (font (size 1.27 1.27))))');
        L.push('      (property "Value" "' + (def.value || sym.libId) + '" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))');
        // body graphics
        var gi = 0;
        (def.graphics || []).forEach(function (g) {
          gi++;
          if (g.type === 'rect') {
            L.push('      (symbol "' + sym.libId.replace(/[^A-Za-z0-9]/g, '') + '_0_' + gi + '" (rectangle (start ' + fmt(g.start[0]) + ' ' + fmt(g.start[1]) + ') (end ' + fmt(g.end[0]) + ' ' + fmt(g.end[1]) + ') (stroke (width 0.254) (type default)) (fill (type none))))');
          } else if (g.type === 'polyline') {
            L.push('      (symbol "' + sym.libId.replace(/[^A-Za-z0-9]/g, '') + '_0_' + gi + '" (polyline (pts' + g.pts.map(function (p) { return ' (xy ' + fmt(p[0]) + ' ' + fmt(p[1]) + ')'; }).join('') + ') (stroke (width 0.254) (type default)) (fill (type none))))');
          } else if (g.type === 'circle') {
            L.push('      (symbol "' + sym.libId.replace(/[^A-Za-z0-9]/g, '') + '_0_' + gi + '" (circle (center ' + fmt(g.center[0]) + ' ' + fmt(g.center[1]) + ') (radius ' + fmt(g.r) + ') (stroke (width 0.254) (type default)) (fill (type none))))');
          }
        });
        // pins
        (def.pins || []).forEach(function (p, pi) {
          L.push('      (symbol "' + sym.libId.replace(/[^A-Za-z0-9]/g, '') + '_1_' + (pi + 1) + '" (pin ' + (p.type || 'passive') + ' line (at ' + fmt(p.at[0]) + ' ' + fmt(p.at[1]) + ' ' + fmt(p.angle || 0) + ') (length ' + fmt(p.length || 2.54) + ') (name "' + (p.name || '') + '" (effects (font (size 1.27 1.27)))) (number "' + p.number + '" (effects (font (size 1.27 1.27))))))');
        });
        L.push('    )');
      });
      L.push('  )');
    }
    // instances
    sch.symbols.forEach(function (sym) {
      var libName = sym.libId.indexOf(':') >= 0 ? sym.libId : (isPower(sym) ? 'power:' + sym.libId : 'Device:' + sym.libId);
      L.push('  (symbol');
      L.push('    (lib_id "' + libName + '")');
      L.push('    (at ' + fmt(sym.at[0]) + ' ' + fmt(sym.at[1]) + ' ' + fmt(sym.angle || 0) + ')');
      L.push('    (unit 1) (in_bom yes) (on_board yes) (dnp no)');
      L.push('    (uuid "' + (sym.uuid || '00000000-0000-0000-0000-000000000000') + '")');
      L.push('    (property "Reference" "' + sym.ref + '" (at 0 0 0) (effects (font (size 1.27 1.27))) (uuid "00000000-0000-0000-0000-000000000000"))');
      L.push('    (property "Value" "' + sym.value + '" (at 0 0 0) (effects (font (size 1.27 1.27))) (uuid "00000000-0000-0000-0000-000000000000"))');
      if (sym.footprint) L.push('    (property "Footprint" "' + sym.footprint + '" (at 0 0 0) (effects (font (size 1.27 1.27)) hide) (uuid "00000000-0000-0000-0000-000000000000"))');
      L.push('    (instances (project "kipad" (path "/" (reference "' + sym.ref + '") (unit 1))))');
      L.push('  )');
    });
    sch.wires.forEach(function (w) {
      L.push('  (wire (pts' + w.pts.map(function (p) { return ' (xy ' + fmt(p[0]) + ' ' + fmt(p[1]) + ')'; }).join('') + ') (stroke (width 0) (type default)) (uuid "00000000-0000-0000-0000-000000000000"))');
    });
    sch.junctions.forEach(function (j) {
      L.push('  (junction (at ' + fmt(j.at[0]) + ' ' + fmt(j.at[1]) + ') (diameter 0) (color 0 0 0 0) (uuid "00000000-0000-0000-0000-000000000000"))');
    });
    sch.labels.forEach(function (l) {
      if (l.type === 'global') {
        L.push('  (global_label "' + l.text + '" (at ' + fmt(l.at[0]) + ' ' + fmt(l.at[1]) + ' ' + fmt(l.angle || 0) + ') (shape input) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "00000000-0000-0000-0000-000000000000"))');
      } else {
        L.push('  (label "' + l.text + '" (at ' + fmt(l.at[0]) + ' ' + fmt(l.at[1]) + ' ' + fmt(l.angle || 0) + ') (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "00000000-0000-0000-0000-000000000000"))');
      }
    });
    (sch.noConnects || []).forEach(function (nc) {
      L.push('  (no_connect (at ' + fmt(nc.at[0]) + ' ' + fmt(nc.at[1]) + ') (uuid "00000000-0000-0000-0000-000000000000"))');
    });
    L.push(')');
    return L.join('\n');
  }

  function isPower(sym) { return /^(GND|VCC|VP|VN|\+5V|\+3V3|-5V|VSS|VDD|PWR)/i.test(sym.value || sym.libId); }

  /** Parse .kicad_sch text into a schematic model (registry-based symbols). */
  function parseSch(text, getSymbol) {
    var Sexp = GR.KipadSexpr || (typeof require !== 'undefined' ? require('./sexpr.js') : null);
    var tree = Sexp.parse(text);
    var sch = makeSchematic();
    var rootNode = tree;
    if (!rootNode || rootNode[0] !== 'kicad_sch') throw new Error('Not a .kicad_sch file');

    rootNode.slice(1).forEach(function (node) {
      var tag = node[0];
      if (tag === 'paper') sch.paper = str(node[1]) || 'A4';
      else if (tag === 'symbol') {
        var libId = '';
        var at = [0, 0], angle = 0;
        var ref = '', value = '', fp = '';
        node.forEach(function (child, i) {
          if (i === 0) return;
          if (child[0] === 'lib_id') libId = str(child[1]);
          else if (child[0] === 'at') { at = [num(child[1]), num(child[2])]; angle = num(child[3]) || 0; }
          else if (child[0] === 'property') {
            var key = str(child[1]);
            if (key === 'Reference') ref = str(child[2]);
            if (key === 'Value') value = str(child[2]);
            if (key === 'Footprint') fp = str(child[2]);
          }
        });
        var name = libId.indexOf(':') >= 0 ? libId.slice(libId.indexOf(':') + 1) : libId;
        var def = getSymbol ? getSymbol(name) : null;
        sch.symbols.push({
          id: nid('sym'), libId: name, ref: ref || 'U', value: value || name,
          at: at, angle: angle, unit: 1, footprint: fp || ((def && def.footprint) ? def.footprint : '')
        });
      } else if (tag === 'wire') {
        var pts = [];
        node.forEach(function (child) {
          if (child[0] === 'pts') child.slice(1).forEach(function (xy) { pts.push([num(xy[1]), num(xy[2])]); });
        });
        if (pts.length >= 2) addWire(sch, pts);
      } else if (tag === 'junction') {
        var jat = [0, 0];
        node.forEach(function (child) { if (child[0] === 'at') jat = [num(child[1]), num(child[2])]; });
        addJunction(sch, jat);
      } else if (tag === 'no_connect') {
        var nat = [0, 0];
        node.forEach(function (child) { if (child[0] === 'at') nat = [num(child[1]), num(child[2])]; });
        addNoConnect(sch, nat);
      } else if (tag === 'label' || tag === 'global_label') {
        var text = str(node[1]);
        var lat = [0, 0], lang = 0;
        node.forEach(function (child) { if (child[0] === 'at') { lat = [num(child[1]), num(child[2])]; lang = num(child[3]) || 0; } });
        addLabel(sch, text, lat, lang, tag === 'global_label' ? 'global' : 'local');
      }
    });
    return sch;
  }

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function str(v) { if (v && typeof v === 'object' && 'q' in v) return String(v.q); return v === undefined || v === null ? '' : String(v); }

  function addNetSafe(board, name) {
    if (!name) return 0;
    var n = board.nets.find(function (x) { return x.name === name; });
    if (n) return n.id;
    var id = board.nets.length;
    board.nets.push({ id: id, name: name });
    return id;
  }

  // ---------- Update PCB from Schematic ----------

  /**
   * updatePCB(sch, board, opts) — place footprints for each symbol, map pads
   * to nets via the netlist. opts: { getSymbol, getFootprint(name)->fp|bool,
   * fallbackFootprint(ref)->name, layer }
   * Returns board (mutated) with footprints + nets added.
   */
  function updatePCB(sch, board, opts) {
    var getSymbol = opts.getSymbol || (GR.KipadSymbols ? GR.KipadSymbols.getSymbol : null);
    var getFootprint = opts.getFootprint || null;
    var fallback = opts.fallbackFootprint || function (ref) {
      var p = ref.replace(/[0-9]+$/, '');
      var map = { R: 'R_0603_1608Metric', C: 'C_0805_2012Metric', D: 'D_SOD-123', Q: 'SOT-23', U: 'SOIC-8_3.9x4.9mm_P1.27mm', J: 'PinHeader_1x04_P2.54mm_Vertical', L: 'L_0603_1608Metric', SW: 'SW_SPST_PTS645' };
      return map[p] || null;
    };
    var layer = opts.layer || 'F.Cu';

    var nets = extractNets(sch, getSymbol);
    var netByName = {};
    nets.forEach(function (n) {
      var name = String(n.name || '').trim();
      if (!name) return;                      // unlabeled floating islands stay unconnected
      var id = addNetSafe(board, name);
      netByName[name] = { id: id, pins: n.pins };
    });

    sch.symbols.forEach(function (sym) {
      // resolve footprint name
      var fpName = null;
      if (sym.footprint) fpName = sym.footprint.indexOf(':') >= 0 ? sym.footprint.slice(sym.footprint.indexOf(':') + 1) : sym.footprint;
      if (!fpName && fallback) fpName = fallback(sym.ref);
      if (!fpName) return;
      if (getFootprint && !getFootprint(fpName)) fpName = fallback ? fallback(sym.ref) : fpName;
      if (!fpName) return;

      // place (ref override must be the prefix, placeFootprint appends a number)
      var placed = null;
      var refPrefix = sym.ref.replace(/[0-9]+$/, '');
      try { placed = GR.KipadBoard.placeFootprint(board, fpName, sym.at, Math.round(sym.angle / 90) * 90, layer, refPrefix); }
      catch (e) { /* footprint not in registry */ }
      if (!placed) return;

      // map pad numbers -> net
      var pins = pinPositions(sym, getSymbol);
      var pinNet = {};
      pins.forEach(function (p) {
        var n = nets.filter(function (x) { return x.pins.some(function (q) { return q.symId === sym.id && q.number === p.number; }); })[0];
        if (n) pinNet[p.number] = netByName[n.name] ? netByName[n.name].id : null;
      });
      (placed.pads || []).forEach(function (pad) {
        if (pinNet[pad.number] !== undefined && pinNet[pad.number] !== null) pad.netId = pinNet[pad.number];
      });
    });
    return board;
  }

  // ---------- helpers ----------

  /** Autonumber refs so each instance is unique (R1, R2, ...). */
  function renumberRefs(sch) {
    var seen = {};
    sch.symbols.forEach(function (s) {
      var p = s.ref.replace(/[0-9]+$/, '');
      var n = (seen[p] || 0) + 1;
      seen[p] = n;
      s.ref = p + n;
    });
  }

  return {
    makeSchematic: makeSchematic, placeSymbol: placeSymbol, addWire: addWire,
    addLabel: addLabel, addJunction: addJunction, addNoConnect: addNoConnect, removeNoConnect: removeNoConnect,
    moveSymbol: moveSymbol, pinPositions: pinPositions,
    connectivity: connectivity, extractNets: extractNets, serializeSch: serializeSch, parseSch: parseSch,
    updatePCB: updatePCB, renumberRefs: renumberRefs, isPower: isPower, EPS: EPS
  };
});
