# ⚡ VOLT-SPECTRA

**Contactless AC Grid Frequency & THD Analyzer · EMF Vampire-Load Hunter · Optical
Smart-Meter Tachometer · Time-of-Use Bill Auditor.**

A real-world electrical diagnostic instrument written across **five languages**, shipped
as an Angular 19 Signals web app (Vercel) **and** an offline-capable Android `.APK`
replica with a one-tap download engine.

---

## ✨ What it does

| Module | Problem solved |
| --- | --- |
| **Grid & Inverter THD Lab** | Measures mains frequency (50/60 Hz) and Total Harmonic Distortion with an interpolated Goertzel sub-millihertz filter. Warns before a modified-sine inverter or surging generator fries a compressor or laptop. |
| **Vampire EMF Hunter** | Contactless phantom-load sweep fusing 3-axis µT flux with 100/120 Hz magnetostrictive hum. Logs culprits to a kill-list and banks the exact `$/yr` waste. |
| **Smart-Meter Tachometer** | Optical `imp/kWh` LED pulse timing (or tactile tap-sync) → live whole-home kW, `$/hr` and projected monthly bill. |
| **Ruby TOU Tariff Auditor** | 24-hour Time-of-Use curve, drag loads from the 4–9 PM surge window to off-peak, compute annual arbitrage and check a 100 A / 200 A panel. |
| **GraphQL & Polyglot Vault** | Real GraphQL console + five-language inspector + offline→online sync queue and telemetry exporter. |

---

## 🧬 Polyglot architecture

| Layer | File | Language | Role |
| --- | --- | --- | --- |
| UI / state | `src/app/**/*.ts` | **Angular 19** (Standalone + Signals) | Fine-grained reactive store, spring physics, routing, glass UI |
| DSP kernel | `c-dsp/electromagnetic_harmonic.c` | **ANSI C99** | Interpolated Goertzel filter bank, THD, crest factor, purity score |
| DSP bridge | `src/wasm/c99HarmonicBridge.ts` | TypeScript | Deterministic TypedArray port of the C99 kernel (bit-identical) |
| Tariff engine | `api/tariff_auditor.rb` | **Ruby 3.3** | TOU arbitrage, vampire drain, IEEE 519, breaker sizing + offline mirror |
| API schema | `src/graphql/grid_telemetry.graphql` | **GraphQL SDL** | Executable offline schema (`GridAudit`, `VampireAppliance`, `SmartMeterRead`, `Query`, `Mutation`) |
| GPU field | `src/shaders/plasma_field.glsl` | **GLSL ES 3.00** | WebGL2 electromagnetic flux-line & plasma sine-wave canvas |
| Native shell | `capacitor.config.ts` | TypeScript | Capacitor Android config (`com.voltspectra.griddsp`) |
| CI | `.github/workflows/build-and-bundle-apk.yml` | YAML | Web bundle → Vercel, Capacitor → Gradle → `.apk` |

### DSP algorithm (C99 + TS bridge)

1. Periodic Hann window (coherent gain 0.5).
2. Coarse integer-bin Goertzel search over nominal ±15 % (catches 55.2 Hz governor droop).
3. Three-point **log-parabolic interpolation** of the Hann main lobe.
4. A **fractional-bin refinement pass** (0.5-bin spacing) → **sub-millihertz** estimate.
5. Generalized Goertzel at `h · f_est`, `h = 1..9`, removes scalloping bias from THD.
6. `THD% = √(Σ A_h²)/A_1 · 100` (IEEE 519), crest factor, purity score.

Measured accuracy (see `npm run c99:test`): **0.08 – 0.39 mHz** frequency error across all
five power simulators, THD within 0.12 percentage points.

The TypeScript bridge is verified **numerically identical** to the C99 kernel
(`npm run test:parity`, agreement to ~1e-10). No `clang`/`emcc` is required on Vercel.

---

## 🚀 Quick start

```bash
npm install
npm run dev        # http://localhost:4200  (preview host allowlisted)
npm run build      # production bundle → dist/browser  (Vercel-ready)
```

### Tests

```bash
npm test           # C99 selftest + C99↔TS parity + GraphQL SDL execution
npm run c99:test       # compile & run the C99 kernel against 5 simulators
npm run test:parity    # assert the TS bridge == C99 kernel
npm run test:graphql   # parse the SDL and execute representative operations
```

### One-tap Android `.APK`

`public/releases/voltspectra-release.apk` is a **pre-bundled distribution stub** so the
download button never 404s. The signed release APK is produced by the GitHub Actions
pipeline (web bundle → `npx cap sync android` → `./gradlew assembleRelease`) and overwrites
the stub on every `v*` tag. The APK Distribution Center in the header shows an instant SVG
QR code, the polyglot build spec, SHA-256 and a 3-step sideloading guide.

### Vercel

`vercel.json` builds with `npm run build` and serves `dist/browser`, with SPA rewrites and an
`application/vnd.android.package-archive` content type for `/releases/*.apk`.

---

## 🎨 Themes & GPU modes

Switched live in the header:

1. **High-Voltage Obsidian** — deep transformer-void base, cyan/violet/emerald refractive glass.
2. **Utility Daylight Frost** — high-luminosity pearl glass for bright outdoor meter boxes.
3. **Substation Amber-Red** — night-vision-safe breaker-closet palette.
4. **Eco-Glass / Low-GPU** — matte acrylic (no backdrop blur), reduced shader octaves, for
   Android API < 31 / blackout battery saver.

Every glass surface carries a 1 px diagonal prism border, an inset specular top edge, and a
global 3.5 % SVG `feTurbulence` film-grain overlay. A cursor/gyroscope-driven specular
highlight sweeps the chrome. All needles, tachometers and harmonic bars are driven by a real
Hooke's-law spring (`stiffness 320 · damping 25 · mass 0.8`).

---

## 🔐 Privileges & sensors

The header **⚙ drawer** exposes three RBAC tiers:

- **Homeowner & Renter** — all four field modules.
- **Master Electrician Pro** — odd-harmonic spectrum (1st–9th), IEEE 519 THD synthesizer,
  100 A / 200 A breaker load balancer.
- **Grid Systems Director** — GraphQL console, five-language inspector, CSV/JSON exporter,
  IndexedDB sync controller.

The hardware permission matrix toggles **uncompressed mains-hum microphone**
(`echoCancellation/noiseSuppression/autoGainControl` all OFF), **3-axis EMF magnetometer**,
**optical metrology camera** and the **arc-pulse haptic engine**, each reporting
`ACTIVE` / `SIMULATOR ACTIVE` / `RESTRICTED` / `UNSUPPORTED`.

---

## 📴 Offline-first

All state lives in **IndexedDB** (`vampires`, `audits`, `meterReads`, `syncQueue`, `meta`).
Every mutation is persisted locally and enqueued; the sync queue replays to the cloud when
connectivity returns. The Ruby tariff mirror, GraphQL schema, GLSL shader and C99 source are
embedded at build time, so the APK works 100 % offline in basements, utility closets and
off-grid campsites.
