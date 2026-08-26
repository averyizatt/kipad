'use strict';

/**
 * KipadFootprints - built-in KiCad-style footprint library + real library loader.
 *
 * UMD: browser global `KipadFootprints` / CommonJS module.
 *
 * Builtin footprints (13) act as an offline fallback. `loadLibrary(json)`
 * merges real KiCad footprints (from lib/footprints.json) over the builtins.
 * `addFootprint(fp)` adds a single footprint (runtime .kicad_mod import).
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadFootprints = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  var SMD_LAYERS = ['F.Cu', 'F.Paste', 'F.Mask'];
  var THT_LAYERS = ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask'];

  function smdPad(number, at, size, radius) {
    return {
      number: String(number),
      type: 'smd',
      shape: 'roundrect',
      at: [at[0], at[1]],
      size: [size[0], size[1]],
      drill: null,
      radius: radius,
      layers: SMD_LAYERS.slice()
    };
  }

  function thtPad(number, at, size, drill) {
    return {
      number: String(number),
      type: 'tht',
      shape: 'circle',
      at: [at[0], at[1]],
      size: [size, size],
      drill: drill,
      radius: null,
      layers: THT_LAYERS.slice()
    };
  }

  function line(x1, y1, x2, y2) {
    return { type: 'line', pts: [[x1, y1], [x2, y2]] };
  }

  function rectLines(x1, y1, x2, y2) {
    return [
      line(x1, y1, x2, y1),
      line(x2, y1, x2, y2),
      line(x2, y2, x1, y2),
      line(x1, y2, x1, y1)
    ];
  }

  function courtyard(minX, minY, maxX, maxY) {
    return { min: [minX, minY], max: [maxX, maxY] };
  }

  function chip(name, desc, ref, padX, padSize, padRadius, crd, bodyHalf) {
    return {
      name: name,
      desc: desc,
      ref: ref,
      value: '',
      courtyard: courtyard(crd[0][0], crd[0][1], crd[1][0], crd[1][1]),
      pads: [
        smdPad(1, [-padX, 0], padSize, padRadius),
        smdPad(2, [padX, 0], padSize, padRadius)
      ],
      silk: rectLines(-bodyHalf[0], -bodyHalf[1], bodyHalf[0], bodyHalf[1])
    };
  }

  var footprints = {};

  footprints.R_0603_1608Metric = chip('R_0603_1608Metric', 'Resistor SMD 0603 (1608 Metric), IPC-7351 nominal', 'R', 0.825, [0.8, 0.95], 0.2, [[-1.48, -0.73], [1.48, 0.73]], [0.8, 0.45]);
  footprints.C_0603_1608Metric = chip('C_0603_1608Metric', 'Capacitor SMD 0603 (1608 Metric), IPC-7351 nominal', 'C', 0.825, [0.8, 0.95], 0.2, [[-1.48, -0.73], [1.48, 0.73]], [0.8, 0.45]);
  footprints.R_0805_2012Metric = chip('R_0805_2012Metric', 'Resistor SMD 0805 (2012 Metric), IPC-7351 nominal', 'R', 0.9125, [1.025, 1.4], 0.25, [[-1.68, -0.95], [1.68, 0.95]], [1.0, 0.625]);
  footprints.C_0805_2012Metric = chip('C_0805_2012Metric', 'Capacitor SMD 0805 (2012 Metric), IPC-7351 nominal', 'C', 0.9125, [1.025, 1.4], 0.25, [[-1.68, -0.95], [1.68, 0.95]], [1.0, 0.625]);
  footprints.R_1206_3216Metric = chip('R_1206_3216Metric', 'Resistor SMD 1206 (3216 Metric), IPC-7351 nominal', 'R', 1.4625, [1.125, 1.75], 0.25, [[-2.28, -1.12], [2.28, 1.12]], [1.6, 0.8]);
  footprints.R_0402_1005Metric = chip('R_0402_1005Metric', 'Resistor SMD 0402 (1005 Metric), IPC-7351 nominal', 'R', 0.51, [0.54, 0.64], 0.135, [[-0.93, -0.47], [0.93, 0.47]], [0.525, 0.27]);
  footprints.C_0402_1005Metric = chip('C_0402_1005Metric', 'Capacitor SMD 0402 (1005 Metric), IPC-7351 nominal', 'C', 0.51, [0.54, 0.64], 0.135, [[-0.93, -0.47], [0.93, 0.47]], [0.525, 0.27]);

  footprints.LED_0603_1608Metric = {
    name: 'LED_0603_1608Metric',
    desc: 'LED SMD 0603 (1608 Metric); pad 1 = cathode (silk bar on pad-1 side)',
    ref: 'D',
    value: '',
    courtyard: courtyard(-1.48, -0.73, 1.48, 0.73),
    pads: [
      smdPad(1, [-0.7875, 0], [0.875, 0.95], 0.22),
      smdPad(2, [0.7875, 0], [0.875, 0.95], 0.22)
    ],
    silk: rectLines(-0.8, -0.4, 0.8, 0.4).concat([line(-0.55, -0.3, -0.55, 0.3)])
  };

  footprints['SOT-23'] = {
    name: 'SOT-23',
    desc: 'SOT-23, 3-lead SMD package; pins 1+2 bottom row, pin 3 top center',
    ref: 'Q',
    value: '',
    courtyard: courtyard(-1.7, -1.75, 1.7, 1.75),
    pads: [
      smdPad(1, [-0.95, -0.95], [0.6, 1.0], 0.1),
      smdPad(2, [0.95, -0.95], [0.6, 1.0], 0.1),
      smdPad(3, [0, 0.95], [0.6, 1.0], 0.1)
    ],
    silk: rectLines(-1.45, -0.75, 1.45, 0.75)
  };

  footprints['SOIC-8_3.9x4.9mm_P1.27mm'] = {
    name: 'SOIC-8_3.9x4.9mm_P1.27mm',
    desc: 'SOIC-8, 3.9x4.9mm body, 1.27mm pitch (JEDEC MS-012AA)',
    ref: 'U',
    value: '',
    courtyard: courtyard(-3.7, -2.7, 3.7, 2.7),
    pads: [
      smdPad(1, [-2.475, -1.905], [1.95, 0.6], 0.15),
      smdPad(2, [-2.475, -0.635], [1.95, 0.6], 0.15),
      smdPad(3, [-2.475, 0.635], [1.95, 0.6], 0.15),
      smdPad(4, [-2.475, 1.905], [1.95, 0.6], 0.15),
      smdPad(5, [2.475, 1.905], [1.95, 0.6], 0.15),
      smdPad(6, [2.475, 0.635], [1.95, 0.6], 0.15),
      smdPad(7, [2.475, -0.635], [1.95, 0.6], 0.15),
      smdPad(8, [2.475, -1.905], [1.95, 0.6], 0.15)
    ],
    silk: [
      line(-1.95, -2.45, -1.95, 2.45),
      line(-1.95, 2.45, 1.95, 2.45),
      line(1.95, 2.45, 1.95, -2.45),
      line(1.95, -2.45, 0, -2.45),
      line(0, -2.45, -3.45, -2.45)
    ]
  };

  footprints['DIP-8_W7.62mm'] = {
    name: 'DIP-8_W7.62mm',
    desc: '8-lead through-hole DIP, 7.62mm (300 mil) row spacing',
    ref: 'U',
    value: '',
    courtyard: courtyard(-4.9, -5.35, 4.9, 5.35),
    pads: [
      thtPad(1, [-3.81, -3.81], 1.6, 0.8),
      thtPad(2, [-3.81, -1.27], 1.6, 0.8),
      thtPad(3, [-3.81, 1.27], 1.6, 0.8),
      thtPad(4, [-3.81, 3.81], 1.6, 0.8),
      thtPad(5, [3.81, 3.81], 1.6, 0.8),
      thtPad(6, [3.81, 1.27], 1.6, 0.8),
      thtPad(7, [3.81, -1.27], 1.6, 0.8),
      thtPad(8, [3.81, -3.81], 1.6, 0.8)
    ],
    silk: [
      line(-3.8, -5.05, -3.8, 5.05),
      line(-3.8, 5.05, 3.8, 5.05),
      line(3.8, 5.05, 3.8, -5.05),
      line(3.8, -5.05, 1.0, -5.05),
      line(-1.0, -5.05, -3.8, -5.05),
      line(-1.0, -5.05, -1.0, -4.55),
      line(-1.0, -4.55, 1.0, -4.55),
      line(1.0, -4.55, 1.0, -5.05)
    ]
  };

  footprints['PinHeader_1x04_P2.54mm_Vertical'] = {
    name: 'PinHeader_1x04_P2.54mm_Vertical',
    desc: 'Through-hole straight pin header, 1x04, 2.54mm pitch, single row',
    ref: 'J',
    value: '',
    courtyard: courtyard(-1.8, -1.8, 1.8, 9.4),
    pads: [
      thtPad(1, [0, 0], 1.7, 1.0),
      thtPad(2, [0, 2.54], 1.7, 1.0),
      thtPad(3, [0, 5.08], 1.7, 1.0),
      thtPad(4, [0, 7.62], 1.7, 1.0)
    ],
    silk: rectLines(-1.33, -1.33, 1.33, 8.95).concat([line(-1.33, 0, 1.33, 0)])
  };

  footprints['PinHeader_2x04_P2.54mm_Vertical'] = {
    name: 'PinHeader_2x04_P2.54mm_Vertical',
    desc: 'Through-hole straight pin header, 2x04, 2.54mm pitch, double row',
    ref: 'J',
    value: '',
    courtyard: courtyard(-3.075, -1.8, 3.075, 9.4),
    pads: [
      thtPad(1, [-1.27, 0], 1.7, 1.0),
      thtPad(2, [1.27, 0], 1.7, 1.0),
      thtPad(3, [-1.27, 2.54], 1.7, 1.0),
      thtPad(4, [1.27, 2.54], 1.7, 1.0),
      thtPad(5, [-1.27, 5.08], 1.7, 1.0),
      thtPad(6, [1.27, 5.08], 1.7, 1.0),
      thtPad(7, [-1.27, 7.62], 1.7, 1.0),
      thtPad(8, [1.27, 7.62], 1.7, 1.0)
    ],
    silk: rectLines(-2.6, -1.33, 2.6, 8.95).concat([line(-2.6, 0, 2.6, 0)])
  };

  // ------------------------------------------------------------------
  // library loading (real KiCad data from lib/footprints.json)
  // ------------------------------------------------------------------

  function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

  function num(v, d) { var n = typeof v === 'string' ? parseFloat(v) : v; return isFinite(n) ? n : d; }

  function normalize(fp) {
    var out = {
      name: fp.name,
      library: fp.library || '',
      desc: fp.desc || '',
      ref: fp.ref || 'U',
      value: fp.value || '',
      courtyard: fp.courtyard && Array.isArray(fp.courtyard.min) && Array.isArray(fp.courtyard.max)
        ? { min: [num(fp.courtyard.min[0], 0), num(fp.courtyard.min[1], 0)], max: [num(fp.courtyard.max[0], 1), num(fp.courtyard.max[1], 1)] }
        : null,
      pads: [],
      silk: Array.isArray(fp.silk) ? fp.silk.slice() : []
    };
    for (var i = 0; i < (fp.pads || []).length; i++) {
      var p = fp.pads[i];
      out.pads.push({
        number: String(p.number != null ? p.number : (i + 1)),
        type: p.type || 'smd',
        shape: p.shape || 'rect',
        at: [num(p.at && p.at[0], 0), num(p.at && p.at[1], 0)],
        angle: num(p.angle, 0),
        size: [num(p.size && p.size[0], 1), num(p.size && p.size[1], 1)],
        drill: p.drill != null ? num(p.drill, 0) : null,
        radius: p.radius != null ? num(p.radius, 0) : null,
        layers: Array.isArray(p.layers) && p.layers.length ? p.layers.slice() : ['F.Cu']
      });
    }
    return out;
  }

  function listFootprints() { return Object.keys(footprints).sort(); }

  function getFootprint(name) { var fp = footprints[name]; return fp ? deepCopy(fp) : null; }

  function addFootprint(fp) {
    if (!fp || !fp.name || !Array.isArray(fp.pads)) return null;
    var norm = normalize(fp);
    footprints[norm.name] = norm;
    return deepCopy(norm);
  }

  function loadLibrary(arr) {
    if (!Array.isArray(arr)) return 0;
    var n = 0;
    for (var i = 0; i < arr.length; i++) {
      var fp = arr[i];
      if (!fp || !fp.name || !Array.isArray(fp.pads)) continue;
      footprints[fp.name] = normalize(fp);
      n++;
    }
    return n;
  }

  function searchFootprints(q) {
    q = String(q || '').toLowerCase();
    if (!q) return listFootprints();
    var out = [];
    for (var name in footprints) {
      var fp = footprints[name];
      if (name.toLowerCase().indexOf(q) !== -1 ||
          (fp.desc && fp.desc.toLowerCase().indexOf(q) !== -1) ||
          (fp.ref && fp.ref.toLowerCase() === q) ||
          (fp.library && fp.library.toLowerCase().indexOf(q) !== -1)) out.push(name);
    }
    return out.sort();
  }

  return {
    listFootprints: listFootprints,
    getFootprint: getFootprint,
    addFootprint: addFootprint,
    loadLibrary: loadLibrary,
    searchFootprints: searchFootprints
  };
});
