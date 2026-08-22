'use strict';

/**
 * build-symbols.js — build lib/symbols.json from the real KiCad symbol sources.
 *
 * Reads the cloned kicad-symbols repo (lib-build/symbols-src), parses the
 * requested libraries with js/kicad_sym.js, dedupes by symbol name, caps the
 * total at 400 symbols (per-library quotas, alphabetical), and writes
 * lib/symbols.json as a JSON ARRAY of symbol objects.
 *
 * Usage: node lib-build/build-symbols.js
 */

const fs = require('fs');
const path = require('path');
const KipadKicadSym = require('../js/kicad_sym.js');

const SRC = path.join(__dirname, 'symbols-src');
const OUT = path.join(__dirname, '..', 'lib', 'symbols.json');
const MAX_TOTAL = 400;

// Essential everyday components always kept, so the built library is actually
// usable (and so tests can rely on R / power rails existing). Anything not
// found in the sources is skipped. Reserved first, remaining budget is filled
// by per-library alphabetical quotas below.
const ESSENTIALS = ['R', 'C', 'LED', 'GND', 'VCC', '+5V'];

// Libraries in priority order (first occurrence wins on name collision).
const LIBRARIES = [
  'Device',
  'Power',
  'Switch',
  'Transistor_BJT',
  'Diode',
  'LED',
  'Amplifier_Operational',
  'Regulator_Linear',
  'Timer'
];

/**
 * Resolve a library name to a source:
 *  - { kind: 'dir',  path }   -> <Name>.kicad_symdir/  (or lowercase variant)
 *  - { kind: 'file', path }   -> single <Name>.kicad_sym file
 *  - null                     -> not found
 */
function resolveLibrary(name) {
  const candidates = [name, name.toLowerCase(), name.toUpperCase()];
  for (const c of candidates) {
    const dir = path.join(SRC, c + '.kicad_symdir');
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return { kind: 'dir', path: dir };
    }
  }
  for (const c of candidates) {
    const file = path.join(SRC, c + '.kicad_sym');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return { kind: 'file', path: file };
    }
  }
  return null;
}

function readSymbolsFromFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  return KipadKicadSym.parseKicadSym(text);
}

function readLibrary(src) {
  const symbols = [];
  if (src.kind === 'file') {
    return readSymbolsFromFile(src.path);
  }
  // dir layout: one .kicad_sym file per symbol
  const files = fs.readdirSync(src.path)
    .filter((f) => f.endsWith('.kicad_sym'))
    .sort();
  for (const f of files) {
    try {
      const parsed = readSymbolsFromFile(path.join(src.path, f));
      for (const s of parsed) symbols.push(s);
    } catch (e) {
      console.error(`  warn: failed to parse ${f}: ${e.message}`);
    }
  }
  return symbols;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`ERROR: source dir not found: ${SRC}`);
    console.error('Run: git clone --depth 1 https://gitlab.com/kicad/libraries/kicad-symbols.git lib-build/symbols-src');
    process.exit(1);
  }

  // 1. Parse each library.
  const libs = [];
  const seen = {}; // symbol name -> true (first occurrence wins)
  for (const libName of LIBRARIES) {
    const src = resolveLibrary(libName);
    if (!src) {
      console.log(`  ${libName}: NOT FOUND`);
      continue;
    }
    const parsed = readLibrary(src);
    // Dedupe by name within the global priority order (first wins).
    const unique = [];
    for (const s of parsed) {
      if (!s || typeof s.name !== 'string' || !s.name) continue;
      if (seen[s.name]) continue;
      seen[s.name] = true;
      unique.push(s);
    }
    unique.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    libs.push({ name: libName, how: src.kind, symbols: unique });
    console.log(`  ${libName}: ${src.kind} (${src.kind === 'dir' ? 'per-symbol files' : 'single file'}), ${unique.length} unique symbols`);
  }

  let total = libs.reduce((n, l) => n + l.symbols.length, 0);
  console.log(`Parsed ${total} symbols before cap.`);

  // 2a. Reserve essential symbols (in library priority order, first wins).
  const reserved = [];
  for (const name of ESSENTIALS) {
    for (const l of libs) {
      const idx = l.symbols.findIndex((s) => s.name === name);
      if (idx !== -1) {
        const s = l.symbols.splice(idx, 1)[0]; // remove from pool, keep in reserved
        reserved.push(s);
        break;
      }
    }
  }
  if (reserved.length) {
    console.log(`Reserved essentials: ${reserved.map((s) => s.name).join(', ')}`);
  }
  total = libs.reduce((n, l) => n + l.symbols.length, 0);

  // 2b. Cap remaining at (MAX_TOTAL - reserved) with proportional quotas (min 1 each).
  const budget = MAX_TOTAL - reserved.length;
  let chosen = reserved.slice();
  if (total > budget) {
    const nonEmpty = libs.filter((l) => l.symbols.length > 0);
    let quotas = nonEmpty.map((l) => {
      const q = Math.max(1, Math.floor((budget * l.symbols.length) / total));
      return Math.min(q, l.symbols.length);
    });
    // Reduce the largest quota until we fit (deterministic tie-break: first max).
    let sum = quotas.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (sum > budget && guard++ < 10000) {
      let maxIdx = 0;
      for (let i = 1; i < quotas.length; i++) {
        if (quotas[i] > quotas[maxIdx]) maxIdx = i;
      }
      quotas[maxIdx]--;
      sum--;
    }
    for (let i = 0; i < nonEmpty.length; i++) {
      chosen = chosen.concat(nonEmpty[i].symbols.slice(0, quotas[i]));
    }
    // Fill remaining budget from libraries with leftovers (in library order).
    let remaining = budget - (chosen.length - reserved.length);
    for (let i = 0; i < nonEmpty.length && remaining > 0; i++) {
      const take = Math.min(remaining, nonEmpty[i].symbols.length - quotas[i]);
      if (take > 0) {
        chosen = chosen.concat(nonEmpty[i].symbols.slice(quotas[i], quotas[i] + take));
        remaining -= take;
      }
    }
  } else {
    for (const l of libs) chosen = chosen.concat(l.symbols);
  }

  // 3. Sort by name and write.
  chosen.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const json = JSON.stringify(chosen);
  fs.writeFileSync(OUT, json, 'utf8');

  const bytes = Buffer.byteLength(json, 'utf8');
  console.log(`Wrote ${chosen.length} symbols -> ${OUT} (${bytes} bytes, ${(bytes / 1024).toFixed(1)} KiB)`);
}

main();
