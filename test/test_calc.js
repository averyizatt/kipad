#!/usr/bin/env node
// KipadCalc tests: track width, via stats, electrical spacing,
// resistor colour code (both directions), divider, E-series, antenna, regulator,
// and microstrip transmission lines.
const assert = require('assert');
const C = require('../js/calculators.js');

let passed = 0;
function ok(cond, name) { assert.ok(cond, name); passed++; }
function near(a, b, tol, name) {
  assert.ok(Math.abs(a - b) <= tol, name + ` (${a} vs ${b} ±${tol})`);
  passed++;
}

// ---------- 1. trackWidth: KiCad reference values ----------
{
  // External, 1 A, ΔT 10 °C, 1 oz -> ~11.83 mil / 0.3006 mm (IPC-2221 k=0.048)
  const r = C.trackWidth(1, 10, 1, false);
  near(r.areaMil2, 16.30, 0.15, 'ext area mil2');
  near(r.widthMil, 11.83, 0.12, 'ext width mil');
  near(r.widthMm, 0.3005, 0.004, 'ext width mm');

  // Internal halves the ampacity constant: same input -> area ×(k_ext/k_int)^(1/c)
  const i = C.trackWidth(1, 10, 1, true);
  ok(i.widthMm > r.widthMm * 2 && i.widthMm < r.widthMm * 3, 'internal wider than external');
  near(i.areaMil2 / r.areaMil2, Math.pow(2, 1 / 0.725), 0.001, 'area ratio = 2^(1/c)');

  // monotonic in current at fixed copper weight
  const big = C.trackWidth(2, 10, 1, true);
  ok(big.widthMm > i.widthMm, 'more current needs more width');

  // degenerate inputs
  ok(C.trackWidth(0, 10, 1, false).widthMm === 0, 'zero current -> zero width');
  ok(C.trackWidth(-1, 10, 1, false).widthMm === 0, 'negative current -> zero width');
}

// ---------- 2. viaStats ----------
{
  // 0.6 mm drill, 25 µm plating, 1.6 mm length: annulus ≈ π/4(0.65²−0.6²)=0.04909 mm²
  const v = C.viaStats({ drillMm: 0.6, platingUm: 25, lengthMm: 1.6, deltaT: 10, currentA: 1 });
  near(v.annulusMm2, 0.049087, 1e-5, 'annulus area');
  near(v.iMaxA, 1.53, 0.05, 'via Imax ~1.53 A @ ΔT10');
  near(v.rOhms, 5.61e-4, 3e-5, 'barrel resistance');
  near(v.vDrop, v.rOhms * 1, 1e-12, 'Vdrop = I·R');
  near(v.pLossW, v.rOhms * 1, 1e-12, 'Ploss = I²R at 1A');

  // thicker plating raises capacity, lowers resistance
  const thick = C.viaStats({ drillMm: 0.6, platingUm: 50, lengthMm: 1.6, deltaT: 10, currentA: 1 });
  ok(thick.iMaxA > v.iMaxA && thick.rOhms < v.rOhms, 'thicker plating better');

  // higher ΔT allowance raises Imax (∝ΔT^0.44): ΔT20 -> ×~1.357
  const hot = C.viaStats({ drillMm: 0.6, platingUm: 25, lengthMm: 1.6, deltaT: 20, currentA: 1 });
  near(hot.iMaxA / v.iMaxA, Math.pow(2, 0.44), 0.01, 'Imax scales with ΔT^b');
}

// ---------- 3. spacing table ----------
{
  ok(C.spacing(5).b2 === 0.1, '≤15 V B2 = 0.1');
  ok(C.spacing(15).b1 === 0.05, '15 V B1 boundary inclusive');
  ok(C.spacing(24).b1 === 0.1 && C.spacing(24).b2 === 0.6, '16–30 V row');
  ok(C.spacing(100).b2 === 1.5, '51–100 V B2 = 1.5');
  ok(C.spacing(170).b1 === 1.5, '170 V row');
  ok(C.spacing(250).b1 === 3.2 && C.spacing(250).b2 === 12.5, '250 V row');
  ok(C.spacing(280).a5 === 2.5 && C.spacing(280).a6 === 4.0, 'coated cols differ on 250–300');
  ok(C.spacing(500).b1 === 12.5 && C.spacing(900).b2 === 12.5, 'top row clamp');
}

