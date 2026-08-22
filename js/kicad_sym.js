'use strict';

/**
 * KipadKicadSym — parse real KiCad .kicad_sym symbol library files into a
 * compact JSON-friendly symbol schema for the Kipad editor.
 *
 * Input: text of a `(kicad_symbol_lib ...)` file (new per-symbol layout or
 * classic one-file-many-symbols layout; also tolerates a bare `(symbol ...)`).
 *
 * Output: ARRAY of symbol objects:
 *   { name, ref, value, desc, footprint,
 *     pins:     [ { number, name, type, at:[x,y], angle, length } ],
 *     graphics: [ { type:'rect'|'circle'|'polyline'|'arc'|'text', ... } ] }
 *
 * All units of a symbol are flattened into the symbol's pins/graphics arrays.
 * `(extends "BASE")` resolution is done against symbols parsed earlier in the
 * SAME file (deep copy of BASE pins+graphics, own units appended, pins deduped
 * by number+angle keeping the later one). If BASE is missing, the symbol is
 * still emitted with only its own units.
 *
 * Uses the existing KipadSexpr s-expression parser (UMD, both browser and Node).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./sexpr.js'));
  } else {
    root.KipadKicadSym = factory(root.KipadSexpr);
  }
})(typeof self !== 'undefined' ? self : this, function (KipadSexpr) {
  'use strict';

  // Unwrap {q:"..."} quoted atoms; plain atoms (strings) pass through.
  function V(n) {
    return (n && typeof n === 'object' && 'q' in n) ? n.q : n;
  }

  function num(n) {
    var v = V(n);
    if (v === undefined || v === null || v === '') return 0;
    var f = parseFloat(v);
    return isNaN(f) ? 0 : f;
  }

  function deepCopy(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function isTag(node, tag) {
    return Array.isArray(node) && node.length > 0 && node[0] === tag;
  }

  // Find the first direct child of `node` whose tag equals `tag`.
  function findChild(node, tag) {
    for (var i = 1; i < node.length; i++) {
      if (isTag(node[i], tag)) return node[i];
    }
    return null;
  }

  // Collect ALL direct children of `node` whose tag equals `tag`.
  function findChildren(node, tag) {
    var out = [];
    for (var i = 1; i < node.length; i++) {
      if (isTag(node[i], tag)) out.push(node[i]);
    }
    return out;
  }

  // (at x y [angle]) -> [x, y]
  function atXY(node) {
    var at = findChild(node, 'at');
    if (!at) return [0, 0];
    return [num(at[1]), num(at[2])];
  }

  // (at x y [angle]) -> angle (degrees; 0 = right, 90 = up, 180 = left, 270 = down)
  function atAngle(node) {
    var at = findChild(node, 'at');
    if (!at || at.length < 4) return 0;
    return num(at[3]);
  }

  // (effects (font (size w h))) -> width (single number)
  function fontSize(node) {
    var effects = findChild(node, 'effects');
    if (!effects) return 1.27;
    var font = findChild(effects, 'font');
    if (!font) return 1.27;
    var size = findChild(font, 'size');
    if (!size || size.length < 2) return 1.27;
    return num(size[1]);
  }

  // Cubic bezier sampling: control points p0..p3 (arrays [x,y]), ~16 segments.
  function sampleBezier(p0, p1, p2, p3, segments) {
    segments = segments || 16;
    var pts = [];
    for (var i = 0; i <= segments; i++) {
      var t = i / segments;
      var mt = 1 - t;
      var x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
      var y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
      pts.push([Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
    }
    return pts;
  }

  // ------------------------------------------------------------------
  // graphics
  // ------------------------------------------------------------------

  function parseRect(node) {
    var start = findChild(node, 'start');
    var end = findChild(node, 'end');
    return {
      type: 'rect',
      start: start ? [num(start[1]), num(start[2])] : [0, 0],
      end: end ? [num(end[1]), num(end[2])] : [0, 0]
    };
  }

  function parseCircle(node) {
    var center = findChild(node, 'center');
    var end = findChild(node, 'end');
    var radius = findChild(node, 'radius');
    var r;
    if (radius) {
      r = num(radius[1]);
    } else if (center && end) {
      var dx = num(end[1]) - num(center[1]);
      var dy = num(end[2]) - num(center[2]);
      r = Math.sqrt(dx * dx + dy * dy);
    } else {
      r = 0;
    }
    return {
      type: 'circle',
      center: center ? [num(center[1]), num(center[2])] : [0, 0],
      r: Math.round(r * 1e4) / 1e4
    };
  }

  function parsePolyline(node, rawPts) {
    return {
      type: 'polyline',
      pts: rawPts.map(function (p) { return [num(p[1]), num(p[2])]; })
    };
  }

  function parseArc(node) {
    var start = findChild(node, 'start');
    var mid = findChild(node, 'mid');
    var end = findChild(node, 'end');
    return {
      type: 'arc',
      start: start ? [num(start[1]), num(start[2])] : [0, 0],
      mid: mid ? [num(mid[1]), num(mid[2])] : [0, 0],
      end: end ? [num(end[1]), num(end[2])] : [0, 0]
    };
  }

  function parseText(node) {
    var txt = node.length > 1 ? V(node[1]) : '';
    var at = atXY(node);
    var angle = atAngle(node);
    var out = {
      type: 'text',
      at: at,
      text: String(txt === undefined || txt === null ? '' : txt),
      size: fontSize(node)
    };
    if (angle) out.angle = angle;
    return out;
  }

  // (bezier (pts (xy x y) (xy x y) (xy x y) (xy x y)) ...) -> polyline (16 segments)
  function parseBezier(node) {
    var pts = findChild(node, 'pts');
    var raw = [];
    if (pts) {
      for (var i = 1; i < pts.length; i++) {
        if (isTag(pts[i], 'xy')) raw.push([num(pts[i][1]), num(pts[i][2])]);
      }
    }
    var p0 = raw[0] || [0, 0];
    var p1 = raw[1] || p0;
    var p2 = raw[2] || p0;
    var p3 = raw[3] || p0;
    return { type: 'polyline', pts: sampleBezier(p0, p1, p2, p3, 16) };
  }

  function parseGraphic(node) {
    var tag = node[0];
    switch (tag) {
      case 'rectangle': return parseRect(node);
      case 'circle': return parseCircle(node);
      case 'polyline': {
        var pts = findChild(node, 'pts');
        var raw = [];
        if (pts) {
          for (var i = 1; i < pts.length; i++) {
            if (isTag(pts[i], 'xy')) raw.push(pts[i]);
          }
        }
        return parsePolyline(node, raw);
      }
      case 'arc': return parseArc(node);
      case 'text': return parseText(node);
      case 'bezier': return parseBezier(node);
      default: return null;
    }
  }

  // ------------------------------------------------------------------
  // pins
  // ------------------------------------------------------------------

  var PIN_TYPES = {
    input: true, output: true, bidirectional: true, tri_state: true,
    passive: true, power_in: true, power_out: true, open_collector: true,
    open_emitter: true, no_connect: true, unspecified: true, free: true
  };

  function parsePin(node) {
    var type = node.length > 1 ? String(V(node[1])).toLowerCase() : 'passive';
    if (!PIN_TYPES[type]) type = 'passive';
    var nameNode = findChild(node, 'name');
    var numberNode = findChild(node, 'number');
    return {
      number: numberNode && numberNode.length > 1 ? String(V(numberNode[1])) : '',
      name: nameNode && nameNode.length > 1 ? String(V(nameNode[1])) : '',
      type: type,
      at: atXY(node),
      angle: atAngle(node),
      length: num(findChild(node, 'length') ? findChild(node, 'length')[1] : 0)
    };
  }

  // ------------------------------------------------------------------
  // symbols
  // ------------------------------------------------------------------

  // A "unit" node is a child `(symbol "Name_U_S" ...)` of a top-level symbol.
  // Returns { pins: [...], graphics: [...] } flattened from that unit.
  function parseUnit(node) {
    var pins = [];
    var graphics = [];
    for (var i = 1; i < node.length; i++) {
      var child = node[i];
      if (!Array.isArray(child)) continue;
      if (child[0] === 'pin') {
        pins.push(parsePin(child));
      } else {
        var g = parseGraphic(child);
        if (g) graphics.push(g);
      }
    }
    return { pins: pins, graphics: graphics };
  }

  function parseSymbol(node, byName) {
    var name = node.length > 1 ? String(V(node[1])) : '';
    var extendsNode = findChild(node, 'extends');
    var extendsName = extendsNode && extendsNode.length > 1 ? String(V(extendsNode[1])) : null;

    var props = { Reference: null, Value: null, Description: null, Footprint: null };
    var propNodes = findChildren(node, 'property');
    for (var i = 0; i < propNodes.length; i++) {
      var pn = propNodes[i];
      if (pn.length < 3) continue;
      var key = String(V(pn[1]));
      if (key in props) props[key] = String(V(pn[2]));
    }

    var sym = {
      name: name,
      ref: props.Reference !== null ? props.Reference : name,
      value: props.Value !== null ? props.Value : name,
      desc: props.Description !== null ? props.Description : '',
      footprint: props.Footprint !== null ? props.Footprint : '',
      pins: [],
      graphics: []
    };

    // Start from BASE (parsed earlier in this file) if resolvable.
    if (extendsName && byName[extendsName]) {
      var base = byName[extendsName];
      sym.pins = deepCopy(base.pins);
      sym.graphics = deepCopy(base.graphics);
      // inherit base properties when not overridden
      if (props.Reference === null) sym.ref = base.ref;
      if (props.Value === null) sym.value = base.value;
      if (props.Description === null) sym.desc = base.desc;
      if (props.Footprint === null) sym.footprint = base.footprint;
    }

    // Append own units (flatten all units' pins + graphics).
    var units = findChildren(node, 'symbol');
    for (var u = 0; u < units.length; u++) {
      var part = parseUnit(units[u]);
      for (var p = 0; p < part.pins.length; p++) sym.pins.push(part.pins[p]);
      for (var g = 0; g < part.graphics.length; g++) sym.graphics.push(part.graphics[g]);
    }

    // Dedupe pins by number+angle, keeping the later one.
    var seen = {};
    var deduped = [];
    for (var q = 0; q < sym.pins.length; q++) {
      var pin = sym.pins[q];
      var key = pin.number + '|' + pin.angle;
      if (seen[key] !== undefined) {
        deduped[seen[key]] = pin;
      } else {
        seen[key] = deduped.length;
        deduped.push(pin);
      }
    }
    sym.pins = deduped;

    // Dedupe exact-duplicate graphics (safe: same shape drawn twice == once).
    var gSeen = {};
    var gOut = [];
    for (var g2 = 0; g2 < sym.graphics.length; g2++) {
      var gk = JSON.stringify(sym.graphics[g2]);
      if (!gSeen[gk]) {
        gSeen[gk] = true;
        gOut.push(sym.graphics[g2]);
      }
    }
    sym.graphics = gOut;

    return sym;
  }

  /**
   * parseKicadSym(text) -> array of symbol objects.
   */
  function parseKicadSym(text) {
    if (typeof text !== 'string') {
      throw new Error('KipadKicadSym.parseKicadSym: expected a string');
    }
    // KipadSexpr.parse returns the outermost list itself (tag at index 0).
    var root = KipadSexpr.parse(text);
    if (!root || root.length === 0) return [];
    if (!Array.isArray(root)) return [];

    var topLevel;
    if (root[0] === 'kicad_symbol_lib') {
      topLevel = findChildren(root, 'symbol');
    } else if (root[0] === 'symbol') {
      topLevel = [root];
    } else {
      return [];
    }

    var byName = {};
    var out = [];
    for (var i = 0; i < topLevel.length; i++) {
      var sym = parseSymbol(topLevel[i], byName);
      if (!sym.name) continue;
      if (!byName[sym.name]) byName[sym.name] = sym; // first wins for extends lookup
      out.push(sym);
    }
    return out;
  }

  return { parseKicadSym: parseKicadSym };
});
