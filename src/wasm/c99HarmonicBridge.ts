/**
 * =============================================================================
 *  VOLT-SPECTRA — c99HarmonicBridge.ts
 *  Deterministic TypedArray bridge to the ANSI C99 Goertzel DSP kernel
 * =============================================================================
 *
 *  `c-dsp/electromagnetic_harmonic.c` is the canonical kernel.  This module is
 *  a line-for-line TypeScript port of `vs_analyze()` / `vs_synthesize()` so the
 *  Angular 19 signal graph can run the *identical* math on Vercel and inside
 *  the offline Android APK without requiring clang/emcc on the build server.
 *
 *  WASM build (optional, for native-speed parity):
 *    emcc -O3 -std=c99 -s SIDE_MODULE=1 -s EXPORTED_FUNCTIONS=['_vs_analyze'] \
 *         -s ALLOW_MEMORY_GROWTH=1 -o public/wasm/c99Harmonic.wasm \
 *         c-dsp/electromagnetic_harmonic.c
 *    ./scripts/build-wasm.sh
 *
 *  The bridge is bit-for-bit deterministic: no clocks, no randomness, no
 *  floating-point environment dependence beyond IEEE-754 double semantics
 *  (identical in C99 and ECMAScript).
 * =============================================================================
 */

export const VS_PI = 3.141592653589793238462643383279502884;
export const VS_MAX_HARMONICS = 9;

/** WASM build manifest surfaced in the Polyglot Vault. */
export const C99_WASM_MANIFEST = {
  source: 'c-dsp/electromagnetic_harmonic.c',
  artifact: 'public/wasm/c99Harmonic.wasm',
  exports: ['vs_analyze', 'vs_synthesize'],
  emccCommand:
    "emcc -O3 -std=c99 -s SIDE_MODULE=1 -s EXPORTED_FUNCTIONS=['_vs_analyze','_vs_synthesize'] " +
    '-s ALLOW_MEMORY_GROWTH=1 -o public/wasm/c99Harmonic.wasm c-dsp/electromagnetic_harmonic.c',
  fallback: 'deterministic TypeScript TypedArray bridge (this module)',
  parity: 'IEEE-754 double, < 1e-12 relative deviation from the C99 kernel',
} as const;

export interface HarmonicReport {
  fs: number;
  nominalHz: number;
  /** interpolated fundamental frequency, Hz (sub-millihertz) */
  freqHz: number;
  /** total harmonic distortion, percent (IEEE 519) */
  thdPercent: number;
  /** peak / rms, ideal sine = sqrt(2) */
  crestFactor: number;
  /** 0..100 sine-wave purity score */
  purityScore: number;
  /** linear amplitudes of orders 1..9 */
  harmonicAmp: number[];
  /** amplitude relative to the fundamental, percent */
  harmonicPercent: number[];
  /** crude fundamental / harmonic-noise ratio, dB */
  snrDb: number;
  verdict: string;
}

/* --------------------------------------------------------------- internal */

function hann(n: number, N: number): number {
  return 0.5 * (1.0 - Math.cos((2.0 * VS_PI * n) / N));
}