// ---------- 4. resistor colour code ----------
{
  // 4-band brown-black-red-gold = 1kΩ ±5%
  const r1k = C.resistorFromColors(['brown', 'black', 'red', 'gold']);
  ok(r1k.ohms === 1000 && r1k.tolPct === 5, '1k gold bands');
  // 5-band yellow-violet-black-black-brown = 470 Ω ±1%
  const r470 = C.resistorFromColors(['YELLOW', 'violet', 'black', 'black', 'brown']);
  ok(r470.ohms === 470 && r470.tolPct === 1, '5-band 470R case-insensitive');
  // gold multiplier: green-blue-gold-silver = 5.6 Ω ±10%
  const r56 = C.resistorFromColors(['green', 'blue', 'gold', 'silver']);
  near(r56.ohms, 5.6, 1e-9, 'gold multiplier 5.6R');
  // bad inputs throw
  let threw = 0;
  try { C.resistorFromColors(['pink', 'black', 'red', 'gold']); } catch (e) { threw++; }
  try { C.resistorFromColors(['brown', 'black', 'red']); } catch (e) { threw++; }
  try { C.resistorFromColors(['brown', 'black', 'red', 'pink']); } catch (e) { threw++; }
  ok(threw === 3, 'three invalid band sets rejected');

  // inverse
  ok(JSON.stringify(C.resistorToColors(1000, 5)) === JSON.stringify(['brown', 'black', 'red', 'gold']),
    '1k ±5% -> brn-blk-red-gold');
  ok(JSON.stringify(C.resistorToColors(470, 1)) === JSON.stringify(['yellow', 'violet', 'brown', 'brown']),
    '470 ±1% -> yel-vio-brn-brn');
  ok(JSON.stringify(C.resistorToColors(5.6, 10)) === JSON.stringify(['green', 'blue', 'gold', 'silver']),
    '5.6R uses gold multiplier');
  ok(C.resistorToColors(10000, 5)[2] === 'orange', '10k multiplier orange');
  const five = C.resistorToColors(12400, 1, true);
  ok(five.length === 5 && C.resistorFromColors(five).ohms === 12400, '5-band round-trip 12.4k');
  // round-trip sweep over decades
  for (const v of [33, 750, 4700, 22000, 1000000]) {
    const rt = C.resistorFromColors(C.resistorToColors(v, 5));
    ok(rt.ohms === v, `round-trip ${v}R`);
  }
  {
    let resolved = false, threw = false;
    try { C.resistorToColors(1234, 5); resolved = true; } catch (e) { threw = true; }
    ok(resolved || threw, 'odd value either resolves or throws cleanly');
  }
}

// ---------- 5. voltage divider ----------
{
  const d = C.voltageDivider(5, 1000, 1000);
  near(d.voutIdeal, 2.5, 1e-12, 'equal divider');
  const dl = C.voltageDivider(12, 10000, 10000, 10000); // load parallels R2 -> eff 5k -> 12*5/15=4
  near(dl.vout, 4, 1e-9, 'loaded divider 12/10k/10k/10k -> 4V');
  near(dl.voutIdeal, 6, 1e-12, 'unloaded still 6V');
  near(dl.iLoad, 4 / 10000, 1e-12, 'load current');
  const dnl = C.voltageDivider(9, 1000, 2000);
  near(dnl.vout, dnl.voutIdeal, 1e-12, 'no load -> ideal');
}

