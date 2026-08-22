'use strict';

/**
 * KipadKicadMod — converts KiCad .kicad_mod footprint files into Kipad's
 * internal footprint JSON.
 *
 * UMD: works as a browser <script> (exposes global `KipadKicadMod`, needs
 * `KipadSexpr` loaded first) and as a CommonJS module in Node
 * (require('./js/kicad_mod.js')).
 *
 * Handles both legacy `(module NAME (layer F.Cu) ...)` and KiCad 7/8
 * `(footprint "NAME" ...)` file formats.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./sexpr.js'));
  } else {
    root.KipadKicadMod = factory(root.KipadSexpr);
  }
})(typeof self !== 'undefined' ? self : this, function (KipadSexpr) {
  'use strict';

  function V(n) {
    return (n && typeof n === 'object' && 'q' in n) ? n.q : n;
  }
  function num(n) {
    var v = parseFloat(V(n));
    return isFinite(v) ? v : NaN;
  }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function round6(x) { return Math.round(x * 1e6) / 1e6; }
  function findChild(node, tag) {
    for (var i = 1; i < node.length; i++) {
      var c = node[i];
      if (Array.isArray(c) && c.length && V(c[0]) === tag) return c;
    }
    return null;
  }
  function childVal(child) {
    return child && child.length > 1 ? V(child[1]) : undefined;
  }

  // circle through 3 points (math coords, y-up)
  function circleThrough3(A, B, C) {
    var ax = A[0], ay = A[1], bx = B[0], by = B[1], cx = C[0], cy = C[1];
    var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    var a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    var ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    var uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    return { center: [ux, uy], r: Math.hypot(ux - ax, uy - ay) };
  }
  function chordCenter(S, E, th) {
    var c = Math.hypot(E[0] - S[0], E[1] - S[1]);
    if (c < 1e-12) return null;
    var thAbs = Math.abs(th);
    var sinHalf = Math.sin(thAbs / 2);
    if (sinHalf < 1e-9) return null;
    var r = c / (2 * sinHalf);
    var d = [(E[0] - S[0]) / c, (E[1] - S[1]) / c];
    var n = [-d[1], d[0]];
    var h = (c / 2) * (Math.cos(thAbs / 2) / sinHalf);
    var M = [(S[0] + E[0]) / 2, (S[1] + E[1]) / 2];
    var sign = th >= 0 ? 1 : -1;
    return { center: [M[0] + sign * h * n[0], M[1] + sign * h * n[1]], r: Math.abs(r) };
  }
  function arcPolyline(node, nPts) {
    var s = findChild(node, 'start'), e = findChild(node, 'end');
    if (!s || !e) return null;
    var sx = num(s[1]), sy = num(s[2]), ex = num(e[1]), ey = num(e[2]);
    if (![sx, sy, ex, ey].every(isNum)) return null;
    var S = [sx, -sy], E = [ex, -ey];
    var C, r, th;
    var mid = findChild(node, 'mid');
    var ang = findChild(node, 'angle');
    if (mid && mid.length >= 3) {
      var M = [num(mid[1]), -num(mid[2])];
      if (!isNum(M[0]) || !isNum(M[1])) return null;
      var cir = circleThrough3(S, M, E);
      if (!cir) return null;
      C = cir.center; r = cir.r;
      var aS = Math.atan2(S[1] - C[1], S[0] - C[0]);
      var aM = Math.atan2(M[1] - C[1], M[0] - C[0]);
      var aE = Math.atan2(E[1] - C[1], E[0] - C[0]);
      var ccw = (aE - aS) % (2 * Math.PI);
      if (ccw < 0) ccw += 2 * Math.PI;
      var mccw = (aM - aS) % (2 * Math.PI);
      if (mccw < 0) mccw += 2 * Math.PI;
      th = (mccw <= ccw + 1e-9) ? ccw : ccw - 2 * Math.PI;
      if (Math.abs(th) < 1e-9) return null;
    } else if (ang) {
      var deg = num(ang[1]);
      if (!isNum(deg)) return null;
      th = -deg * Math.PI / 180;
      var cc = chordCenter(S, E, th);
      if (!cc) return null;
      C = cc.center; r = cc.r;
    } else {
      return null;
    }
    var aStart = Math.atan2(S[1] - C[1], S[0] - C[0]);
    var pts = [];
    for (var i = 0; i <= nPts; i++) {
      var a = aStart + th * (i / nPts);
      pts.push([round6(C[0] + r * Math.cos(a)), round6(-(C[1] + r * Math.sin(a)))]);
    }
    return pts;
  }
  function polyPts(node) {
    var pts = findChild(node, 'pts');
    if (!pts) return [];
    var out = [];
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i];
      if (!Array.isArray(p) || p.length < 3) continue;
      var x = num(p[1]), y = num(p[2]);
      if (isNum(x) && isNum(y)) out.push([x, y]);
    }
    return out;
  }
  function shapeBounds(node) {
    var tag = String(V(node[0]) || '');
    var s = findChild(node, 'start'), e = findChild(node, 'end');
    if (tag === 'fp_line' || tag === 'gr_line' || tag === 'fp_rect' || tag === 'gr_rect') {
      if (!s || !e) return null;
      var x1 = num(s[1]), y1 = num(s[2]), x2 = num(e[1]), y2 = num(e[2]);
      if (![x1, y1, x2, y2].every(isNum)) return null;
      return { minx: Math.min(x1, x2), miny: Math.min(y1, y2), maxx: Math.max(x1, x2), maxy: Math.max(y1, y2) };
    }
    if (tag === 'fp_circle' || tag === 'gr_circle') {
      var c = findChild(node, 'center');
      if (!c || !e) return null;
      var cx = num(c[1]), cy = num(c[2]), ex = num(e[1]), ey = num(e[2]);
      if (![cx, cy, ex, ey].every(isNum)) return null;
      var r = Math.hypot(ex - cx, ey - cy);
      return { minx: cx - r, miny: cy - r, maxx: cx + r, maxy: cy + r };
    }
    if (tag === 'fp_arc' || tag === 'gr_arc') {
      if (!s || !e) return null;
      var ax1 = num(s[1]), ay1 = num(s[2]), ax2 = num(e[1]), ay2 = num(e[2]);
      if (![ax1, ay1, ax2, ay2].every(isNum)) return null;
      var chord = Math.hypot(ax2 - ax1, ay2 - ay1);
      var rr = chord / 2;
      var a = findChild(node, 'angle');
      if (a) {
        var th = Math.abs(num(a[1]) || 180) * Math.PI / 180;
        if (th > 1e-6 && th < Math.PI - 1e-6) rr = chord / (2 * Math.sin(th / 2));
      }
      var mx = (ax1 + ax2) / 2, my = (ay1 + ay2) / 2;
      return { minx: mx - rr, miny: my - rr, maxx: mx + rr, maxy: my + rr };
    }
    if (tag === 'fp_poly' || tag === 'gr_poly') {
      var pts = polyPts(node);
      if (!pts.length) return null;
      var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (var i = 0; i < pts.length; i++) {
        minx = Math.min(minx, pts[i][0]); maxx = Math.max(maxx, pts[i][0]);
        miny = Math.min(miny, pts[i][1]); maxy = Math.max(maxy, pts[i][1]);
      }
      return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
    }
    return null;
  }
  function unionChildrenBounds(node) {
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    var found = false;
    for (var i = 1; i < node.length; i++) {
      var c = node[i];
      if (!Array.isArray(c) || !c.length) continue;
      var b = shapeBounds(c);
      if (!b) continue;
      found = true;
      minx = Math.min(minx, b.minx); miny = Math.min(miny, b.miny);
      maxx = Math.max(maxx, b.maxx); maxy = Math.max(maxy, b.maxy);
    }
    return found ? { minx: minx, miny: miny, maxx: maxx, maxy: maxy } : null;
  }
  function inferRef(desc, tags) {
    var hay = String(desc || '') + ' ' + String(tags || '');
    hay = hay.toLowerCase();
    function has(re) { return re.test(hay); }
    if (has(/mounting\s*hole|mountinghole/)) return 'H';
    if (has(/test\s*point|testpoint/)) return 'TP';
    if (has(/resistor/)) return 'R';
    if (has(/capacitor/)) return 'C';
    if (has(/inductor/)) return 'L';
    if (has(/diode/)) return 'D';
    if (has(/led/)) return 'D';
    if (has(/transistor|fet|mosfet|bjt/)) return 'Q';
    if (has(/\bsot\b|sot-|sc-?70|to-\d|dpak|d2pak/)) return 'Q';
    if (has(/connector|header|socket|usb|barrel\s*jack|barreljack|jack/)) return 'J';
    if (has(/switch|button/)) return 'SW';
    if (has(/crystal|oscillator/)) return 'Y';
    if (has(/fuse/)) return 'F';
    if (has(/relay/)) return 'K';
    return 'U';
  }
  function parsePad(pad) {
    var number = V(pad[1]);
    number = (number === undefined || number === null) ? '' : String(number);
    var typeRaw = String(V(pad[2]) || '').toLowerCase();
    var shapeRaw = String(V(pad[3]) || '').toLowerCase();
    var type = 'smd';
    if (typeRaw === 'thru_hole') type = 'tht';
    else if (typeRaw === 'np_thru_hole') type = 'npth';
    var shape = 'rect';
    if (shapeRaw === 'rect') shape = 'rect';
    else if (shapeRaw === 'roundrect') shape = 'roundrect';
    else if (shapeRaw === 'circle') shape = 'circle';
    else if (shapeRaw === 'oval') shape = 'obround';
    var atN = findChild(pad, 'at');
    var at = [0, 0], angle = 0;
    if (atN && atN.length >= 3) {
      var ax = num(atN[1]), ay = num(atN[2]);
      at = [isNum(ax) ? ax : 0, isNum(ay) ? ay : 0];
      if (atN[3] !== undefined) {
        var a = num(atN[3]);
        angle = isNum(a) ? a : 0;
      }
    }
    var size = [1, 1];
    var sizeN = findChild(pad, 'size');
    if (sizeN && sizeN.length >= 3) {
      var w = num(sizeN[1]), h = num(sizeN[2]);
      if (isNum(w) && isNum(h) && w > 0 && h > 0) size = [w, h];
      else if (shapeRaw === 'custom') {
        var prim = findChild(pad, 'primitives');
        var b = prim ? unionChildrenBounds(prim) : null;
        if (b) {
          var bw = b.maxx - b.minx, bh = b.maxy - b.miny;
          size = [(bw > 0 ? bw : 1), (bh > 0 ? bh : 1)];
        }
      }
    }
    var layers = [];
    var layersN = findChild(pad, 'layers');
    if (layersN) {
      for (var i = 1; i < layersN.length; i++) {
        var l = V(layersN[i]);
        if (typeof l !== 'string') continue;
        if (l.indexOf('*.') === 0) l = 'F.' + l.slice(2);
        if (l.length) layers.push(l);
      }
    }
    if (!layers.length) {
      layers = (type === 'smd') ? ['F.Cu', 'F.Mask', 'F.Paste'] : ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask'];
    }
    var cuIdx = -1;
    for (var j = 0; j < layers.length; j++) {
      if (layers[j] === 'F.Cu' || layers[j] === 'B.Cu') { cuIdx = j; break; }
    }
    if (cuIdx > 0) {
      layers = [layers[cuIdx]].concat(layers.slice(0, cuIdx), layers.slice(cuIdx + 1));
    } else if (cuIdx === -1) {
      layers = ['F.Cu'].concat(layers);
    }
    var drill = null;
    var drillN = findChild(pad, 'drill');
    if (drillN && drillN.length >= 2) {
      if (Array.isArray(drillN[1]) && String(V(drillN[1][0]) || '') === 'oval') {
        var dv = num(drillN[1][1]);
        if (isNum(dv) && dv > 0) drill = dv;
      } else {
        var dd = num(drillN[1]);
        if (isNum(dd) && dd > 0) drill = dd;
      }
    }
    var radius = null;
    if (shape === 'roundrect') {
      var rr = findChild(pad, 'roundrect_rratio');
      var ratio = rr ? num(rr[1]) : NaN;
      if (!isNum(ratio) || ratio <= 0) ratio = 0.25;
      radius = ratio * Math.min(size[0], size[1]);
    }
    return {
      number: number, type: type, shape: shape, at: at, angle: angle,
      size: size, drill: drill, radius: radius, layers: layers
    };
  }
  function lineItem(x1, y1, x2, y2) {
    return { type: 'line', pts: [[x1, y1], [x2, y2]] };
  }
  function rectLines(x1, y1, x2, y2) {
    return [lineItem(x1, y1, x2, y1), lineItem(x2, y1, x2, y2), lineItem(x2, y2, x1, y2), lineItem(x1, y2, x1, y1)];
  }
  function collectSilk(parsed, layer) {
    var items = [];
    for (var i = 0; i < parsed.length; i++) {
      var node = parsed[i];
      if (!Array.isArray(node) || !node.length) continue;
      var tag = String(V(node[0]) || '');
      if (tag === 'fp_text') {
        var id = String(V(node[1]) || '');
        if (id === 'reference' || id === 'value') continue;
        var lyr = childVal(findChild(node, 'layer'));
        if (lyr !== layer) continue;
        var txt = String(V(node[2]) || '').replace(/\$\{[^}]*\}/g, '').trim();
        if (!txt || txt === '%R' || txt === '%V') continue;
        var atN = findChild(node, 'at');
        var x = 0, y = 0;
        if (atN && atN.length >= 3) {
          var tx = num(atN[1]), ty = num(atN[2]);
          if (isNum(tx)) x = tx;
          if (isNum(ty)) y = ty;
        }
        var size = 1;
        var effects = findChild(node, 'effects');
        var font = effects ? findChild(effects, 'font') : null;
        var sizeN = font ? findChild(font, 'size') : null;
        if (sizeN && sizeN.length >= 2) {
          var fs = num(sizeN[1]);
          if (isNum(fs) && fs > 0) size = fs;
        }
        items.push({ type: 'text', at: [x, y], text: txt, size: size });
        continue;
      }
      if (tag !== 'fp_line' && tag !== 'fp_circle' && tag !== 'fp_arc' &&
          tag !== 'fp_poly' && tag !== 'fp_rect') continue;
      var layerV = childVal(findChild(node, 'layer'));
      if (layerV !== layer) continue;
      if (tag === 'fp_line') {
        var s = findChild(node, 'start'), e = findChild(node, 'end');
        if (!s || !e) continue;
        var x1 = num(s[1]), y1 = num(s[2]), x2 = num(e[1]), y2 = num(e[2]);
        if (![x1, y1, x2, y2].every(isNum)) continue;
        items.push(lineItem(x1, y1, x2, y2));
      } else if (tag === 'fp_rect') {
        var rs = findChild(node, 'start'), re = findChild(node, 'end');
        if (!rs || !re) continue;
        var rx1 = num(rs[1]), ry1 = num(rs[2]), rx2 = num(re[1]), ry2 = num(re[2]);
        if (![rx1, ry1, rx2, ry2].every(isNum)) continue;
        items.push.apply(items, rectLines(rx1, ry1, rx2, ry2));
      } else if (tag === 'fp_circle') {
        var c = findChild(node, 'center'), ce = findChild(node, 'end');
        if (!c || !ce) continue;
        var cx = num(c[1]), cy = num(c[2]), ex = num(ce[1]), ey = num(ce[2]);
        if (![cx, cy, ex, ey].every(isNum)) continue;
        items.push({ type: 'circle', at: [cx, cy], r: Math.hypot(ex - cx, ey - cy) });
      } else if (tag === 'fp_arc') {
        var poly = arcPolyline(node, 24);
        if (poly && poly.length >= 2) items.push({ type: 'line', pts: poly });
      } else if (tag === 'fp_poly') {
        var pts = polyPts(node);
        if (pts.length >= 2) items.push({ type: 'line', pts: pts });
      }
    }
    return items;
  }
  function courtyardFrom(parsed, pads) {
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    var found = false;
    for (var i = 0; i < parsed.length; i++) {
      var node = parsed[i];
      if (!Array.isArray(node) || !node.length) continue;
      var tag = String(V(node[0]) || '');
      if (tag !== 'fp_line' && tag !== 'fp_circle' && tag !== 'fp_arc' &&
          tag !== 'fp_poly' && tag !== 'fp_rect') continue;
      var layerV = childVal(findChild(node, 'layer'));
      if (layerV !== 'F.CrtYd') continue;
      var b = shapeBounds(node);
      if (!b) continue;
      found = true;
      minx = Math.min(minx, b.minx); miny = Math.min(miny, b.miny);
      maxx = Math.max(maxx, b.maxx); maxy = Math.max(maxy, b.maxy);
    }
    if (!found) {
      for (var j = 0; j < pads.length; j++) {
        var p = pads[j];
        var hw = p.size[0] / 2, hh = p.size[1] / 2;
        minx = Math.min(minx, p.at[0] - hw); maxx = Math.max(maxx, p.at[0] + hw);
        miny = Math.min(miny, p.at[1] - hh); maxy = Math.max(maxy, p.at[1] + hh);
      }
      if (!isFinite(minx)) { minx = -1; miny = -1; maxx = 1; maxy = 1; }
      minx -= 0.25; miny -= 0.25; maxx += 0.25; maxy += 0.25;
    }
    return { min: [minx, miny], max: [maxx, maxy] };
  }
  function parseKicadMod(text) {
    if (typeof text !== 'string' || !text.length) return null;
    var parsed;
    try { parsed = KipadSexpr.parse(text); } catch (e) { return null; }
    if (!Array.isArray(parsed) || !parsed.length) return null;
    var kind = String(V(parsed[0]) || '');
    if (kind !== 'module' && kind !== 'footprint') return null;
    var name = V(parsed[1]);
    if (typeof name !== 'string' || !name.length) return null;
    var desc = '';
    var tags = '';
    var descN = findChild(parsed, 'descr');
    if (descN) desc = String(V(descN[1]) || '');
    var tagsN = findChild(parsed, 'tags');
    if (tagsN) {
      tags = [];
      for (var i = 1; i < tagsN.length; i++) tags.push(String(V(tagsN[i]) || ''));
      tags = tags.join(' ');
    }
    var pads = [];
    for (var j = 0; j < parsed.length; j++) {
      var node = parsed[j];
      if (Array.isArray(node) && node.length && V(node[0]) === 'pad') {
        pads.push(parsePad(node));
      }
    }
    var silk = collectSilk(parsed, 'F.SilkS');
    if (silk.length < 4) {
      var fab = collectSilk(parsed, 'F.Fab');
      if (silk.length === 0) silk = fab;
      else silk = silk.concat(fab);
    }
    return {
      name: name, desc: desc, ref: inferRef(desc, tags), value: '',
      courtyard: courtyardFrom(parsed, pads), pads: pads, silk: silk
    };
  }
  return { parseKicadMod: parseKicadMod };
});
