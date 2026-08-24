'use strict';

/**
 * KipadSchWires — pure helpers behind the schematic wire tool.
 *
 * No canvas/DOM code. Gives the editor:
 *  - collectTargets(): every magnetic snap point (symbol pins, wire ends,
 *    junctions) with kinds, so wires can land EXACTLY on connections
 *  - pick(): nearest-target-within-threshold lookup (pins win ties)
 *  - elbow(): orthogonal L routing between two points (dominant axis first)
 *  - hitsAnySegment(): did a point land on an existing wire run (T-joint)?
 *  - junctionNeeded(): does this committed wire vertex deserve a junction dot?
 *
 * UMD: browser global KipadSchWires / CommonJS.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.KipadSchWires = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;
  // Higher kind wins distance ties (pin > junction > bare wire end).
  var KIND_PRIO = { pin: 3, junction: 2, wire: 1 };

  function dist(p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1]); }

  /** Projection parameter t of p onto segment ab, clamped to [0,1]. */
  function projT(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var l2 = dx * dx + dy * dy;
    if (l2 === 0) return 0;
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    return Math.max(0, Math.min(1, t));
  }

  function distToSeg(p, a, b) {
    var t = projT(p, a, b);
    return Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])));
  }

  /**
   * collectTargets(sch, pinPosFn) -> [{at:[x,y], kind:'pin'|'wire'|'junction', label?}]
   * pinPosFn(symbol) -> [{at:[x,y], number}] (pass Sch.pinPositions-bound helper).
   */
  function collectTargets(sch, pinPosFn) {
    var list = [];
    (sch.symbols || []).forEach(function (s) {
      (pinPosFn(s) || []).forEach(function (pp) {
        list.push({ at: [pp.at[0], pp.at[1]], kind: 'pin', label: (s.ref || '?') + '.' + pp.number });
      });
    });
    (sch.wires || []).forEach(function (w) {
      if (!w.pts || !w.pts.length) return;
      [w.pts[0], w.pts[w.pts.length - 1]].forEach(function (pt) {
        list.push({ at: [pt[0], pt[1]], kind: 'wire' });
      });
    });
    (sch.junctions || []).forEach(function (j) {
      list.push({ at: [j.at[0], j.at[1]], kind: 'junction' });
    });
    return list;
  }

  /** Nearest target within threshold `thr`, null if none. Pins win ties. */
  function pick(targets, x, y, thr) {
    var best = null, bd = thr;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var d = dist(t.at, [x, y]);
      if (d < bd - EPS || (Math.abs(d - bd) <= EPS && best && KIND_PRIO[t.kind] > KIND_PRIO[best.kind])) {
        bd = d; best = t;
      }
    }
    return best;
  }

  /**
   * elbow(a, b) -> intermediate points for an orthogonal path a->b.
   * Axis-aligned moves route direct; diagonals bend along the dominant axis
   * first (KiCad-style L). Returns [] when no bend is needed.
   */
  function elbow(a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dx) < EPS || Math.abs(dy) < EPS) return [];
    return Math.abs(dx) >= Math.abs(dy) ? [[b[0], a[1]]] : [[a[0], b[1]]];
  }

  /** True if p touches ANY segment of any wire (endpoints inclusive). */
  function hitsAnySegment(p, wires, eps) {
    for (var i = 0; i < wires.length; i++) {
      var pts = wires[i].pts;
      for (var k = 0; k + 1 < pts.length; k++) {
        if (distToSeg(p, pts[k], pts[k + 1]) <= eps) return true;
      }
    }
    return false;
  }

  /**
   * junctionNeeded(myPts, idx, otherWires, eps) -> bool
   * Does myPts[idx] deserve a junction dot given the OTHER wires?
   * Rules (KiCad semantics, dot only where >2 things meet or a T occurs):
   *   - point strictly inside another wire's run (T-joint)            -> yes
   *   - two or more other-wire vertices coincide here                 -> yes
   *   - my CORNER lands on exactly one other wire's vertex            -> yes
   *   - my ENDPOINT meets exactly one other wire's endpoint           -> no (plain join)
   */
  function junctionNeeded(myPts, idx, otherWires, eps) {
    var p = myPts[idx];
    var mineDeg = (idx === 0 || idx === myPts.length - 1) ? 1 : 2;
    var vertCount = 0, through = false;

    for (var i = 0; i < otherWires.length; i++) {
      var pts = otherWires[i].pts || [];
      var vHere = false;
      for (var v = 0; v < pts.length; v++) {
        if (dist(p, pts[v]) <= eps) { vHere = true; break; }
      }
      var segHit = false;
      for (var k = 0; k + 1 < pts.length; k++) {
        var t = projT(p, pts[k], pts[k + 1]);
        if (distToSeg(p, pts[k], pts[k + 1]) <= eps && t > EPS && t < 1 - EPS) { segHit = true; break; }
      }
      if (vHere) vertCount++;
      if (segHit && !vHere) through = true;
    }

    if (through) return true;
    if (vertCount >= 2) return true;
    return vertCount >= 1 && mineDeg >= 2;
  }

  return {
    collectTargets: collectTargets,
    pick: pick,
    elbow: elbow,
    hitsAnySegment: hitsAnySegment,
    junctionNeeded: junctionNeeded,
    distToSeg: distToSeg
  };
});
