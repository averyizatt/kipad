/* KipadCalc — pure PCB-calculator math for the PCB Calculator dialog.
 * UMD: works in node (tests) and browser (app.part3 showCalc).
 *
 * All formulas follow IPC-2221A / IEC 60063 as used by KiCad's PCB Calculator:
 *   trackWidth()      IPC-2221 trace width        (k = 0.048 ext / 0.024 int)
 *   viaStats()        via annulus current + IR drop
 *   spacing()         IPC-2221A Table 6-1 electrical clearances
 *   resistorFromColors() / resistorToColors()  4- and 5-band colour codes
 *   voltageDivider()  loaded / unloaded divider
 *   eseriesNearest()  nearest E12/E24/E96 preferred value
 *   antennaLength()   RF wavelength and common resonant element lengths
 *   adjustableRegulator() divider sizing for LM317-style regulators
 *   microstrip() / microstripWidth()  transmission-line analysis/synthesis
 *   boardThickness()  layer-stackup board thickness summary (+ ozToUm)
 *
 * Pure functions only: numbers in, plain objects out. No DOM, no globals.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KipadCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIL_PER_MM = 39.37007874;
  const MIL2_PER_MM2 = MIL_PER_MM * MIL_PER_MM; // 1550.0031
  const RHO_CU = 1.72e-8; // ohm·m, annealed copper @ 20 °C
  const C0 = 299792458; // m/s, speed of light in vacuum
  const COPPER_UM_PER_OZ = 34.7975; // µm of foil per oz/ft² (1.37 mil)

  // ---------- IPC-2221 trace width ----------
  // A[mil²] = (I / (k · ΔT^b))^(1/c); width = A / (oz · 1.378 mil)
  // k = 0.048 external, 0.024 internal; b = 0.44; c = 0.725
  function trackWidth(currentA, deltaT, copperOz, internal) {
    const k = internal ? 0.024 : 0.048, b = 0.44, c = 0.725;
    if (!(currentA > 0) || !(deltaT > 0) || !(copperOz > 0)) {
      return { areaMil2: 0, widthMil: 0, widthMm: 0 };
    }
    const areaMil2 = Math.pow(currentA / (k * Math.pow(deltaT, b)), 1 / c);
    const widthMil = areaMil2 / (copperOz * 1.378);
    return { areaMil2, widthMil, widthMm: widthMil / MIL_PER_MM };
  }

  // ---------- Via current / IR drop ----------
  // Barrel = annulus between drill Ø and plated Ø; treated as an internal
  // conductor (k = 0.024) for ampacity, plus DC resistance / drop / loss.
  function viaStats(o) {
    const drill = o.drillMm, tU = o.platingUm != null ? o.platingUm : 25;
    const len = o.lengthMm != null ? o.lengthMm : 1.6;
    const dT = o.deltaT != null ? o.deltaT : 10;
    const cur = o.currentA != null ? o.currentA : 0;
    const dOut = drill + 2 * (tU / 1000);
    const annulusMm2 = Math.PI / 4 * (dOut * dOut - drill * drill);
    const areaMil2 = annulusMm2 * MIL2_PER_MM2;
    const k = 0.024, b = 0.44, c = 0.725;
    const iMaxA = Math.pow(areaMil2, c) * k * Math.pow(dT, b);
    const rOhms = RHO_CU * (len / 1000) / (annulusMm2 * 1e-6);
    return {
      annulusMm2, iMaxA, rOhms,
      vDrop: rOhms * cur,
      pLossW: rOhms * cur * cur
    };
  }

  // ---------- IPC-2221A Table 6-1 electrical spacing (mm) ----------
  // cols: voltage ceiling, B1 internal, B2 ext uncoated sea level, A5, A6, A7
  const SPACING_TABLE = [
    [15, 0.05, 0.1, 0.1, 0.1, 0.1],
    [30, 0.1, 0.6, 0.3, 0.3, 0.3],
    [50, 0.8, 1.5, 0.8, 0.8, 0.8],
    [100, 0.8, 1.5, 0.8, 0.8, 0.8],
    [170, 1.5, 3.2, 2.5, 2.5, 2.5],
    [250, 3.2, 12.5, 2.5, 4.0, 4.0],
    [300, 12.5, 12.5, 2.5, 4.0, 4.0],
    [Infinity, 12.5, 12.5, 12.5, 12.5, 12.5]
  ];
  function spacing(voltageV) {
    const v = Math.max(0, voltageV || 0);
    const row = SPACING_TABLE.find(r => v <= r[0]) || SPACING_TABLE[SPACING_TABLE.length - 1];
    return { b1: row[1], b2: row[2], a5: row[3], a6: row[4], a7: row[5] };
  }

  // ---------- Resistor colour code ----------
  const DIGIT = {
    black: 0, brown: 1, red: 2, orange: 3, yellow: 4,
    green: 5, blue: 6, violet: 7, grey: 8, white: 9
  };
  const MULTIPLIER = {
    black: 1, brown: 10, red: 100, orange: 1e3, yellow: 1e4,
    green: 1e5, blue: 1e6, violet: 1e7, grey: 1e8, white: 1e9,
    gold: 0.1, silver: 0.01
  };
  const TOLERANCE = {
    brown: 1, red: 2, orange: 0.05, yellow: 0.02, green: 0.5,
    blue: 0.25, violet: 0.1, grey: 0.05, gold: 5, silver: 10, none: 20
  };
  // Reverse maps (largest-first so lookups prefer common colours)
  const DIGIT_COLOR = invert(DIGIT);
  const MULT_COLOR = invert(MULTIPLIER);
  const TOL_COLORS = {}; // pct -> first colour name
  Object.keys(TOLERANCE).forEach(c => {
    const pct = TOLERANCE[c];
    if (TOL_COLORS[pct] == null) TOL_COLORS[pct] = c;
  });

  function invert(obj) {
    const out = {};
    for (const k in obj) out[obj[k]] = k;
    return out;
  }

  // bands: ['brown','black','red','gold'] (4) or [...,'brown'] (5 sig digits)
  function resistorFromColors(bands) {
    if (!Array.isArray(bands) || (bands.length !== 4 && bands.length !== 5)) {
      throw new Error('need 4 or 5 bands');
    }
    const names = bands.map(b => String(b).toLowerCase().trim());
    let sig = 0;
    for (let i = 0; i < names.length - 2; i++) {
      if (!(names[i] in DIGIT)) throw new Error('bad digit band: ' + names[i]);
      sig = sig * 10 + DIGIT[names[i]];
    }
    const multName = names[names.length - 2];
    const tolName = names[names.length - 1];
    if (!(multName in MULTIPLIER)) throw new Error('bad multiplier band: ' + multName);
    if (!(tolName in TOLERANCE)) throw new Error('bad tolerance band: ' + tolName);
    return { ohms: sig * MULTIPLIER[multName], tolPct: TOLERANCE[tolName] };
  }

  // Inverse: value (+ tolerance %) -> band names. Uses 4-band (2 significant
  // digits) unless five=true; falls back to gold/silver multipliers below 10 Ω.
  function resistorToColors(ohms, tolPct, five) {
    if (!(ohms > 0) || !isFinite(ohms)) throw new Error('bad resistance');
    const nSig = five ? 3 : 2;
    let best = null;
    // try decade multipliers 1,10,...,1e9 then 0.1, 0.01
    const mults = [];
    for (let e = 0; e <= 9; e++) mults.push(Math.pow(10, e));
    mults.push(0.1, 0.01);
    for (const m of mults) {
      const scaled = ohms / m;
      const digits = Math.round(scaled);
      if (digits < Math.pow(10, nSig - 1) || digits >= Math.pow(10, nSig)) continue;
      if (Math.abs(scaled - digits) / digits > 0.001) continue; // not representable cleanly
      best = { digits, m };
      break;
    }
    if (!best) throw new Error('not representable in ' + nSig + '-band code');
    const ds = String(best.digits).split('').map(Number);
    const bands = ds.map(d => DIGIT_COLOR[d]);
    bands.push(MULT_COLOR[best.m]);
    bands.push(TOL_COLORS[tolPct] || 'none');
    return bands;
  }

  // ---------- Voltage divider ----------
  function voltageDivider(vin, r1, r2, rl) {
    const voutIdeal = vin * r2 / (r1 + r2);
    let vout = voutIdeal, iLoad = 0;
    if (rl != null && rl > 0 && r2 > 0) {
      const rEff = r2 * rl / (r2 + rl);
      vout = vin * rEff / (r1 + rEff);
      iLoad = vout / rl;
    }
    return { voutIdeal, vout, iLoad };
  }

  // ---------- Preferred values (IEC 60063) ----------
  const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
               3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
  const E96 = [
    1.00, 1.02, 1.05, 1.07, 1.10, 1.13, 1.15, 1.18, 1.21, 1.24,
    1.27, 1.30, 1.33, 1.37, 1.40, 1.43, 1.47, 1.50, 1.54, 1.58,
    1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.00,
    1.05, 2.10, 2.15, 2.21, 2.26, 2.32, 2.37, 2.43, 2.49, 2.55,
    2.61, 2.67, 2.74, 2.80, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24,
    3.32, 3.40, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12,
    4.22, 4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23,
    5.36, 5.49, 5.62, 5.76, 5.90, 6.04, 6.19, 6.34, 6.49, 6.65,
    6.81, 6.98, 7.15, 7.32, 7.50, 7.68, 7.87, 8.06, 8.25, 8.45,
    8.66, 8.87, 9.09, 9.31, 9.53, 9.76];
  const SERIES = { E12, E24, E96 };

  function eseriesNearest(target, series) {
    const base = SERIES[series] || SERIES.E24;
    if (!(target > 0) || !isFinite(target)) throw new Error('bad target');
    const lo = Math.floor(Math.log10(target));
    let best = null;
    for (let e = lo - 1; e <= lo + 1; e++) {
      for (const m of base) {
        const v = m * Math.pow(10, e);
        const err = Math.abs(v - target) / target;
        if (!best || err < best.err - 1e-12) best = { value: v, err };
      }
    }
    return { value: best.value, series: SERIES[series] ? series : 'E24', relErr: best.err };
  }

  // ---------- RF antenna / wavelength ----------
  // velocityFactor is relative propagation speed (1 in free space, commonly
  // ~0.95 for a wire element). Results are physical lengths in millimetres.
  function antennaLength(frequencyMHz, velocityFactor) {
    const f = Number(frequencyMHz);
    const vf = velocityFactor == null ? 1 : Number(velocityFactor);
    if (!(f > 0) || !isFinite(f)) throw new Error('bad frequency');
    if (!(vf > 0) || vf > 1 || !isFinite(vf)) throw new Error('bad velocity factor');
    const wavelengthMm = C0 / (f * 1e6) * vf * 1000;
    return {
      wavelengthMm,
      halfWaveMm: wavelengthMm / 2,
      quarterWaveMm: wavelengthMm / 4,
      frequencyMHz: f,
      velocityFactor: vf
    };
  }

  // ---------- Three-terminal adjustable regulator ----------
  // Rset runs from output to adjust; Rground runs adjust to ground:
  // Vout = Vref * (1 + Rground/Rset) + Iadj * Rground.
  function adjustableRegulator(o) {
    o = o || {};
    const vref = Number(o.vref);
    const targetV = Number(o.targetV);
    const rSetOhms = Number(o.rSetOhms);
    const iAdjustUa = o.iAdjustUa == null ? 0 : Number(o.iAdjustUa);
    const series = SERIES[o.series] ? o.series : 'E96';
    if (!(vref > 0) || !isFinite(vref)) throw new Error('bad reference voltage');
    if (!(targetV >= vref) || !isFinite(targetV)) throw new Error('target must be at least Vref');
    if (!(rSetOhms > 0) || !isFinite(rSetOhms)) throw new Error('bad set resistance');
    if (!(iAdjustUa >= 0) || !isFinite(iAdjustUa)) throw new Error('bad adjust current');
    const iAdjustA = iAdjustUa * 1e-6;
    const denominator = vref / rSetOhms + iAdjustA;
    const rGroundExact = (targetV - vref) / denominator;
    const preferred = rGroundExact > 0 ? eseriesNearest(rGroundExact, series) : { value: 0, series, relErr: 0 };
    const rGroundOhms = preferred.value;
    const actualV = vref * (1 + rGroundOhms / rSetOhms) + iAdjustA * rGroundOhms;
    return {
      rGroundExact, rGroundOhms, actualV,
      errorPct: targetV ? (actualV - targetV) / targetV * 100 : 0,
      setCurrentA: vref / rSetOhms,
      vref, targetV, rSetOhms, iAdjustUa, series
    };
  }

  // ---------- Microstrip transmission line ----------
  // Closed-form Hammerstad-style quasi-static approximation for an
  // infinitesimally thin surface trace. It is a useful first-pass design
  // value; solder mask, copper thickness and dispersion require a field
  // solver for production-controlled impedance.
  function microstrip(o) {
    o = o || {};
    const widthMm = Number(o.widthMm);
    const heightMm = Number(o.heightMm);
    const er = Number(o.er);
    const lengthMm = o.lengthMm == null ? 0 : Number(o.lengthMm);
    const frequencyGHz = o.frequencyGHz == null ? 0 : Number(o.frequencyGHz);
    if (!(widthMm > 0) || !isFinite(widthMm)) throw new Error('bad trace width');
    if (!(heightMm > 0) || !isFinite(heightMm)) throw new Error('bad dielectric height');
    if (!(er > 1) || !isFinite(er)) throw new Error('dielectric constant must exceed 1');
    if (!(lengthMm >= 0) || !isFinite(lengthMm)) throw new Error('bad line length');
    if (!(frequencyGHz >= 0) || !isFinite(frequencyGHz)) throw new Error('bad frequency');
    const u = widthMm / heightMm;
    const correction = u < 1 ? 0.04 * Math.pow(1 - u, 2) : 0;
    const effectiveEr = (er + 1) / 2 + (er - 1) / 2 * (1 / Math.sqrt(1 + 12 / u) + correction);
    const impedanceOhms = u <= 1
      ? 60 / Math.sqrt(effectiveEr) * Math.log(8 / u + u / 4)
      : 120 * Math.PI / (Math.sqrt(effectiveEr) * (u + 1.393 + 0.667 * Math.log(u + 1.444)));
    const velocityMps = C0 / Math.sqrt(effectiveEr);
    const delayPs = lengthMm / 1000 / velocityMps * 1e12;
    const electricalLengthDeg = frequencyGHz > 0 ? delayPs * 1e-12 * frequencyGHz * 1e9 * 360 : 0;
    return { impedanceOhms, effectiveEr, velocityMps, delayPs, electricalLengthDeg, widthMm, heightMm, er, lengthMm, frequencyGHz };
  }

  function microstripWidth(targetOhms, heightMm, er) {
    const target = Number(targetOhms), h = Number(heightMm), dielectric = Number(er);
    if (!(target > 0) || !isFinite(target)) throw new Error('bad target impedance');
    if (!(h > 0) || !isFinite(h)) throw new Error('bad dielectric height');
    if (!(dielectric > 1) || !isFinite(dielectric)) throw new Error('dielectric constant must exceed 1');
    let lo = h * 1e-4, hi = h * 1e4;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (microstrip({ widthMm: mid, heightMm: h, er: dielectric }).impedanceOhms > target) lo = mid;
      else hi = mid;
    }
    return { widthMm: (lo + hi) / 2, targetOhms: target, heightMm: h, er: dielectric };
  }

  // ---------- Board thickness / stackup ----------
  // Sums a fabrication layer stack into an overall finished-board thickness.
  // layers: [{kind: 'copper'|'substrate'|'prepreg'|'soldermask'|'silkscreen'|'other',
  //           thicknessUm: >0}]. Order is irrelevant to the sum but preserved
  // in the returned breakdown so the UI can show contributions.
  const STACK_KINDS = ['copper', 'substrate', 'prepreg', 'soldermask', 'silkscreen', 'other'];
  function ozToUm(oz) {
    const v = Number(oz);
    if (!(v >= 0) || !isFinite(v)) throw new Error('bad copper weight');
    return v * COPPER_UM_PER_OZ;
  }
  function boardThickness(layers) {
    if (!Array.isArray(layers) || layers.length === 0) throw new Error('empty stack');
    let totalUm = 0, copperUm = 0;
    const copperLayers = [];
    const breakdown = layers.map((raw, i) => {
      const kind = String((raw && raw.kind) || '').toLowerCase();
      const um = Number(raw && raw.thicknessUm);
      if (STACK_KINDS.indexOf(kind) < 0) throw new Error('unknown layer kind: ' + kind);
      if (!(um > 0) || !isFinite(um)) throw new Error('bad layer thickness');
      totalUm += um;
      if (kind === 'copper') { copperUm += um; copperLayers.push(i); }
      return { kind, thicknessUm: um };
    });
    return {
      breakdown,
      totalUm,
      totalMm: totalUm / 1000,
      totalMil: totalUm / 1000 * MIL_PER_MM,
      totalInch: totalUm / 1000 / 25.4,
      copperLayers: copperLayers.length,
      copperOz: copperUm / COPPER_UM_PER_OZ
    };
  }

  return {
    trackWidth, viaStats, spacing,
    resistorFromColors, resistorToColors,
    voltageDivider, eseriesNearest, antennaLength, adjustableRegulator,
    microstrip, microstripWidth,
    boardThickness, ozToUm,
    DIGIT, MULTIPLIER, TOLERANCE, TOL_COLORS, SERIES, COPPER_UM_PER_OZ
  };
});
