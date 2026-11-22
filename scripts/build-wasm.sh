#!/usr/bin/env bash
# =============================================================================
#  VOLT-SPECTRA — optional WASM build for the C99 Goertzel kernel.
#  Requires emscripten (emcc).  When absent, the deterministic TypeScript
#  TypedArray bridge (src/wasm/c99HarmonicBridge.ts) is used instead and the
#  Vercel build stays 100% clang/emcc-free.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/public/wasm"
OUT="$OUT_DIR/c99Harmonic.wasm"

if ! command -v emcc >/dev/null 2>&1; then
  echo "[build-wasm] emcc not found — skipping optional WASM build."
  echo "[build-wasm] The TypeScript bridge provides identical numerics."
  exit 0
fi

mkdir -p "$OUT_DIR"
emcc -O3 -std=c99 \
  -s SIDE_MODULE=1 \
  -s EXPORTED_FUNCTIONS='["_vs_analyze","_vs_synthesize"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s WASM_BIGINT=0 \
  -o "$OUT" \
  "$ROOT/c-dsp/electromagnetic_harmonic.c"

echo "[build-wasm] wrote $OUT ($(stat -c%s "$OUT") bytes)"
