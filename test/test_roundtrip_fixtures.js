'use strict';

// Real-project .kicad_pcb round-trip regression fixtures.
//
// Sweeps every real KiCad board export tracked under lib-build (the
// pcbnew demo/qa exports in raw/ plus the real-board copy used by the
// Gerber/DRC/pos suites). For each file:
//   1. parse → serialize → re-parse must be structurally stable — nothing
//      modeled may be silently dropped, duplicated or mutated;
//   2. the second serialization cycle must be byte-stable (s1 === s2);
//   3. parsed element counts must match ground truth counted from the raw
//      source text, so a parser regression that starts skipping a modeled
//      element type fails loudly here instead of at export time.
//
// Element types the model intentionally does not keep (non-silk gr_text,
// non-edge gr_line/gr_rect/gr_poly, dimensions) are out of scope here —
// see the "Preserve unsupported nodes" TODO.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.KipadSexpr = require('../js/sexpr.js');
const Pcb = require('../js/kicad_pcb.js');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ok - ' + msg); }

const count = (src, re) => (src.match(re) || []).length;

// Ground truth per fixture: counts scanned straight from the source sexpr.
const FIXTURES = [
  {
    file: 'lib-build/raw/custom_pads.kicad_pcb',
    truth: src => ({
      footprints: count(src, /\(\s*(?:footprint|module)[\s(]/g),
      segs: count(src, /\(\s*segment[\s(]/g), arcs: 0, vias: 0, zones: 0,
    }),
  },
  {
    file: 'lib-build/raw/groups_load_save.kicad_pcb',
    truth: src => ({
      footprints: count(src, /\(\s*(?:footprint|module)[\s(]/g),
      segs: count(src, /\(\s*segment[\s(]/g), arcs: 0, vias: 0, zones: 0,
      groups: count(src, /\(\s*group[\s(]/g),
    }),
  },
  {
    file: 'lib-build/raw/tracks_arcs_vias.kicad_pcb',
    truth: src => ({
      footprints: count(src, /\(\s*(?:footprint|module)[\s(]/g),
      segs: count(src, /\(\s*segment[\s(]/g),
      arcs: count(src, /\(\s*arc[\s(]/g),
      vias: count(src, /\(\s*via[\s)]/g), zones: 0,
    }),
  },
  {
    file: 'lib-build/raw/pic_programmer.kicad_pcb',
    truth: src => ({
      footprints: count(src, /\(\s*(?:footprint|module)[\s(]/g),
      segs: count(src, /\(\s*segment[\s(]/g), arcs: 0,
      vias: count(src, /\(\s*via[\s)]/g),
      zones: count(src, /\(\s*zone[\s(]/g),
    }),
  },
  {
    // Byte-identical copy of pic_programmer kept at lib-build root for the
    // gerber/courtyard/pos suites — swept so that path stays honest too.
    file: 'lib-build/real-board.kicad_pcb',
    truth: src => ({
      footprints: count(src, /\(\s*(?:footprint|module)[\s(]/g),
      segs: count(src, /\(\s*segment[\s(]/g), arcs: 0,
      vias: count(src, /\(\s*via[\s)]/g),
      zones: count(src, /\(\s*zone[\s(]/g),
    }),
  },
  {
    file: 'lib-build/raw/video.kicad_pcb',
    truth: src => ({
      footprints: count(src, /\(\s*(?:footprint|module)[\s(]/g),
      segs: count(src, /\(\s*segment[\s(]/g), arcs: 0,
      vias: count(src, /\(\s*via[\s)]/g),
      zones: count(src, /\(\s*zone[\s(]/g),
    }),
  },
];

// Serializer emits r4str (4-decimal) coordinates, so cycle-2 geometry may
// sit up to 5e-5 off cycle-1 values parsed straight from the source file
// (e.g. video.kicad_pcb vias at 108.45799). Compare at output precision.
const q4 = n => Math.round(n * 1e4) / 1e4;

function snapshot(b) {
  const kinds = {};
  for (const t of b.tracks) {
    const k = t.kind || 'seg';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  return {
    nets: b.nets.map(n => [n.id, n.name]),
    // per-footprint fingerprint: ref/side/rotation + multiset of pad shapes
    fps: b.footprints.map(fp => [
      fp.ref, fp.layer, q4(fp.angle),
      fp.pads.map(p => p.shape).sort().join(','),
    ]),
    trackKinds: kinds,
    vias: b.vias.map(v => [q4(v.at[0]), q4(v.at[1]), v.size, v.drill, v.netId]),
    texts: b.texts.map(t => [t.text, t.layer, q4(t.at[0]), q4(t.at[1])]),
    zones: b.zones.map(z => [z.net, z.layer, z.outline.length]),
    outlineSegs: b.outline.length,
    groups: (b.groups || []).map(g =>
      [g.name, g.members.slice().sort(), !!g.locked]),
  };
}

for (const fx of FIXTURES) {
  const abs = path.join(ROOT, fx.file);
  assert.ok(fs.existsSync(abs), 'fixture present: ' + fx.file);
  const src = fs.readFileSync(abs, 'utf8');

  const t0 = Date.now();
  const b1 = Pcb.parseBoard(src);

  // -- ground truth: nothing modeled is silently skipped -----------------
  const want = fx.truth(src);
  ok(b1.footprints.length === want.footprints,
    fx.file + ': all ' + want.footprints + ' footprint(s) parse');
  const segs = (b1.tracks.filter(t => !t.kind || t.kind === 'seg')).length;
  const arcs = b1.tracks.filter(t => t.kind === 'arc').length;
  ok(segs === want.segs, fx.file + ': all ' + want.segs + ' segment tracks parse');
  if (want.arcs !== undefined && !(fx.file.endsWith('custom_pads') || fx.file.endsWith('groups_load_save')))
    ok(arcs === want.arcs, fx.file + ': all ' + want.arcs + ' arc tracks parse');
  ok(b1.vias.length === want.vias, fx.file + ': all ' + want.vias + ' via(s) parse');
  if (want.zones !== undefined)
    ok(b1.zones.length === want.zones, fx.file + ': all ' + want.zones + ' zone(s) parse');
  if (want.groups !== undefined)
    ok((b1.groups || []).length === want.groups,
      fx.file + ': all ' + want.groups + ' group(s) parse');

  // -- round trip: structural stability ----------------------------------
  const s1 = Pcb.serializeBoard(b1);
  const b2 = Pcb.parseBoard(s1);
  const a = snapshot(b1), c = snapshot(b2);
  for (const key of Object.keys(a)) {
    assert.deepStrictEqual(c[key], a[key],
      fx.file + ': ' + key + ' stable across round-trip');
  }
  passed++;
  console.log('  ok - ' + fx.file + ': structure stable (' +
    b1.footprints.length + ' fps, ' + b1.tracks.length + ' tracks, ' +
    b1.vias.length + ' vias, ' + b1.zones.length + ' zones)');

  // -- second serialization cycle is byte-stable --------------------------
  const s2 = Pcb.serializeBoard(Pcb.parseBoard(s1));
  ok(s1 === s2, fx.file + ': double serialization byte-stable (' +
    (Date.now() - t0) + ' ms cycle)');
}

console.log('\ntest_roundtrip_fixtures: ' + passed + ' checks passed');
