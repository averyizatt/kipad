'use strict';

/**
 * KipadPcb — KiCad .kicad_pcb parser/serializer built on KipadSexpr.
 *
 * Canonical Board model (mm units, degrees):
 * {
 *   version: "20240108",
 *   nets: [ { id: number, name: string } ],            // id 0 always exists, name ""
 *   footprints: [ {
 *     id: string,            // unique instance id like "F1" (generated)
 *     lib: string,           // footprint library name
 *     ref: string,           // designator, e.g. "R1"
 *     value: string,         // e.g. "10k"
 *     at: [x, y],            // mm
 *     angle: number,         // degrees
 *     layer: "F.Cu" | "B.Cu",
 *     pads: [ {
 *       number: string,      // "1"
 *       type: "smd" | "tht",
 *       shape: "rect" | "circle" | "roundrect" | "obround",
 *       at: [x, y],          // ABSOLUTE mm (fp position + rotated pad offset)
 *       angle: number,       // absolute degrees
 *       size: [w, h],        // mm
 *       drill: number|null,  // mm, tht only
 *       radius: number|null, // roundrect corner radius
 *       layers: ["F.Cu","F.Paste","F.Mask"],  // copper layer first
 *       netId: number
 *     } ]
 *   } ],
 *   tracks: [ { id, start:[x,y], end:[x,y], width, layer, netId } ],
 *   vias:   [ { id, at:[x,y], size, drill, netId } ],
 *   outline: [ [[x,y], [x,y], ...], ... ]   // Edge.Cuts polylines
 * }
 *
 * Works as a browser <script> (global `KipadPcb`, requires global
 * `KipadSexpr`) and as a Node module (auto-requires ./sexpr.js).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./sexpr.js'));
  } else {
    root.KipadPcb = factory(root.KipadSexpr);
  }
})(typeof self !== 'undefined' ? self : this, function (KipadSexpr) {
  'use strict';

  if (!KipadSexpr) {
    throw new Error(
      'KipadPcb requires KipadSexpr: load sexpr.js first (browser) ' +
      'or require it (Node, handled automatically)'
    );
  }

  var DEG = Math.PI / 180;
  var EPS = 1e-9;
  var SHAPES = { rect: 1, circle: 1, roundrect: 1, obround: 1 };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function isList(x) { return Array.isArray(x); }
  function tag(x) { return isList(x) ? x[0] : null; }

  function atom(x) {
    if (x !== null && typeof x === 'object' && typeof x.q === 'string') return x.q;
    if (x === null || x === undefined) return '';
    return String(x);
  }

  function num(x) {
    var v = parseFloat(atom(x));
    return isNaN(v) ? 0 : v;
  }

  function str(x) {
    return (x === null || x === undefined) ? '' : String(x);
  }

  function r4(v) {
    return Math.round((v === null || v === undefined ? 0 : v) * 1e4) / 1e4;
  }

  function r4str(v) {
    return String(r4(v)); // String(-0) === "0", so -0 never leaks out
  }

  function normAngle(a) {
    a = (a === null || a === undefined) ? 0 : a;
    a = a % 360;
    if (a < 0) a += 360;
    return a;
  }

  // CCW rotation (KiCad convention: positive angle = counterclockwise).
  function rot(deg, x, y) {
    var a = deg * DEG;
    var c = Math.cos(a);
    var s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }

  function ptEq(a, b, eps) {
    eps = eps === undefined ? EPS : eps;
    return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
  }

  // ------------------------------------------------------------------
  // geometry: chain Edge.Cuts segments into polylines
  // ------------------------------------------------------------------

  function chainSegments(segs) {
    var used = new Array(segs.length).fill(false);
    var polylines = [];

    function findMatch(p) {
      for (var j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        if (ptEq(segs[j].a, p) || ptEq(segs[j].b, p)) return j;
      }
      return -1;
    }

    for (var i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      var chain = [segs[i].a.slice(), segs[i].b.slice()];

      // extend forward
      for (;;) {
        var last = chain[chain.length - 1];
        var j = findMatch(last);
        if (j < 0) break;
        used[j] = true;
        chain.push(ptEq(segs[j].a, last) ? segs[j].b.slice() : segs[j].a.slice());
        if (ptEq(chain[chain.length - 1], chain[0])) { chain.pop(); break; } // closed loop
      }
      // extend backward
      for (;;) {
        var first = chain[0];
        var k = findMatch(first);
        if (k < 0) break;
        used[k] = true;
        chain.unshift(ptEq(segs[k].b, first) ? segs[k].a.slice() : segs[k].b.slice());
        if (ptEq(chain[0], chain[chain.length - 1])) { chain.shift(); break; } // closed loop
      }

      polylines.push(chain);
    }
    return polylines;
  }

  // Approximate a gr_arc (start/mid/end, CCW or CW through mid) with a
  // sampled polyline.
  function arcToPolyline(s, m, e, samples) {
    samples = samples === undefined ? 64 : samples;
    var d = 2 * (s[0] * (m[1] - e[1]) + m[0] * (e[1] - s[1]) + e[0] * (s[1] - m[1]));
    if (Math.abs(d) < 1e-12) return [s.slice(), e.slice()]; // degenerate/collinear
    var s2 = s[0] * s[0] + s[1] * s[1];
    var m2 = m[0] * m[0] + m[1] * m[1];
    var e2 = e[0] * e[0] + e[1] * e[1];
    var cx = (s2 * (m[1] - e[1]) + m2 * (e[1] - s[1]) + e2 * (s[1] - m[1])) / d;
    var cy = (s2 * (e[0] - m[0]) + m2 * (s[0] - e[0]) + e2 * (m[0] - s[0])) / d;
    var r = Math.hypot(s[0] - cx, s[1] - cy);
    var a1 = Math.atan2(s[1] - cy, s[0] - cx);
    var am = Math.atan2(m[1] - cy, m[0] - cx);
    var a3 = Math.atan2(e[1] - cy, e[0] - cx);
    var toMid = (am - a1 + Math.PI * 2) % (Math.PI * 2);
    var toEnd = (a3 - a1 + Math.PI * 2) % (Math.PI * 2);
    var ccw = toMid < toEnd - 1e-9; // mid is reached before end going CCW
    var span = ccw ? toEnd : (a1 - a3 + Math.PI * 2) % (Math.PI * 2);
    var pts = [];
    for (var k = 0; k <= samples; k++) {
      var t = k / samples;
      var a = ccw ? a1 + span * t : a1 - span * t;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  // ------------------------------------------------------------------
  // parsing
  // ------------------------------------------------------------------

  function parseBoard(text) {
    var tree = KipadSexpr.parse(text);
    if (!isList(tree) || tag(tree) !== 'kicad_pcb') {
      throw new Error('KipadPcb.parseBoard: input is not a (kicad_pcb ...) file');
    }

    var board = {
      version: '20240108',
      nets: [],
      footprints: [],
      tracks: [],
      vias: [],
      texts: [],
      zones: [],
      outline: []
    };

    // ---- net table: supports BOTH legacy numeric ids ((nets N (net 1 "GND")))
    // and KiCad 10 named nets ((net "GND") without any (nets) block) ----
    var idToName = new Map(); // numeric id -> name
    var nameToId = new Map(); // name -> numeric id
    nameToId.set('', 0);
    var autoNetId = 1;

    function regName(name) {
      if (name === '') return 0;
      if (nameToId.has(name)) return nameToId.get(name);
      var id = autoNetId++;
      nameToId.set(name, id);
      idToName.set(id, name);
      return id;
    }

    function scanForNets(node) {
      if (!isList(node)) return;
      if (tag(node) === 'net' && node.length >= 2) {
        var first = node[1];
        if (first !== null && typeof first === 'object' && typeof first.q === 'string') {
          // KiCad 10 named style: (net "GND")
          regName(first.q);
        } else {
          // legacy: (net 1 "GND") or (net 1)
          var nid = Math.round(num(first));
          var nm = node.length >= 3 ? atom(node[2]) : (idToName.get(nid) || '');
          if (nm) { idToName.set(nid, nm); nameToId.set(nm, nid); }
          else if (!nameToId.has('')) nameToId.set('', nid);
        }
        return; // do not recurse into (net ...) contents
      }
      for (var i = 1; i < node.length; i++) scanForNets(node[i]);
    }
    scanForNets(tree);

    function resolveNetId(netNode) {
      if (!netNode || netNode.length < 2) return 0;
      var first = netNode[1];
      if (first !== null && typeof first === 'object' && typeof first.q === 'string') {
        return regName(first.q);
      }
      var id = Math.round(num(first));
      var nm = netNode.length >= 3 ? atom(netNode[2]) : (idToName.get(id) || '');
      if (nm) { idToName.set(id, nm); nameToId.set(nm, id); }
      return id;
    }

    // wildcard layer expansion (KiCad 10: (layers "*.Cu" "*.Mask"))
    function expandLayers(list) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var l = list[i];
        if (l === '*.Cu') { out.push('F.Cu', 'B.Cu'); }
        else if (l === '*.Mask') { out.push('F.Mask', 'B.Mask'); }
        else if (l === '*.Paste') { out.push('F.Paste', 'B.Paste'); }
        else if (l === '*.SilkS') { out.push('F.SilkS', 'B.SilkS'); }
        else out.push(l);
      }
      return out;
    }

    var edgeSegs = []; // {a:[x,y], b:[x,y]} pairs on Edge.Cuts
    var fpSeq = 0;
    var trSeq = 0;
    var viaSeq = 0;
    var zoneSeq = 0;
    var textSeq = 0;

    function childLayer(node) {
      var l = node.find(function (c) { return isList(c) && tag(c) === 'layer'; });
      return l ? atom(l[1]) : null;
    }
    function childAt(node, key) {
      return node.find(function (c) { return isList(c) && tag(c) === key; });
    }

    function parsePad(node, fpAt, fpAngle) {
      if (node.length < 4) return null;
      var number = atom(node[1]);
      var type = atom(node[2]) === 'smd' ? 'smd' : 'tht';
      var shapeRaw = atom(node[3]);
      var shape = SHAPES[shapeRaw] ? shapeRaw : 'rect';
      var local = [0, 0];
      var padAngle = 0;
      var size = [0, 0];
      var drill = null;
      var rratio = null;
      var layers = null;
      var netId = 0;

      for (var ci = 4; ci < node.length; ci++) {
        var c = node[ci];
        if (!isList(c)) continue;
        switch (tag(c)) {
          case 'at':
            local = [num(c[1]), num(c[2])];
            if (c.length > 3) padAngle = num(c[3]);
            break;
          case 'size':
            size = [num(c[1]), num(c[2])];
            break;
          case 'drill': {
            // (drill d) or (drill oval w h) — take the first number
            var dv = parseFloat(atom(c[1]));
            if (isNaN(dv) && c.length > 2) dv = parseFloat(atom(c[2]));
            drill = isNaN(dv) ? null : dv;
            break;
          }
          case 'layers':
            layers = expandLayers(c.slice(1).map(atom));
            break;
          case 'roundrect_rratio':
            rratio = num(c[1]);
            break;
          case 'net':
            netId = resolveNetId(c);
            break;
        }
      }

      // Absolute pad position: fp position + pad offset rotated by fp angle.
      var r = rot(fpAngle, local[0], local[1]);
      var abs = [fpAt[0] + r[0], fpAt[1] + r[1]];
      var radius = (rratio !== null && size[0] > 0 && size[1] > 0)
        ? rratio * Math.min(size[0], size[1])
        : null;

      return {
        number: number,
        type: type,
        shape: shape,
        at: abs,
        angle: normAngle(fpAngle + padAngle),
        size: size,
        drill: drill,
        radius: radius,
        layers: layers && layers.length
          ? layers
          : (type === 'smd' ? ['F.Cu', 'F.Paste', 'F.Mask'] : ['F.Cu', 'B.Cu']),
        netId: netId
      };
    }

    function parseFootprint(node) {
      var lib = atom(node[1]);
      var layer = 'F.Cu';
      var at = [0, 0];
      var angle = 0;
      var ref = '';
      var value = '';
      var pads = [];

      for (var ci = 2; ci < node.length; ci++) {
        var c = node[ci];
        if (!isList(c)) continue;
        switch (tag(c)) {
          case 'layer':
            layer = atom(c[1]);
            break;
          case 'at':
            at = [num(c[1]), num(c[2])];
            if (c.length > 3) angle = num(c[3]);
            break;
          case 'property': {
            var key = atom(c[1]);
            var val = c.length > 2 ? atom(c[2]) : '';
            if (key === 'Reference') ref = val;
            else if (key === 'Value') value = val;
            break;
          }
          case 'pad': {
            var p = parsePad(c, at, angle);
            if (p) pads.push(p);
            break;
          }
        }
      }

      return {
        id: 'F' + (++fpSeq),
        lib: lib,
        ref: ref,
        value: value,
        at: at,
        angle: normAngle(angle),
        layer: layer,
        pads: pads
      };
    }

    function parseSegment(node) {
      var start = null;
      var end = null;
      var width = 0;
      var layer = 'F.Cu';
      var netId = 0;
      for (var ci = 1; ci < node.length; ci++) {
        var c = node[ci];
        if (!isList(c)) continue;
        switch (tag(c)) {
          case 'start': start = [num(c[1]), num(c[2])]; break;
          case 'end': end = [num(c[1]), num(c[2])]; break;
          case 'width': width = num(c[1]); break;
          case 'layer': layer = atom(c[1]); break;
          case 'net': netId = resolveNetId(c); break;
        }
      }
      if (!start || !end) return null;
      return {
        id: 'T' + (++trSeq),
        start: start,
        end: end,
        width: width,
        layer: layer,
        netId: netId
      };
    }

    function parseVia(node) {
      var at = null;
      var size = 0;
      var drill = 0;
      var netId = 0;
      for (var ci = 1; ci < node.length; ci++) {
        var c = node[ci];
        if (!isList(c)) continue;
        switch (tag(c)) {
          case 'at': at = [num(c[1]), num(c[2])]; break;
          case 'size': size = num(c[1]); break;
          case 'drill': drill = num(c[1]); break;
          case 'net': netId = resolveNetId(c); break;
        }
      }
      if (!at) return null;
      return {
        id: 'V' + (++viaSeq),
        at: at,
        size: size,
        drill: drill,
        netId: netId
      };
    }

    function parseText(node) {
      var value = node.length > 1 ? atom(node[1]) : '';
      var at = [0, 0], angle = 0, layer = 'F.SilkS';
      var size = 1.5, thickness = 0.3, justify = 'center';
      for (var ci = 2; ci < node.length; ci++) {
        var c = node[ci];
        if (!isList(c)) continue;
        if (tag(c) === 'at') {
          at = [num(c[1]), num(c[2])];
          if (c.length > 3) angle = num(c[3]);
        } else if (tag(c) === 'layer') layer = atom(c[1]);
        else if (tag(c) === 'effects') {
          for (var ei = 1; ei < c.length; ei++) {
            var e = c[ei];
            if (!isList(e)) continue;
            if (tag(e) === 'font') {
              for (var fi = 1; fi < e.length; fi++) {
                var f = e[fi];
                if (isList(f) && tag(f) === 'size') size = num(f[1]) || size;
                if (isList(f) && tag(f) === 'thickness') thickness = num(f[1]) || thickness;
              }
            } else if (tag(e) === 'justify') {
              if (e.slice(1).map(atom).indexOf('left') >= 0) justify = 'left';
              else if (e.slice(1).map(atom).indexOf('right') >= 0) justify = 'right';
            }
          }
        }
      }
      if (layer !== 'F.SilkS' && layer !== 'B.SilkS') return null;
      return { id: 'TXT' + (++textSeq), text: value, at: at, angle: normAngle(angle), layer: layer,
        size: size, thickness: thickness, justify: justify };
    }

    // ---- top level ----
    for (var i = 1; i < tree.length; i++) {
      var child = tree[i];
      if (!isList(child)) continue;
      switch (tag(child)) {
        case 'version':
          board.version = atom(child[1]);
          break;

        case 'nets': {
          // (nets N (net id "name") ...) — already handled by scanForNets
          break;
        }

        case 'footprint': {
          var fp = parseFootprint(child);
          if (fp) board.footprints.push(fp);
          break;
        }

        case 'segment': {
          var t = parseSegment(child);
          if (t) board.tracks.push(t);
          break;
        }

        case 'via': {
          var v = parseVia(child);
          if (v) board.vias.push(v);
          break;
        }

        case 'gr_text': {
          var txt = parseText(child);
          if (txt) board.texts.push(txt);
          break;
        }

        case 'gr_line': {
          if (childLayer(child) !== 'Edge.Cuts') break;
          var gs = childAt(child, 'start');
          var ge = childAt(child, 'end');
          if (gs && ge) {
            edgeSegs.push({ a: [num(gs[1]), num(gs[2])], b: [num(ge[1]), num(ge[2])] });
          }
          break;
        }

        case 'gr_rect': {
          if (childLayer(child) !== 'Edge.Cuts') break;
          var rs = childAt(child, 'start');
          var re = childAt(child, 'end');
          if (rs && re) {
            var x1 = num(rs[1]), y1 = num(rs[2]);
            var x2 = num(re[1]), y2 = num(re[2]);
            edgeSegs.push(
              { a: [x1, y1], b: [x2, y1] },
              { a: [x2, y1], b: [x2, y2] },
              { a: [x2, y2], b: [x1, y2] },
              { a: [x1, y2], b: [x1, y1] }
            );
          }
          break;
        }

        case 'gr_arc': {
          if (childLayer(child) !== 'Edge.Cuts') break;
          var as = childAt(child, 'start');
          var am = childAt(child, 'mid');
          var ae = childAt(child, 'end');
          if (as && am && ae) {
            var apts = arcToPolyline(
              [num(as[1]), num(as[2])],
              [num(am[1]), num(am[2])],
              [num(ae[1]), num(ae[2])]
            );
            for (var ak = 0; ak + 1 < apts.length; ak++) {
              edgeSegs.push({ a: apts[ak], b: apts[ak + 1] });
            }
          }
          break;
        }

        case 'gr_poly': {
          if (childLayer(child) !== 'Edge.Cuts') break;
          var ptsNode = childAt(child, 'pts');
          if (ptsNode) {
            var pts = [];
            for (var pi = 1; pi < ptsNode.length; pi++) {
              var xy = ptsNode[pi];
              if (isList(xy) && tag(xy) === 'xy') pts.push([num(xy[1]), num(xy[2])]);
            }
            for (var pk = 0; pk + 1 < pts.length; pk++) {
              edgeSegs.push({ a: pts[pk], b: pts[pk + 1] });
            }
          }
          break;
        }

        case 'gr_circle': {
          if (childLayer(child) !== 'Edge.Cuts') break;
          var ctr = childAt(child, 'center');
          var ce = childAt(child, 'end');
          if (ctr && ce) {
            var cx = num(ctr[1]), cy = num(ctr[2]);
            var cr = Math.hypot(num(ce[1]) - cx, num(ce[2]) - cy);
            var cpts = [];
            for (var ck = 0; ck <= 64; ck++) {
              var ca = (ck / 64) * Math.PI * 2;
              cpts.push([cx + cr * Math.cos(ca), cy + cr * Math.sin(ca)]);
            }
            for (var ckk = 0; ckk + 1 < cpts.length; ckk++) {
              edgeSegs.push({ a: cpts[ckk], b: cpts[ckk + 1] });
            }
          }
          break;
        }
        case 'zone': {
          // Kipad copper pour round-trip: (zone (net N) (net_name "X")
          //   (layer "F.Cu") (polygon (pts (xy ...) ...)))
          var zNetId = 0, zNetName = '', zLayer = 'F.Cu', zOutline = [];
          for (var zi = 1; zi < child.length; zi++) {
            var zn = child[zi];
            if (!isList(zn)) continue;
            var zt = tag(zn);
            if (zt === 'net') {
              var zid = num(zn[1]);
              if (!isNaN(zid)) zNetId = zid;
            } else if (zt === 'net_name') {
              zNetName = atom(zn[1]);
            } else if (zt === 'layer') {
              var zl = atom(zn[1]);
              if (zl) zLayer = zl;
            } else if (zt === 'polygon' || zt === 'filled_polygon') {
              var zp = childAt(zn, 'pts');
              if (zp && !zOutline.length) {
                for (var qi = 1; qi < zp.length; qi++) {
                  var qxy = zp[qi];
                  if (isList(qxy) && tag(qxy) === 'xy') {
                    var qx = num(qxy[1]), qy = num(qxy[2]);
                    if (!isNaN(qx) && !isNaN(qy)) zOutline.push({ x: qx, y: qy });
                  }
                }
              }
            }
          }
          if (zOutline.length >= 3) {
            board.zones.push({
              id: 'Z' + (++zoneSeq),
              net: zNetName || (idToName.get(zNetId) || ''),
              layer: zLayer === 'B.Cu' ? 'B.Cu' : 'F.Cu',
              outline: zOutline
            });
          }
          break;
        }
        // everything else (images, dimensions, groups, ...) is ignored
      }
    }

    if (!idToName.has(0)) idToName.set(0, '');
    board.nets = Array.from(idToName.entries())
      .sort(function (a, b) { return a[0] - b[0]; })
      .map(function (e) { return { id: e[0], name: e[1] }; });

    board.outline = chainSegments(edgeSegs).filter(function (p) { return p.length >= 2; });

    return board;
  }

  // ------------------------------------------------------------------
  // serialization
  // ------------------------------------------------------------------

  function serializeFootprint(fp, netName) {
    var fx = fp.at ? fp.at[0] : 0;
    var fy = fp.at ? fp.at[1] : 0;
    var fpAngle = r4(fp.angle || 0);

    var atNode = fpAngle
      ? ['at', r4str(fx), r4str(fy), r4str(fpAngle)]
      : ['at', r4str(fx), r4str(fy)];

    var node = [
      'footprint',
      { q: str(fp.lib) },
      ['layer', { q: str(fp.layer || 'F.Cu') }],
      atNode,
      ['property', { q: 'Reference' }, { q: str(fp.ref) }, ['at', '0', '0'], ['layer', { q: 'F.SilkS' }]],
      ['property', { q: 'Value' }, { q: str(fp.value) }, ['at', '0', '0'], ['layer', { q: 'F.Fab' }]]
    ];

    for (var i = 0; i < (fp.pads || []).length; i++) {
      var pad = fp.pads[i];
      var dx = pad.at[0] - fx;
      var dy = pad.at[1] - fy;
      // inverse transform: rotate the absolute pad offset back by -fpAngle
      var local = rot(-fpAngle, dx, dy);
      var padAngle = r4(normAngle((pad.angle || 0) - fpAngle));
      var typeStr = pad.type === 'tht' ? 'thru_hole' : 'smd';
      var shapeStr = SHAPES[pad.shape] ? pad.shape : 'rect';
      var layers = pad.layers && pad.layers.length
        ? pad.layers
        : (pad.type === 'tht' ? ['F.Cu', 'B.Cu'] : ['F.Cu', 'F.Paste', 'F.Mask']);

      var padNode = [
        'pad',
        { q: str(pad.number) },
        typeStr,
        shapeStr,
        padAngle
          ? ['at', r4str(local[0]), r4str(local[1]), r4str(padAngle)]
          : ['at', r4str(local[0]), r4str(local[1])],
        ['size', r4str(pad.size[0]), r4str(pad.size[1])],
        ['layers'].concat(layers.map(function (l) { return { q: str(l) }; }))
      ];
      if (pad.type === 'tht' && pad.drill !== null && pad.drill !== undefined && !isNaN(pad.drill)) {
        padNode.push(['drill', r4str(pad.drill)]);
      }
      if (shapeStr === 'roundrect' && pad.radius !== null && pad.radius !== undefined &&
          pad.size[0] > 0 && pad.size[1] > 0) {
        padNode.push(['roundrect_rratio', r4str(pad.radius / Math.min(pad.size[0], pad.size[1]))]);
      }
      var netId = pad.netId === null || pad.netId === undefined ? 0 : pad.netId;
      padNode.push(['net', String(netId), { q: str(netName.get(netId) || '') }]);
      node.push(padNode);
    }

    return node;
  }

  function serializeBoard(board) {
    board = board || {};
    var nets = (board.nets || []).slice().sort(function (a, b) { return a.id - b.id; });
    var netName = new Map(nets.map(function (n) { return [n.id, n.name === null || n.name === undefined ? '' : n.name]; }));

    var root = [
      'kicad_pcb',
      ['version', str(board.version || '20240108')],
      ['generator', { q: 'kipad' }],
      ['general', ['thickness', '1.6']],
      ['layers',
        ['0', { q: 'F.Cu' }, 'signal'],
        ['31', { q: 'B.Cu' }, 'signal'],
        ['36', { q: 'B.SilkS' }, 'user', { q: 'b.Silkscreen' }],
        ['37', { q: 'F.SilkS' }, 'user', { q: 'f.Silkscreen' }],
        ['44', { q: 'Edge.Cuts' }, 'user']
      ],
      ['nets', String(nets.length)].concat(nets.map(function (n) {
        return ['net', String(n.id), { q: str(n.name) }];
      }))
    ];

    for (var i = 0; i < (board.footprints || []).length; i++) {
      root.push(serializeFootprint(board.footprints[i], netName));
    }
    for (var ti = 0; ti < (board.tracks || []).length; ti++) {
      var t = board.tracks[ti];
      root.push([
        'segment',
        ['start', r4str(t.start[0]), r4str(t.start[1])],
        ['end', r4str(t.end[0]), r4str(t.end[1])],
        ['width', r4str(t.width)],
        ['layer', { q: str(t.layer) }],
        ['net', String(t.netId)]
      ]);
    }
    for (var vi = 0; vi < (board.vias || []).length; vi++) {
      var v = board.vias[vi];
      root.push([
        'via',
        ['at', r4str(v.at[0]), r4str(v.at[1])],
        ['size', r4str(v.size)],
        ['drill', r4str(v.drill)],
        ['layers', { q: 'F.Cu' }, { q: 'B.Cu' }],
        ['net', String(v.netId)]
      ]);
    }
    for (var zi = 0; zi < (board.zones || []).length; zi++) {
      var zz = board.zones[zi];
      if (!zz.outline || zz.outline.length < 3) continue;
      var zNetId = 0;
      for (var ni2 = 0; ni2 < nets.length; ni2++) {
        if (nets[ni2].name === zz.net) { zNetId = nets[ni2].id; break; }
      }
      var ptsN = ['pts'];
      for (var pi2 = 0; pi2 < zz.outline.length; pi2++) {
        ptsN.push(['xy', r4str(zz.outline[pi2].x), r4str(zz.outline[pi2].y)]);
      }
      root.push([
        'zone',
        ['net', String(zNetId)],
        ['net_name', { q: str(zz.net || '') }],
        ['layer', { q: str(zz.layer === 'B.Cu' ? 'B.Cu' : 'F.Cu') }],
        ['polygon', ptsN]
      ]);
    }
    for (var xi = 0; xi < (board.texts || []).length; xi++) {
      var tx = board.texts[xi];
      var txAt = ['at', r4str(tx.at[0]), r4str(tx.at[1])];
      if (r4(tx.angle || 0)) txAt.push(r4str(tx.angle));
      var effects = ['effects', ['font', ['size', r4str(tx.size || 1.5), r4str(tx.size || 1.5)],
        ['thickness', r4str(tx.thickness || 0.3)]]];
      if (tx.justify === 'left' || tx.justify === 'right') effects.push(['justify', tx.justify]);
      root.push(['gr_text', { q: str(tx.text) }, txAt,
        ['layer', { q: str(tx.layer === 'B.SilkS' ? 'B.SilkS' : 'F.SilkS') }], effects]);
    }
    for (var oi = 0; oi < (board.outline || []).length; oi++) {
      var poly = board.outline[oi];
      for (var pk = 0; pk + 1 < poly.length; pk++) {
        root.push([
          'gr_line',
          ['start', r4str(poly[pk][0]), r4str(poly[pk][1])],
          ['end', r4str(poly[pk + 1][0]), r4str(poly[pk + 1][1])],
          ['layer', { q: 'Edge.Cuts' }],
          ['stroke', ['width', '0.1'], ['type', 'solid']]
        ]);
      }
    }

    return KipadSexpr.stringify(root);
  }

  return { parseBoard: parseBoard, serializeBoard: serializeBoard };
});
