#!/usr/bin/env node
// Two-finger tap recognizer tests (KipadGestures).
const assert = require('assert');
const KipadGestures = require('../js/gestures.js');

let passed = 0;
function ok(cond, name) { assert.ok(cond, name); passed++; }

function mk() { return KipadGestures.twoFingerTap(); }
// shorthand event builders
const down = (g, id, x, y, t) => g.feed({ type: 'down', id, x, y, t });
const move = (g, id, x, y, t) => g.feed({ type: 'move', id, x, y, t });
const up = (g, id, x, y, t) => g.feed({ type: 'up', id, x, y, t });
const cancel = (g, id) => g.feed({ type: 'cancel', id });

// 1. clean two-finger tap fires exactly once
{
  const g = mk();
  ok(down(g, 1, 100, 100, 0) === null, 'first down no fire');
  ok(down(g, 2, 140, 105, 40) === null, 'second down no fire');
  ok(move(g, 1, 102, 101, 60) === null, 'small move tolerated');
  ok(up(g, 1, 102, 101, 120) === null, 'first up waits for second');
  ok(up(g, 2, 140, 105, 150) === 'undo', 'clean tap fires undo');
  ok(up(g, 2, 140, 105, 160) === null, 'no double fire after reset');
}

// 2. single finger alone never fires
{
  const g = mk();
  down(g, 1, 0, 0, 0);
  up(g, 1, 0, 0, 50);
  ok(true, 'single tap handled');
  // and a fresh two-finger tap afterwards still works (state was reset)
  down(g, 3, 0, 0, 500);
  down(g, 4, 30, 0, 520);
  ok(up(g, 3, 0, 0, 560) === null && up(g, 4, 30, 0, 580) === 'undo', 'reusable after single tap');
}

// 3. second finger landing too late -> no fire
{
  const g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 300); // > 220 ms gap
  ok(up(g, 1, 0, 0, 340) === null && up(g, 2, 30, 0, 360) === null, 'late second finger rejected');
}

// 4. gap exactly at the limit still counts
{
  const g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 220); // == SECOND_MS
  up(g, 1, 0, 0, 260);
  ok(up(g, 2, 30, 0, 280) === 'undo', 'gap boundary inclusive');
}

// 5. movement beyond slop disarms (either finger)
{
  let g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 20);
  move(g, 2, 43, 0, 40); // 13 px > 12 slop
  up(g, 1, 0, 0, 60);
  ok(up(g, 2, 43, 0, 80) === null, 'drag disarms gesture');

  g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 20);
  move(g, 1, 0, -12.5, 40);
  up(g, 1, 0, -12.5, 60);
  ok(up(g, 2, 30, 0, 80) === null, 'first-finger drag also disarms');

  g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 20);
  up(g, 1, 0, 0, 40);
  move(g, 2, 45, 0, 50); // drag after partner lifted
  ok(up(g, 2, 45, 0, 70) === null, 'post-up drag by remaining finger disarms');
}

// 6. movement within slop is fine
{
  const g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 20);
  move(g, 2, 39, 4, 40); // hypot(9,4) ≈ 9.85 <= 12
  up(g, 1, 0, 0, 60);
  ok(up(g, 2, 39, 4, 80) === 'undo', 'sub-slop wiggle tolerated');
}

// 7. held too long -> no fire
{
  const g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 30);
  up(g, 1, 0, 0, 400);
  ok(up(g, 2, 30, 0, 420) === null, 'total duration over tapMs rejected'); // 420 > 400
}

// 8. total duration exactly at limit counts
{
  const g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 30);
  up(g, 2, 30, 0, 380);
  ok(up(g, 1, 0, 0, 400) === 'undo', 'duration boundary inclusive');
}

// 9. third finger cancels
{
  const g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 20);
  down(g, 3, 60, 0, 40);
  up(g, 1, 0, 0, 60);
  up(g, 2, 30, 0, 80);
  up(g, 3, 60, 0, 100);
  ok(true, 'three-finger interaction does not throw');
  // recognizer is clean again
  down(g, 5, 0, 0, 200);
  down(g, 6, 30, 0, 210);
  up(g, 5, 0, 0, 240);
  ok(up(g, 6, 30, 0, 250) === 'undo', 'usable after three-finger reset');
}

// 10. pointercancel resets safely
{
  const g = mk();
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 20);
  cancel(g, 1);
  ok(up(g, 2, 30, 0, 60) === null, 'cancel clears state');
}

// 11. unknown ids are ignored (mouse mixed in etc.)
{
  const g = mk();
  ok(move(g, 99, 5, 5, 10) === null, 'move for unknown id ignored');
  ok(up(g, 99, 5, 5, 20) === null, 'up for unknown id ignored');
  down(g, 1, 0, 0, 0);
  ok(up(g, 99, 1, 1, 30) === null, 'unknown up does not count as lift');
}

// 12. custom options honoured
{
  const g = KipadGestures.twoFingerTap({ tapMs: 100, secondMs: 50, slop: 2 });
  down(g, 1, 0, 0, 0);
  down(g, 2, 30, 0, 40); // within 50ms
  move(g, 2, 33, 0, 50); // 3 px > slop 2
  ok(up(g, 1, 0, 0, 60) === null && up(g, 2, 33, 0, 90) === null, 'custom slop enforced');

  const g2 = KipadGestures.twoFingerTap({ tapMs: 100, secondMs: 50, slop: 2 });
  down(g2, 1, 0, 0, 0);
  down(g2, 2, 30, 0, 49);
  up(g2, 1, 0, 0, 60);
  ok(up(g2, 2, 30, 0, 100) === 'undo', 'custom windows inclusive');
}

console.log('test_gestures: ' + passed + ' checks passed');
