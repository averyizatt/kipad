'use strict';

/* Small RS-274X reader used by the launcher Gerber viewer. It intentionally
 * keeps the parsed image as simple flashes and line strokes so it can render
 * files without changing the PCB model. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.KipadGerberViewer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parse(text) {
    var units = /%MOIN\*%/i.test(text) ? 25.4 : 1;
    var fs = text.match(/%FS[^X]*X(\d)(\d)Y(\d)(\d)\*%/i);
    var decimals = fs ? Number(fs[2]) : 4;
    var scale = units / Math.pow(10, decimals);
    var apertures = Object.create(null);
    var addRe = /%ADD(\d+)([CRO]),([0-9.]+)(?:X([0-9.]+))?[^%]*\*%/gi;
    var m;
    while ((m = addRe.exec(text))) {
      apertures[m[1]] = { shape: m[2].toUpperCase(), w: Number(m[3]) * units, h: Number(m[4] || m[3]) * units };
    }

    var ops = [], currentAperture = null, x = 0, y = 0, region = null;
    var commands = text.replace(/%[^%]*%/g, '').split('*');
    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i].trim();
      if (!cmd) continue;
      if (/^G36$/i.test(cmd)) { region = []; continue; }
      if (/^G37$/i.test(cmd)) { if (region && region.length >= 3) ops.push({ kind: 'region', points: region }); region = null; continue; }
      var onlyD = cmd.match(/^D(\d+)$/i);
      if (onlyD && Number(onlyD[1]) >= 10) { currentAperture = onlyD[1]; continue; }
      var dsel = cmd.match(/D(\d+)$/i);
      var xm = cmd.match(/X([+-]?\d+)/i), ym = cmd.match(/Y([+-]?\d+)/i);
      var nx = xm ? Number(xm[1]) * scale : x;
      var ny = ym ? Number(ym[1]) * scale : y;
      var d = dsel ? Number(dsel[1]) : null;
      if (d >= 10 && !xm && !ym) { currentAperture = String(d); continue; }
      var ap = apertures[currentAperture];
      if (region && d === 2) region.push([nx, ny]);
      else if (region && d === 1) region.push([nx, ny]);
      else if (d === 1 && ap) ops.push({ kind: 'line', x1: x, y1: y, x2: nx, y2: ny, aperture: ap });
      else if (d === 3 && ap) ops.push({ kind: 'flash', x: nx, y: ny, aperture: ap });
      if (xm || ym) { x = nx; y = ny; }
    }
    return { units: units === 25.4 ? 'in' : 'mm', apertures: apertures, ops: ops, bounds: bounds(ops) };
  }

  function bounds(ops) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    function add(x, y, r) { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i], r = o.aperture ? Math.max(o.aperture.w, o.aperture.h) / 2 : 0;
      if (o.kind === 'region') { for (var p = 0; p < o.points.length; p++) add(o.points[p][0], o.points[p][1], 0); continue; }
      if (o.kind === 'line') { add(o.x1, o.y1, r); add(o.x2, o.y2, r); }
      else add(o.x, o.y, r);
    }
    return isFinite(x0) ? { x0: x0, y0: y0, x1: x1, y1: y1 } : null;
  }

  return { parse: parse, bounds: bounds };
});
