/**
 * Numerical parity test: C99 kernel vs the deterministic TypeScript bridge.
 *
 *   node scripts/test-bridge-parity.mjs
 *
 * Compiles + runs c-dsp/electromagnetic_harmonic.c, bundles
 * src/wasm/c99HarmonicBridge.ts with esbuild, then asserts the two
 * implementations agree to within 1e-6 on frequency / THD / harmonics.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cSource = join(root, 'c-dsp/electromagnetic_harmonic.c');
const bridgeSource = join(root, 'src/wasm/c99HarmonicBridge.ts');

const dir = mkdtempSync(join(tmpdir(), 'vs-parity-'));
let failures = 0;

function check(label, a, b, tol) {
  const err = Math.abs(a - b);
  const ok = err <= tol;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)} C=${a.toFixed(8)}  TS=${b.toFixed(8)}  |Δ|=${err.toExponential(2)}`,
  );
}

try {
  /* ---- C99 reference ---- */
  const bin = join(dir, 'vs_selftest');
  execFileSync('gcc', ['-std=c99', '-O2', '-DVS_ENABLE_MAIN', cSource, '-lm', '-o', bin], {
    stdio: 'inherit',
  });
  const cReports = JSON.parse(execFileSync(bin, [], { encoding: 'utf8' }));

  /* ---- TypeScript bridge ---- */
  const out = join(dir, 'bridge.mjs');
  execFileSync(join(root, 'node_modules/.bin/esbuild'), [
    bridgeSource,
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${out}`,
  ], { stdio: 'inherit' });
  const bridge = await import(pathToFileURL(out).href);

  console.log('\n[test-bridge-parity] C99 vs TypeScript bridge:');
  cReports.forEach((crep, i) => {
    const trep = bridge.analyzeScenario(i);
    if (!trep) {
      failures++;
      console.log(`  FAIL  scenario ${i}: bridge returned null`);
      return;
    }
    console.log(`  scenario ${crep.scenario}`);
    check('freqHz', crep.freqHz, trep.freqHz, 1e-6);
    check('thdPercent', crep.thdPercent, trep.thdPercent, 1e-6);
    check('crestFactor', crep.crestFactor, trep.crestFactor, 1e-9);
    check('purityScore', crep.purityScore, trep.purityScore, 1e-6);
    for (let h = 0; h < 9; h++) {
      check(`harmonicAmp[${h + 1}]`, crep.harmonics[h], trep.harmonicAmp[h], 1e-9);
    }
  });

  if (failures) {
    console.error(`\n[test-bridge-parity] ${failures} mismatch(es)`);
    process.exit(1);
  }
  console.log('\n[test-bridge-parity] OK — C99 kernel and TypeScript bridge are numerically identical');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