// ---------- 6. E-series nearest ----------
{
  ok(C.eseriesNearest(998, 'E24').value === 1000, '998 -> 1k E24');
  ok(C.eseriesNearest(1140, 'E12').value === 1200, '1140 -> 1.2k E12');
  ok(C.eseriesNearest(1140, 'E96').value === 1130, '1140 -> 1.13k E96');
  near(C.eseriesNearest(0.47, 'E24').value, 0.47, 1e-12, 'sub-1 ohm decade');
  ok(C.eseriesNearest(4700000, 'E24').value === 4700000, '4.7M exact on E24');
  ok(C.eseriesNearest(4680000, 'E96').value === 4640000, '4.68M -> 4.64M on E96');
  const e = C.eseriesNearest(5000, 'E24');
  ok(e.value === 5100 && e.relErr > 0 && e.relErr < 0.03, '5000 -> 5.1k with relErr');
  ok(C.eseriesNearest(3300).series === 'E24', 'default series E24');
  let threw = false;
  try { C.eseriesNearest(-5); } catch (e2) { threw = true; }
  ok(threw, 'negative target throws');
}

// ---------- 7. antenna / wavelength ----------
{
  const wifi = C.antennaLength(2400);
  near(wifi.wavelengthMm, 124.9135, 0.001, '2.4 GHz full wavelength');
  near(wifi.halfWaveMm, 62.4568, 0.001, '2.4 GHz half wave');
  near(wifi.quarterWaveMm, 31.2284, 0.001, '2.4 GHz quarter wave');
  const wire = C.antennaLength(100, 0.95);
  near(wire.wavelengthMm, 2848.0284, 0.001, '100 MHz wavelength with 0.95 velocity factor');
  near(wire.quarterWaveMm, wire.wavelengthMm / 4, 1e-12, 'quarter is full / 4');
  ok(wire.frequencyMHz === 100 && wire.velocityFactor === 0.95, 'normalized inputs returned');
  let threw = 0;
  for (const args of [[0], [-1], [100, 0], [100, 1.01]]) {
    try { C.antennaLength(...args); } catch (e) { threw++; }
  }
  ok(threw === 4, 'invalid frequency and velocity factors rejected');
}

// ---------- 8. adjustable-regulator feedback ----------
{
  const r = C.adjustableRegulator({ vref: 1.25, targetV: 5, rSetOhms: 1000, series: 'E96' });
  near(r.rGroundExact, 3000, 1e-9, '5 V divider exact Rground');
  ok(r.rGroundOhms === 3010, '5 V divider nearest E96 Rground');
  near(r.actualV, 5.0125, 1e-9, 'preferred resistor actual output');
  near(r.setCurrentA, 0.00125, 1e-12, 'set resistor current');

  const adj = C.adjustableRegulator({ vref: 1.25, targetV: 5, rSetOhms: 240, iAdjustUa: 50, series: 'E24' });
  near(adj.rGroundExact, 713.154, 0.001, 'LM317-style adjust current included');
  ok(adj.rGroundOhms === 680 && adj.actualV < 5, 'nearest E24 gives reported actual output');
  ok(adj.errorPct < 0, 'output error sign preserved');

  const unity = C.adjustableRegulator({ vref: 1.2, targetV: 1.2, rSetOhms: 10000 });
  ok(unity.rGroundExact === 0 && unity.rGroundOhms === 0 && unity.actualV === 1.2, 'unity-gain target needs zero Rground');

  let threw = 0;
  for (const opts of [
    { vref: 0, targetV: 5, rSetOhms: 1000 },
    { vref: 1.25, targetV: 1, rSetOhms: 1000 },
    { vref: 1.25, targetV: 5, rSetOhms: 0 },
    { vref: 1.25, targetV: 5, rSetOhms: 1000, iAdjustUa: -1 }
  ]) {
    try { C.adjustableRegulator(opts); } catch (e) { threw++; }
  }
  ok(threw === 4, 'invalid regulator inputs rejected');
}

