/* KipadGestures — pure multi-touch gesture recognizers (no DOM, unit-testable). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KipadGestures = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Two-finger tap (iPadOS "undo" gesture).
  //
  // feed(ev) with ev = { type: 'down'|'move'|'up'|'cancel', id, x, y, t }
  // (x/y in any screen space, t in ms — e.g. PointerEvent.timeStamp.)
  // Returns 'undo' exactly once when a clean two-finger tap completes, else null.
  //
  // A tap counts only when:
  //   - exactly two pointers take part (a third finger cancels the gesture),
  //   - the second lands within `secondMs` of the first,
  //   - neither finger moves more than `slop` px from where it landed,
  //   - the whole gesture (first down → last up) stays within `tapMs`.
  function twoFingerTap(opts) {
    opts = opts || {};
    const TAP_MS = opts.tapMs != null ? opts.tapMs : 400;
    const SECOND_MS = opts.secondMs != null ? opts.secondMs : 220;
    const SLOP = opts.slop != null ? opts.slop : 12;

    let ids = [];    // pointer ids in down order
    let starts = {}; // id -> {x, y, t}
    let ups = {};    // id -> up time

    function reset() { ids = []; starts = {}; ups = {}; }

    function feed(ev) {
      switch (ev.type) {
        case 'down': {
          if (ids.length >= 2) { reset(); return null; } // third finger: that's a pinch, not a tap
          if (ids.length === 1 && ev.t - starts[ids[0]].t > SECOND_MS) reset(); // too slow for a pair — restart from this finger
          starts[ev.id] = { x: ev.x, y: ev.y, t: ev.t };
          ids.push(ev.id);
          return null;
        }
        case 'move': {
          const s = starts[ev.id];
          if (!s) return null;
          if (Math.hypot(ev.x - s.x, ev.y - s.y) > SLOP) reset(); // turned into a pan/pinch drag
          return null;
        }
        case 'up': {
          if (!starts[ev.id] || ups[ev.id] != null) return null;
          ups[ev.id] = ev.t;
          if (ids.length < 2 || !ids.every(id => ups[id] != null)) {
            if (ids.length < 2) reset(); // plain single-finger tap — nothing to recognize
            return null;
          }
          const t0 = Math.min(starts[ids[0]].t, starts[ids[1]].t);
          const t1 = Math.max(ups[ids[0]], ups[ids[1]]);
          const gap = Math.max(starts[ids[0]].t, starts[ids[1]].t) - t0;
          const res = (gap <= SECOND_MS && t1 - t0 <= TAP_MS) ? 'undo' : null;
          reset();
          return res;
        }
        case 'cancel': {
          reset();
          return null;
        }
      }
      return null;
    }

    return { feed: feed };
  }

  return { twoFingerTap: twoFingerTap };
}));
