'use strict';

/**
 * Kipad footprint library builder.
 *
 * Downloads real .kicad_mod footprint files from the official KiCad
 * kicad-footprints GitHub mirror, converts them to Kipad's internal
 * footprint JSON via js/kicad_mod.js and writes lib/footprints.json
 * (a JSON ARRAY of footprint objects sorted by name).
 *
 * Run: node lib-build/build-footprints.js
 *
 * Layout:
 *   - CURATED : the curated library list (resistors, caps, inductors,
 *     diodes, LEDs, transistors, SOIC/TSSOP/QFP/QFN, DIP, TO-*, pin
 *     headers/sockets, USB-C, barrel jacks, crystals, switches, fuses,
 *     test points, mounting holes).
 *   - EXTRA   : additional common footprints in the same categories.
 *     The curated list alone is 140 entries, and ~21 of those names have
 *     been renamed upstream (QFN/QFP gained -1EP suffixes, crystals and
 *     barrel jacks were renamed, button switches moved), so EXTRA is
 *     required to reliably exceed the 150-footprint minimum (target ~170).
 *   - RELOCATED: category fallbacks — KiCad moved Transistor_SMD SOT
 *     packages to Package_TO_SOT_SMD. If the curated CAT 404s, the same
 *     NAME is retried in the relocated category.
 *
 * Raw files are cached in lib-build/raw/<CAT>/<NAME>.kicad_mod so re-runs
 * are fast and offline-capable. 404s / parse failures are skipped with a
 * console.log. The build fails (exit code 1) if fewer than 150 footprints
 * convert successfully.
 */

const fs = require('fs');
const path = require('path');
const KipadKicadMod = require('../js/kicad_mod.js');

const BASE = 'https://raw.githubusercontent.com/KiCad/kicad-footprints/master/';
const RAW_DIR = path.join(__dirname, 'raw');
const OUT = path.join(__dirname, '..', 'lib', 'footprints.json');
const MIN_SUCCESS = 150;