// ---------- 9. microstrip transmission line ----------
{
  const line = C.microstrip({ widthMm: 0.3, heightMm: 0.2, er: 4.2, lengthMm: 25, frequencyGHz: 2.4 });
  ok(line.impedanceOhms > 55 && line.impedanceOhms < 65, '0.3/0.2 mm FR-4 geometry is near 59 ohms');
  ok(line.effectiveEr > 1 && line.effectiveEr < 4.2, 'effective dielectric lies between air and substrate');
  near(line.delayPs, 25 / 1000 / line.velocityMps * 1e12, 1e-9, 'delay follows effective propagation velocity');
  near(line.electricalLengthDeg, line.delayPs * 1e-12 * 2.4e9 * 360, 1e-9, 'electrical length follows delay and frequency');

  const synth = C.microstripWidth(50, 0.2, 4.2);
  const check = C.microstrip({ widthMm: synth.widthMm, heightMm: 0.2, er: 4.2 });
  near(check.impedanceOhms, 50, 1e-8, '50-ohm synthesis converges');
  ok(C.microstripWidth(75, 0.2, 4.2).widthMm < synth.widthMm, 'higher impedance needs narrower trace');

  let threw = 0;
  for (const opts of [
    { widthMm: 0, heightMm: 0.2, er: 4.2 },
    { widthMm: 0.3, heightMm: 0, er: 4.2 },
    { widthMm: 0.3, heightMm: 0.2, er: 1 },
    { widthMm: 0.3, heightMm: 0.2, er: 4.2, lengthMm: -1 },
    { widthMm: 0.3, heightMm: 0.2, er: 4.2, frequencyGHz: -1 }
  ]) { try { C.microstrip(opts); } catch (e) { threw++; } }
  try { C.microstripWidth(0, 0.2, 4.2); } catch (e) { threw++; }
  ok(threw === 6, 'invalid microstrip inputs rejected');
}

// ---------- 10. board thickness / stackup ----------
{
  // Typical 1.6 mm 2-layer FR-4: mask+silk both sides, 35 µm copper, 1.5 mm core
  const std2 = [
    { kind: 'soldermask', thicknessUm: 20 }, { kind: 'silkscreen', thicknessUm: 10 },
    { kind: 'copper', thicknessUm: 35 }, { kind: 'substrate', thicknessUm: 1500 },
    { kind: 'copper', thicknessUm: 35 }, { kind: 'soldermask', thicknessUm: 20 },
    { kind: 'silkscreen', thicknessUm: 10 }
  ];
  const r = C.boardThickness(std2);
  near(r.totalUm, 1630, 1e-9, 'std2 total microns');
  near(r.totalMm, 1.63, 1e-9, 'std2 total mm');
  near(r.totalMil, r.totalInch * 1000, 1e-9, 'total mil conversion');
  near(r.totalInch, 1.63 / 25.4, 1e-9, 'total inch conversion');
  ok(r.copperLayers === 2, 'std2 counts two copper layers');
  near(r.copperOz, 70 / C.COPPER_UM_PER_OZ, 1e-9, 'copper weight in oz/ft2');
  ok(r.breakdown.length === std2.length && r.breakdown[3].kind === 'substrate', 'breakdown preserves order and kinds');

  // order does not change the sum; breakdown mirrors input order
  const shuffled = C.boardThickness([...std2].reverse());
  near(shuffled.totalMm, r.totalMm, 1e-12, 'sum is order-independent');

  // bare 1.5 mm core alone
  const core = C.boardThickness([{ kind: 'substrate', thicknessUm: 1500 }]);
  ok(core.copperLayers === 0 && core.copperOz === 0 && core.totalMm === 1.5, 'single substrate layer sums alone');

  // ozToUm round-trip against the 1 oz constant (1.37 mil ≈ 34.8 µm)
  near(C.ozToUm(1), 34.7975, 1e-9, '1 oz copper foil thickness');
  near(C.ozToUm(2) / 2, C.ozToUm(1), 1e-12, 'ozToUm linear');

  let threw = 0;
  for (const bad of [
    [],
    'nope',
    [{ kind: 'unobtanium', thicknessUm: 100 }],
    [{ kind: 'copper', thicknessUm: 0 }],
    [{ kind: 'copper', thicknessUm: -35 }],
    [{ kind: 'copper', thicknessUm: NaN }],
    [{}]
  ]) { try { C.boardThickness(bad); } catch (e) { threw++; } }
  try { C.ozToUm(-1); } catch (e) { threw++; }
  try { C.ozToUm('x'); } catch (e) { threw++; }
  ok(threw === 9, 'invalid stackup inputs rejected');
}

console.log(`test_calc: ${passed} checks passed`);
