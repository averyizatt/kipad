'use strict';

// Round-trip fidelity vs REAL KiCad exports (qa/data/pcbnew fixtures):
//   - arc tracks      : tracks_arcs_vias.kicad_pcb
//   - custom pads     : custom_pads.kicad_pcb
//   - groups          : groups_load_save.kicad_pcb
// plus a big real-export smoke (video.kicad_pcb).

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.KipadFootprints = require('../js/footprints.js');
global.KipadSexpr = require('../js/sexpr.js');
const B = require('../js/board.js');
const Pcb = require('../js/kicad_pcb.js');

const RAW = path.join(__dirname, '..', 'lib-build', 'raw');
const read = f => fs.readFileSync(path.join(RAW, f), 'utf8');
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ok - ' + msg); }

// ---------------- arc tracks ----------------
{
  const src = read('tracks_arcs_vias.kicad_pcb');
  const srcArcCount = (src.match(/(^\s*)\(arc (\S)/gm) || []).length;
  ok(srcArcCount >= 5, 'fixture really contains arc tracks (' + srcArcCount + ')');

  const b1 = Pcb.parseBoard(src);
  const arcs1 = b1.tracks.filter(t => t.kind === 'arc');
  ok(arcs1.length === srcArcCount, 'all arc tracks parsed (' + arcs1.length + ')');
  ok(arcs1.every(t => t.start && t.mid && t.end &&
    [t.start, t.mid, t.end].every(p => isFinite(p[0]) && isFinite(p[1]))),
    'arcs carry finite start/mid/end');
  ok(arcs1.some(t => t.layer === 'F.Cu') && arcs1.some(t => t.layer === 'B.Cu'),
    'arc layers preserved');

  const s1 = Pcb.serializeBoard(b1);
  ok(/(^|\s)\(arc(\s|\n)/.test(s1), 'serializer emits arc nodes back');
  const b2 = Pcb.parseBoard(s1);
  const arcs2 = b2.tracks.filter(t => t.kind === 'arc');
  ok(arcs2.length === arcs1.length, 'arc count survives round-trip');
  const close=(a,b)=>Math.abs(a-b)<=1e-4; // r4str rounds to 4 decimals
  for (let i = 0; i < arcs1.length; i++) {
    const a = arcs1[i], c = arcs2[i];
    for (const [key, pa, pc] of [['start',a.start,c.start],['mid',a.mid,c.mid],['end',a.end,c.end]]) {
      ok(close(pa[0],pc[0]) && close(pa[1],pc[1]), 'arc ' + i + ' ' + key + ' survives (' + pc + ')');
    }
    ok(c.width === a.width, 'arc ' + i + ' width');
    ok(c.layer === a.layer, 'arc ' + i + ' layer');
    ok(c.netId === a.netId, 'arc ' + i + ' netId');
  }
  passed++;
  console.log('  ok - arc fields survive round-trip field-by-field');

  // double round-trip byte-stable
  const s2 = Pcb.serializeBoard(Pcb.parseBoard(s1));
  ok(s1 === s2, 'double serialization byte-stable (arcs file)');
}

// ---------------- trackSegments geometry ----------------
{
  const straight = { kind: 'seg', start: [0, 0], end: [10, 0] };
  let segs = B.trackSegments(straight);
  ok(segs.length === 1 && segs[0].ax === 0 && segs[0].bx === 10,
    'straight track → single segment');

  const arc = { kind: 'arc', start: [29, 35.5], mid: [28.259892, 36.60765], end: [28, 37.914213] };
  segs = B.trackSegments(arc);
  ok(segs.length === 12, 'arc sampled into 12 chords');
  const first = segs[0], last = segs[segs.length - 1];
  ok(Math.hypot(first.ax - arc.start[0], first.ay - arc.start[1]) < 1e-6,
    'polyline starts at arc start');
  ok(Math.hypot(last.bx - arc.end[0], last.by - arc.end[1]) < 1e-6,
    'polyline ends at arc end');
  let best = Infinity;
  for (const s of segs)
    for (const p of [[s.ax, s.ay], [s.bx, s.by]])
      best = Math.min(best, Math.hypot(p[0] - arc.mid[0], p[1] - arc.mid[1]));
  ok(best < 0.05, 'polyline passes through the arc mid point (d=' + best.toFixed(4) + ')');

  const col = B.arcPolyline([0, 0], [5, 0], [10, 0]);
  ok(col.length === 2, 'collinear degenerate arc falls back to straight line');
}

// ---------------- custom pads ----------------
{
  const src = read('custom_pads.kicad_pcb');
  const b1 = Pcb.parseBoard(src);
  const pads = [];
  for (const fp of b1.footprints) for (const p of fp.pads) if (p.shape === 'custom') pads.push(p);
  ok(pads.length === 2, 'both custom pads parsed (' + pads.length + ')');

  const p1 = pads.find(p => p.number === '1' || p.number === 1);
  ok(!!p1, 'pad 1 found');
  ok(Array.isArray(p1.primitives) && p1.primitives.length === 1 &&
    p1.primitives[0].kind === 'gr_poly', 'custom pad carries gr_poly primitive');
  const prim = p1.primitives[0];
  assert.deepStrictEqual(prim.pts, [
    [-0.5, -0.75], [0.5, -0.75], [1, 0], [0.5, 0.75], [-0.5, 0.75]
  ]);
  passed++;
  console.log('  ok - primitive polygon points match the real file field-by-field');
  ok(prim.width === 0, 'primitive width preserved');
  ok(p1.anchor === 'rect', 'options anchor preserved');

  const s1 = Pcb.serializeBoard(b1);
  ok(/\scustom(\s|\n)/.test(s1) && /primitives/.test(s1), 'custom pad serialized back');
  const b2 = Pcb.parseBoard(s1);
  const p1b = [];
  for (const fp of b2.footprints) for (const p of fp.pads) if (p.shape === 'custom') p1b.push(p);
  ok(p1b.length === 2, 'custom pad count survives round-trip');
  assert.deepStrictEqual(JSON.stringify(p1b[0].primitives), JSON.stringify(p1.primitives));
  passed++;
  console.log('  ok - primitives survive round-trip verbatim');
  const s2 = Pcb.serializeBoard(Pcb.parseBoard(s1));
  ok(s1 === s2, 'double serialization byte-stable (custom pads file)');
}

// ---------------- groups ----------------
{
  const src = read('groups_load_save.kicad_pcb');
  const nSrc = (src.match(/\(group(\s|\n)/g) || []).length;
  ok(nSrc >= 1, 'fixture contains a group node');
  const b1 = Pcb.parseBoard(src);
  ok(b1.groups.length === nSrc, 'group parsed into board.groups');
  const g = b1.groups[0];
  ok(g.name === 'Group Name' || g.name.length > 0, 'group name kept (' + JSON.stringify(g.name) + ')');
  ok(g.members.length === 2, 'group members list preserved');
  ok(typeof g.locked === 'boolean', 'locked flag parsed');

  const s1 = Pcb.serializeBoard(b1);
  const g2 = Pcb.parseBoard(s1).groups[0];
  assert.deepStrictEqual(g2.members, g.members);
  assert.strictEqual(g2.name, g.name);
  assert.strictEqual(g2.locked, g.locked);
  passed++;
  console.log('  ok - group survives round-trip (name/members/locked)');
}

// ---------------- big real-export smoke ----------------
{
  const t0 = Date.now();
  const src = read('video.kicad_pcb');
  const b1 = Pcb.parseBoard(src);
  const s1 = Pcb.serializeBoard(b1);
  const b2 = Pcb.parseBoard(s1);
  ok(b1.tracks.length === b2.tracks.length,
    'video.kicad_pcb: tracks stable (' + b1.tracks.length + ', ' + (Date.now() - t0) + ' ms cycle)');
  ok(b1.footprints.length === b2.footprints.length,
    'video.kicad_pcb: footprints stable (' + b1.footprints.length + ')');
  ok(b1.vias.length === b2.vias.length, 'video.kicad_pcb: vias stable');
  const s2 = Pcb.serializeBoard(Pcb.parseBoard(s1));
  ok(s1 === s2, 'video.kicad_pcb: double serialization byte-stable');
}

console.log('\ntest_roundtrip2: ' + passed + ' checks passed');