// --- curated list (CAT = .pretty dir, NAME = file base) ---
const CURATED = {
  'Resistor_SMD': [
    'R_01005_0201Metric', 'R_0201_0603Metric', 'R_0402_1005Metric', 'R_0603_1608Metric',
    'R_0805_2012Metric', 'R_1206_3216Metric', 'R_1210_3225Metric', 'R_1812_4532Metric',
    'R_2010_5025Metric', 'R_2512_6332Metric'
  ],
  'Capacitor_SMD': [
    'C_01005_0201Metric', 'C_0201_0603Metric', 'C_0402_1005Metric', 'C_0603_1608Metric',
    'C_0805_2012Metric', 'C_1206_3216Metric', 'C_1210_3225Metric', 'C_1812_4532Metric',
    'C_2010_5025Metric', 'C_2512_6332Metric'
  ],
  'Inductor_SMD': [
    'L_0402_1005Metric', 'L_0603_1608Metric', 'L_0805_2012Metric', 'L_1206_3216Metric',
    'L_1210_3225Metric', 'L_1812_4532Metric'
  ],
  'Diode_SMD': [
    'D_0402_1005Metric', 'D_0603_1608Metric', 'D_0805_2012Metric', 'D_1206_3216Metric',
    'D_SOD-123', 'D_SOD-323', 'D_SOD-523', 'D_SMA', 'D_SMB', 'D_SMC', 'D_SOT-23'
  ],
  'Diode_THT': [
    'D_DO-35_SOD27_P7.62mm_Horizontal', 'D_DO-41_SOD81_P10.16mm_Horizontal',
    'D_A-405_P10.16mm_Horizontal', 'D_DO-201AD_P15.24mm_Horizontal'
  ],
  'LED_SMD': [
    'LED_0402_1005Metric', 'LED_0603_1608Metric', 'LED_0805_2012Metric',
    'LED_1206_3216Metric', 'LED_1210_3528Metric'
  ],
  'LED_THT': ['LED_D3.0mm', 'LED_D5.0mm', 'LED_D8.0mm', 'LED_D10.0mm'],
  'Transistor_SMD': [
    'SOT-23', 'SOT-223', 'SOT-89-3', 'SOT-323', 'SOT-363', 'SOT-23-5', 'SOT-23-6'
  ],
  'Package_SO': [
    'SOIC-8_3.9x4.9mm_P1.27mm', 'SOIC-14_3.9x8.7mm_P1.27mm', 'SOIC-16_3.9x9.9mm_P1.27mm',
    'SOIC-16_7.5x10.3mm_P1.27mm', 'SOIC-20_7.5x12.8mm_P1.27mm',
    'TSSOP-8_3x3mm_P0.65mm', 'TSSOP-14_4.4x5mm_P0.65mm', 'TSSOP-16_4.4x5mm_P0.65mm',
    'TSSOP-20_4.4x6.5mm_P0.65mm', 'MSOP-8_3x3mm_P0.65mm', 'MSOP-10_3x3mm_P0.5mm',
    'QFP-32_7x7mm_P0.8mm', 'QFP-48_7x7mm_P0.5mm', 'QFP-64_10x10mm_P0.5mm',
    'QFN-16_3x3mm_P0.5mm', 'QFN-24_4x4mm_P0.5mm', 'QFN-32_5x5mm_P0.5mm',
    'QFN-48_7x7mm_P0.5mm', 'QFN-64_9x9mm_P0.5mm'
  ],
  'Package_DIP': [
    'DIP-4_W7.62mm', 'DIP-6_W7.62mm', 'DIP-8_W7.62mm', 'DIP-8_W10.16mm',
    'DIP-14_W7.62mm', 'DIP-16_W7.62mm', 'DIP-20_W7.62mm', 'DIP-24_W7.62mm', 'DIP-28_W7.62mm'
  ],
  'Package_TO_SOT_THT': [
    'TO-92_Inline', 'TO-92_Wide', 'TO-220-3_Vertical', 'TO-220-3_Horizontal_TabDown',
    'TO-220-5_Vertical', 'TO-247-3_Vertical'
  ],
  'Connector_PinHeader_2.54mm': [
    'PinHeader_1x02_P2.54mm_Vertical', 'PinHeader_1x03_P2.54mm_Vertical',
    'PinHeader_1x04_P2.54mm_Vertical', 'PinHeader_1x05_P2.54mm_Vertical',
    'PinHeader_1x06_P2.54mm_Vertical', 'PinHeader_1x07_P2.54mm_Vertical',
    'PinHeader_1x08_P2.54mm_Vertical', 'PinHeader_1x09_P2.54mm_Vertical',
    'PinHeader_1x10_P2.54mm_Vertical', 'PinHeader_1x12_P2.54mm_Vertical',
    'PinHeader_2x02_P2.54mm_Vertical', 'PinHeader_2x03_P2.54mm_Vertical',
    'PinHeader_2x04_P2.54mm_Vertical', 'PinHeader_2x05_P2.54mm_Vertical',
    'PinHeader_2x06_P2.54mm_Vertical', 'PinHeader_2x07_P2.54mm_Vertical',
    'PinHeader_2x08_P2.54mm_Vertical', 'PinHeader_2x10_P2.54mm_Vertical',
    'PinHeader_1x04_P2.54mm_Horizontal'
  ],
  'Connector_PinSocket_2.54mm': [
    'PinSocket_1x02_P2.54mm_Vertical', 'PinSocket_1x04_P2.54mm_Vertical',
    'PinSocket_1x06_P2.54mm_Vertical', 'PinSocket_1x08_P2.54mm_Vertical',
    'PinSocket_2x02_P2.54mm_Vertical', 'PinSocket_2x04_P2.54mm_Vertical',
    'PinSocket_2x06_P2.54mm_Vertical', 'PinSocket_2x08_P2.54mm_Vertical'
  ],
  'Connector_USB': ['USB_C_Receptacle_HRO_TYPE-C-31-M-12'],
  'Connector_BarrelJack': ['BarrelJack_CUI_PJ-063AH', 'BarrelJack_CUI_PJ-102BH'],
  'Crystal': [
    'Crystal_HC49-4H_Vertical', 'Crystal_HC49-4H_Horizontal',
    'Crystal_SMD_3215-4Pin_3.2x1.5mm', 'Crystal_SMD_4Pin_3.2x2.5mm',
    'Crystal_SMD_5x3.2mm_4Pin'
  ],
  'Button_Switch_SMD': ['SW_Push_1P1T_NO_6x6mm_H7.0mm', 'SW_Push_1P1T_NO_6x6mm_H13mm'],
  'Button_Switch_THT': ['SW_Push_1P1T_NO_12x12mm_H7.0mm', 'SW_Push_1P1T_NO_6x6mm_H7.0mm'],
  'Fuse': ['Fuse_0805_2012Metric', 'Fuse_1206_3216Metric', 'Fuse_1812_4532Metric'],
  'TestPoint': ['TestPoint_Pad_D1.0mm', 'TestPoint_Pad_D1.5mm', 'TestPoint_Pad_D2.0mm'],
  'MountingHole': [
    'MountingHole_2.2mm_M2', 'MountingHole_3.2mm_M3', 'MountingHole_4.3mm_M4',
    'MountingHole_5.3mm_M5'
  ]
};