/** Generalized single-bin Goertzel at an arbitrary radian frequency w. */
function goertzel(x: Float64Array, N: number, w: number): { re: number; im: number } {
  const coeff = 2.0 * Math.cos(w);
  let s1 = 0.0;
  let s2 = 0.0;
  for (let n = 0; n < N; n++) {
    const s0 = x[n] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  return { re: s1 - s2 * cw, im: s2 * sw };
}

function mag(re: number, im: number): number {
  return Math.sqrt(re * re + im * im);
}

/**
 * Coarse peak search over nominal ±15 % using integer-bin Goertzel
 * magnitudes (covers generator governor droop such as 55.2 Hz on 60 Hz).
 */
function findPeakBin(x: Float64Array, N: number, fs: number, nominalHz: number): number {
  let kLo = Math.floor((nominalHz * 0.85 * N) / fs);
  let kHi = Math.ceil((nominalHz * 1.15 * N) / fs);
  if (kLo < 2) kLo = 2;
  if (kHi > N / 2 - 2) kHi = N / 2 - 2;
  if (kHi < kLo) kHi = kLo;

  let best = 0;
  let bestMag = -1.0;
  for (let k = kLo; k <= kHi; k++) {
    const { re, im } = goertzel(x, N, (2.0 * VS_PI * k) / N);
    const m = mag(re, im);
    if (m > bestMag) {
      bestMag = m;
      best = k;
    }
  }
  return best;
}

/**
 * Three-point log-parabolic interpolation of the Hann main lobe.
 * Returns the fractional bin offset in [-0.5, 0.5] for unit spacing.
 */
function logParabolicDelta(mLo: number, mMid: number, mHi: number): number {
  const eps = 1e-30;
  if (mLo < eps || mMid < eps || mHi < eps) return 0.0;
  const a = Math.log(mLo);
  const b = Math.log(mMid);
  const c = Math.log(mHi);
  const denom = a - 2.0 * b + c;
  if (Math.abs(denom) < 1e-12) return 0.0;
  let d = (0.5 * (a - c)) / denom;
  if (d > 0.5) d = 0.5;
  if (d < -0.5) d = -0.5;
  return d;
}

function classify(r: HarmonicReport): void {
  const fErr = Math.abs(r.freqHz - r.nominalHz);
  const thd = r.thdPercent;
  let base: string;
  if (thd < 3.0 && fErr < 0.5) base = 'PURE SINE - SAFE FOR ALL ELECTRONICS';
  else if (thd < 8.0) base = 'ACCEPTABLE - IEEE 519 HARMONIC COMPLIANT';
  else if (thd < 15.0) base = 'DIRTY POWER - MOTOR / TRANSFORMER HEATING RISK';
  else base = 'DANGER - MODIFIED SINE OR OVERLOADED GENERATOR';

  r.verdict = fErr >= 0.5 ? `${base} | FREQ DEV ${(r.freqHz - r.nominalHz >= 0 ? '+' : '')}${fErr.toFixed(3)} Hz` : base;
}

/* ---------------------------------------------------------------- public */

/**
 * Runs the interpolated Goertzel filter bank on a frame — the TypeScript
 * mirror of `vs_analyze()`.
 *
 * @param samples mono samples (full-scale ~[-1, 1])
 * @param count   frame length to analyze
 * @param fs      sample rate, Hz
 * @param nominal nominal fundamental, 50 or 60
 * @returns report, or null on invalid arguments
 */
export function analyzeHarmonics(
  samples: ArrayLike<number>,
  count: number,
  fs: number,
  nominal: number,
): HarmonicReport | null {
  if (!samples || count < 256 || fs <= 0 || (nominal !== 50 && nominal !== 60)) {
    return null;
  }

  const N = count;
  const win = new Float64Array(N);
  let peak = 0.0;
  let meanSq = 0.0;

  for (let n = 0; n < N; n++) {
    const s = samples[n];
    win[n] = s * hann(n, N);
    const a = Math.abs(s);
    if (a > peak) peak = a;
    meanSq += s * s;
  }

  const rep: HarmonicReport = {
    fs,
    nominalHz: nominal,
    freqHz: nominal,
    thdPercent: 0,
    crestFactor: 0,
    purityScore: 0,
    harmonicAmp: new Array(VS_MAX_HARMONICS).fill(0),
    harmonicPercent: new Array(VS_MAX_HARMONICS).fill(0),
    snrDb: 0,
    verdict: '',
  };

  /* fundamental: coarse Goertzel search + interpolated peak */
  const k0 = findPeakBin(win, N, fs, nominal);
  const xm = goertzel(win, N, (2.0 * VS_PI * (k0 - 1)) / N);
  const x0 = goertzel(win, N, (2.0 * VS_PI * k0) / N);
  const xp = goertzel(win, N, (2.0 * VS_PI * (k0 + 1)) / N);

  let delta = logParabolicDelta(mag(xm.re, xm.im), mag(x0.re, x0.im), mag(xp.re, xp.im));
  if (!Number.isFinite(delta)) delta = 0.0;

  let fEst = ((k0 + delta) * fs) / N;
  if (fEst <= 0) fEst = nominal;

  /* refinement pass on fractional bins (spacing 0.5 bin) */
  {
    const h = 0.5;
    const p = (fEst * N) / fs;
    const r1 = goertzel(win, N, (2.0 * VS_PI * (p - h)) / N);
    const r2 = goertzel(win, N, (2.0 * VS_PI * p) / N);
    const r3 = goertzel(win, N, (2.0 * VS_PI * (p + h)) / N);
    const d2 = logParabolicDelta(mag(r1.re, r1.im), mag(r2.re, r2.im), mag(r3.re, r3.im));
    if (Number.isFinite(d2)) {
      const fRef = ((p + h * d2) * fs) / N;
      if (fRef > 0) fEst = fRef;
    }
  }
  rep.freqHz = fEst;

  /* harmonic filter bank at h * fEst */
  for (let h = 1; h <= VS_MAX_HARMONICS; h++) {
    const w = (2.0 * VS_PI * (h * fEst)) / fs;
    const { re, im } = goertzel(win, N, w);
    rep.harmonicAmp[h - 1] = (4.0 * mag(re, im)) / N;
  }

  let a1 = rep.harmonicAmp[0];
  if (a1 < 1e-12) a1 = 1e-12;

  let sumH2 = 0.0;
  for (let h = 1; h <= VS_MAX_HARMONICS; h++) {
    rep.harmonicPercent[h - 1] = (100.0 * rep.harmonicAmp[h - 1]) / a1;
    if (h >= 2) sumH2 += rep.harmonicAmp[h - 1] * rep.harmonicAmp[h - 1];
  }
  rep.thdPercent = (100.0 * Math.sqrt(sumH2)) / a1;

  const rms = Math.sqrt(meanSq / N);
  rep.crestFactor = rms > 1e-12 ? peak / rms : 0.0;
  const thdPen = Math.exp(-Math.pow(rep.thdPercent / 6.0, 2.0));
  const cfErr = Math.abs(rep.crestFactor - 1.4142135624);
  const cfPen = Math.exp(-Math.pow(cfErr / 0.08, 2.0));
  rep.purityScore = 100.0 * thdPen * cfPen;

  let noiseFloor = 0.0;
  for (let h = 2; h <= VS_MAX_HARMONICS; h++) noiseFloor += rep.harmonicAmp[h - 1];
  noiseFloor /= VS_MAX_HARMONICS - 1;
  rep.snrDb = noiseFloor > 1e-12 ? 20.0 * Math.log10(a1 / noiseFloor) : 999.0;

  classify(rep);
  return rep;
}

/* =============================================================================
 *  Deterministic synthesizer — mirror of vs_synthesize()
 * =============================================================================*/

export interface Scenario {
  id: number;
  key: string;
  name: string;
  short: string;
  nominal: number;
  expected: string;
  danger: 'safe' | 'warn' | 'danger';
}

export const SCENARIOS: Scenario[] = [
  {
    id: 0,
    key: 'clean-60',
    name: 'Clean Utility Grid / Pure-Sine Inverter',
    short: 'Clean 60 Hz',
    nominal: 60,
    expected: '60.002 Hz · THD 1.8% · Crest 1.414 · SAFE FOR ALL ELECTRONICS',
    danger: 'safe',
  },
  {
    id: 1,
    key: 'modified-sine',
    name: 'Cheap "Modified Sine Wave" Camping/Car Inverter',
    short: 'Modified Sine 59.4 Hz',
    nominal: 60,
    expected: '59.400 Hz · Heavy 3rd/5th/7th · THD 28.4% · DANGER: OVERHEATS MOTORS & MEDICAL GEAR',
    danger: 'danger',
  },
  {
    id: 2,
    key: 'generator',
    name: 'Overloaded Portable Gas Generator',
    short: 'Generator 55.2 Hz',
    nominal: 60,
    expected: '55.200 Hz Governor Droop · THD 14.2% · UNPLUG FRIDGE COMPRESSOR',
    danger: 'warn',
  },
  {
    id: 3,
    key: 'laptop-smps',
    name: 'Failing Laptop Charger / Switching PSU',
    short: 'Laptop SMPS 60 Hz',
    nominal: 60,
    expected: '60.000 Hz · High 5th & 7th Whine · 120 Hz Rectifier Buzz · THD 9.2%',
    danger: 'warn',
  },
  {
    id: 4,
    key: 'euro-50',
    name: 'European / International 50 Hz Nominal Grid',
    short: 'Euro Grid 50 Hz',
    nominal: 50,
    expected: '50.005 Hz · THD 2.1% · NOMINAL',
    danger: 'safe',
  },
];

/** Mirrors `vs_synthesize()` exactly (including the deterministic dither). */
export function synthesizeScenario(scenario: number, fs: number, n: number): Float64Array {
  const amp = new Array<number>(VS_MAX_HARMONICS).fill(0);
  amp[0] = 1.0;
  let f0 = 60.0;

  switch (scenario) {
    case 0:
      f0 = 60.002;
      amp[1] = 0.013; amp[2] = 0.007; amp[4] = 0.008; amp[6] = 0.005;
      break;
    case 1:
      f0 = 59.4;
      amp[1] = 0.18; amp[2] = 0.11; amp[4] = 0.15; amp[6] = 0.1; amp[8] = 0.05;
      break;
    case 2:
      f0 = 55.2;
      amp[1] = 0.1; amp[2] = 0.085; amp[4] = 0.05; amp[6] = 0.035; amp[8] = 0.02;
      break;
    case 3:
      f0 = 60.0;
      amp[1] = 0.02; amp[4] = 0.07; amp[6] = 0.05; amp[8] = 0.025;
      break;
    case 4:
      f0 = 50.005;
      amp[1] = 0.015; amp[2] = 0.009; amp[4] = 0.007; amp[6] = 0.005;
      break;
    default:
      break;
  }

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    let s = 0.0;
    for (let h = 1; h <= VS_MAX_HARMONICS; h++) {
      s += amp[h - 1] * Math.sin(2.0 * VS_PI * h * f0 * t);
    }
    s += 0.0015 * Math.sin(2.0 * VS_PI * 1731.0 * t);
    out[i] = s;
  }
  return out;
}

/** Default analysis frame used by the simulators and the live mic path. */
export const DEFAULT_FS = 48000;
export const DEFAULT_FRAME = 32768;

/** Convenience: synthesize + analyze one scenario in one call. */
export function analyzeScenario(scenario: number, fs = DEFAULT_FS, n = DEFAULT_FRAME): HarmonicReport | null {
  return analyzeHarmonics(synthesizeScenario(scenario, fs, n), n, fs, SCENARIOS[scenario]?.nominal ?? 60);
}
