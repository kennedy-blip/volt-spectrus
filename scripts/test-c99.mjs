/**
 * Compiles and numerically validates the ANSI C99 Goertzel DSP kernel.
 *
 *   node scripts/test-c99.mjs
 *
 * Verifies the interpolated Goertzel sub-millihertz estimator against five
 * deterministic synthetic power sources (clean 60 Hz, modified-sine 59.4 Hz,
 * overloaded generator 55.2 Hz, failing laptop SMPS, European 50 Hz).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'c-dsp/electromagnetic_harmonic.c');

const EXPECTED = [
  { name: 'clean-utility-60hz', freq: 60.002, thd: 1.8 },
  { name: 'modified-sine-inverter-59.4hz', freq: 59.4, thd: 28.2 },
  { name: 'overloaded-generator-55.2hz', freq: 55.2, thd: 14.6 },
  { name: 'failing-laptop-smps', freq: 60.0, thd: 9.3 },
  { name: 'european-50hz', freq: 50.005, thd: 2.0 },
];

function pickCompiler() {
  for (const candidate of ['gcc', 'cc', 'clang']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

if (!existsSync(source)) {
  console.error(`[test-c99] missing source: ${source}`);
  process.exit(1);
}

const cc = pickCompiler();
if (!cc) {
  console.error('[test-c99] no C compiler found (gcc/cc/clang)');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'vs-c99-'));
const bin = join(dir, 'vs_selftest');

try {
  execFileSync(
    cc,
    ['-std=c99', '-O2', '-DVS_ENABLE_MAIN', source, '-lm', '-o', bin],
    { stdio: 'inherit' },
  );
  const stdout = execFileSync(bin, [], { encoding: 'utf8' });
  const reports = JSON.parse(stdout);

  let failures = 0;
  console.log('\n[test-c99] scenario results:');
  reports.forEach((rep, i) => {
    const exp = EXPECTED[i];
    const freqErr = Math.abs(rep.freqHz - exp.freq);
    const thdErr = Math.abs(rep.thdPercent - exp.thd);
    const ok = freqErr <= 0.01 && thdErr <= 1.0;
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${rep.scenario.padEnd(38)} ` +
        `f=${rep.freqHz.toFixed(4)} Hz (err ${(freqErr * 1000).toFixed(2)} mHz)  ` +
        `THD=${rep.thdPercent.toFixed(2)}% (err ${thdErr.toFixed(2)} pp)  ` +
        `purity=${rep.purityScore.toFixed(1)}`,
    );
  });

  if (failures) {
    console.error(`\n[test-c99] ${failures} scenario(s) out of tolerance`);
    process.exit(1);
  }
  console.log('\n[test-c99] OK — interpolated Goertzel kernel verified');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