// --- extra common footprints, same categories (all verified to exist on
//     master at build time) ---
const EXTRA = {
  'Resistor_SMD': ['R_0612_1632Metric', 'R_1020_2550Metric', 'R_4020_10251Metric'],
  'Inductor_SMD': ['L_0201_0603Metric', 'L_2512_6332Metric'],
  'Diode_SMD': ['D_SOD-123F'],
  'Package_DIP': ['DIP-32_W7.62mm', 'DIP-40_W15.24mm'],
  'Package_TO_SOT_THT': [
    'TO-126-3_Vertical', 'TO-220-2_Vertical', 'TO-220-4_Vertical', 'TO-92L_Inline'
  ],
  'Package_TO_SOT_SMD': ['SOT-143'],
  'Fuse': ['Fuse_0402_1005Metric', 'Fuse_0603_1608Metric', 'Fuse_1210_3225Metric', 'Fuse_2512_6332Metric'],
  'LED_THT': ['LED_D4.0mm'],
  'Connector_PinHeader_2.54mm': [
    'PinHeader_1x01_P2.54mm_Vertical', 'PinHeader_2x01_P2.54mm_Vertical',
    'PinHeader_1x02_P2.54mm_Horizontal', 'PinHeader_1x11_P2.54mm_Vertical',
    'PinHeader_1x13_P2.54mm_Vertical', 'PinHeader_1x14_P2.54mm_Vertical',
    'PinHeader_1x15_P2.54mm_Vertical', 'PinHeader_1x20_P2.54mm_Vertical',
    'PinHeader_2x09_P2.54mm_Vertical', 'PinHeader_2x11_P2.54mm_Vertical',
    'PinHeader_2x12_P2.54mm_Vertical', 'PinHeader_2x20_P2.54mm_Vertical'
  ],
  'Connector_PinSocket_2.54mm': [
    'PinSocket_1x03_P2.54mm_Vertical', 'PinSocket_1x05_P2.54mm_Vertical',
    'PinSocket_1x07_P2.54mm_Vertical', 'PinSocket_1x09_P2.54mm_Vertical',
    'PinSocket_1x10_P2.54mm_Vertical', 'PinSocket_1x20_P2.54mm_Vertical',
    'PinSocket_2x03_P2.54mm_Vertical', 'PinSocket_2x05_P2.54mm_Vertical',
    'PinSocket_2x07_P2.54mm_Vertical', 'PinSocket_2x10_P2.54mm_Vertical'
  ],
  'Package_SO': ['TSSOP-24_4.4x7.8mm_P0.65mm', 'TSSOP-28_4.4x9.7mm_P0.65mm'],
  'MountingHole': ['MountingHole_8.4mm_M8'],
  'TestPoint': ['TestPoint_Pad_D3.0mm', 'TestPoint_Pad_D4.0mm']
};

// categories whose contents moved upstream (retry same NAME in new CAT)
const RELOCATED = { 'Transistor_SMD': 'Package_TO_SOT_SMD' };

const DELAY_MS = 50;

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function fetchFile(cat, name) {
  const p = path.join(RAW_DIR, cat, name + '.kicad_mod');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const url = BASE + cat + '.pretty/' + name + '.kicad_mod';
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;
  const text = await res.text();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  } catch (e) { /* cache is best-effort */ }
  return text;
}

function validFootprint(fp) {
  if (!fp || typeof fp.name !== 'string' || !fp.name) return false;
  if (typeof fp.ref !== 'string' || !fp.ref) return false;
  if (!fp.courtyard || !Array.isArray(fp.courtyard.min) || !Array.isArray(fp.courtyard.max)) return false;
  if (!Array.isArray(fp.pads) || !fp.pads.length) return false;
  return true;
}

async function main() {
  // merge curated + extra into a name->{cat, source} map (curated wins)
  const wanted = new Map();
  for (const [cat, names] of Object.entries(CURATED)) {
    for (const n of names) wanted.set(n, { cat: cat, source: 'curated' });
  }
  for (const [cat, names] of Object.entries(EXTRA)) {
    for (const n of names) if (!wanted.has(n)) wanted.set(n, { cat: cat, source: 'extra' });
  }

  const ok = [];
  const failed = []; // { name, cat, why }

  // deterministic (sorted) order with a small delay between requests
  const entries = [...wanted.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [name, w] of entries) {
    let text = await fetchFile(w.cat, name);
    let usedCat = w.cat;
    if (text === null && RELOCATED[w.cat]) {
      text = await fetchFile(RELOCATED[w.cat], name);
      usedCat = RELOCATED[w.cat];
    }
    if (text === null) {
      failed.push({ name: name, cat: w.cat, why: 'HTTP 404/error' });
      console.log('SKIP  ' + w.cat + '/' + name + '  (404/error)');
      await delay(DELAY_MS);
      continue;
    }
    const fp = KipadKicadMod.parseKicadMod(text);
    if (!fp || !validFootprint(fp)) {
      failed.push({ name: name, cat: usedCat, why: 'parse failure' });
      console.log('SKIP  ' + usedCat + '/' + name + '  (parse failure)');
      await delay(DELAY_MS);
      continue;
    }
    fp.library = usedCat;
    ok.push(fp);
    await delay(DELAY_MS);
  }

  ok.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(ok));
  const bytes = fs.statSync(OUT).size;

  console.log('Footprints written: ' + ok.length);
  console.log('JSON bytes: ' + bytes);
  if (failed.length) {
    console.log('Skipped (' + failed.length + '):');
    for (const f of failed) console.log('  - ' + f.cat + '/' + f.name + ' (' + f.why + ')');
  }

  if (ok.length < MIN_SUCCESS) {
    console.error('FAIL: only ' + ok.length + ' footprints (minimum ' + MIN_SUCCESS + ')');
    process.exitCode = 1;
  } else {
    console.log('OK: >= ' + MIN_SUCCESS + ' footprints');
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
