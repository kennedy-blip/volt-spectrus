import { Injectable } from '@angular/core';
import {
  DEFAULT_FS,
  DEFAULT_FRAME,
  SCENARIOS,
  analyzeHarmonics,
  synthesizeScenario,
  type HarmonicReport,
} from '../../wasm/c99HarmonicBridge';
import type { NominalGrid } from '../models';

/** Harmonic amplitudes used by the audible hum synthesizer (matches C99). */
const HUM_HARMONICS: number[][] = [
  [1, 0.013, 0.007, 0, 0.008, 0, 0.005, 0, 0],
  [1, 0.18, 0.11, 0, 0.15, 0, 0.1, 0, 0.05],
  [1, 0.1, 0.085, 0, 0.05, 0, 0.035, 0, 0.02],
  [1, 0.02, 0, 0, 0.07, 0, 0.05, 0, 0.025],
  [1, 0.015, 0.009, 0, 0.007, 0, 0.005, 0, 0],
];

const HUM_F0 = [60.002, 59.4, 55.2, 60.0, 50.005];

export type ReportHandler = (report: HarmonicReport) => void;

/**
 * Real Web Audio hum synthesis + live microphone DSP.
 *
 * The microphone path deliberately requests raw, uncompressed audio
 * (echoCancellation / noiseSuppression / autoGainControl all disabled) so the
 * 100/120 Hz magnetostrictive transformer hum is never stripped by the
 * browser's voice high-pass chain.
 */
@Injectable({ providedIn: 'root' })
export class AudioHumService {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private humScenario = -1;

  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private micTimer: number | null = null;
  private micHandler: ReportHandler | null = null;
  private micNominal: NominalGrid = 60;

  /* -------------------------------------------------------------- context */

  /** Lazily create the AudioContext; returns null when unsupported. */
  private ensureCtx(): AudioContext | null {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /* ------------------------------------------------------------- hum synth */

  /** Start the audible hum for a simulator scenario. */
  startHum(scenarioId: number, level = 0.16): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    this.stopHum();
    const amps = HUM_HARMONICS[scenarioId] ?? HUM_HARMONICS[0];
    const f0 = HUM_F0[scenarioId] ?? 60;
    this.humScenario = scenarioId;

    amps.forEach((amp, i) => {
      if (amp <= 0) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f0 * (i + 1);
      const gain = ctx.createGain();
      gain.gain.value = amp * level;
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start();
      this.oscillators.push(osc);
    });

    // 120 Hz rectifier buzz layer for the failing-SMPS scenario.
    if (scenarioId === 3) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 120;
      const gain = ctx.createGain();
      gain.gain.value = level * 0.08;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master!);
      osc.start();
      this.oscillators.push(osc);
    }

    this.master!.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
  }

  stopHum(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
    const old = this.oscillators;
    this.oscillators = [];
    this.humScenario = -1;
    window.setTimeout(() => old.forEach((o) => { try { o.stop(); } catch { /* noop */ } }), 160);
  }

  get currentHumScenario(): number {
    return this.humScenario;
  }

  /* ------------------------------------------------------- simulated DSP */

  /** Analyze one deterministic simulator frame. */
  analyzeSimulator(scenarioId: number, nominal: NominalGrid): HarmonicReport | null {
    const samples = synthesizeScenario(scenarioId, DEFAULT_FS, DEFAULT_FRAME);
    return analyzeHarmonics(samples, DEFAULT_FRAME, DEFAULT_FS, nominal);
  }

  /* -------------------------------------------------------------- live mic */

  /**
   * Begin live analysis of a microphone stream.  `onReport` fires ~5x/second
   * with the interpolated Goertzel result.
   */
  startMic(stream: MediaStream, nominal: NominalGrid, onReport: ReportHandler): boolean {
    const ctx = this.ensureCtx();
    if (!ctx) return false;
    this.stopMic();
    this.micStream = stream;
    this.micNominal = nominal;
    this.micHandler = onReport;

    this.micSource = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = DEFAULT_FRAME;
    this.analyser.smoothingTimeConstant = 0;
    this.micSource.connect(this.analyser);

    const buffer = new Float32Array(this.analyser.fftSize);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buffer);
      const report = analyzeHarmonics(buffer, buffer.length, ctx.sampleRate, this.micNominal);
      if (report && this.micHandler) this.micHandler(report);
    };
    tick();
    this.micTimer = window.setInterval(tick, 200);
    return true;
  }

  stopMic(): void {
    if (this.micTimer !== null) {
      window.clearInterval(this.micTimer);
      this.micTimer = null;
    }
    if (this.micSource) {
      try { this.micSource.disconnect(); } catch { /* noop */ }
      this.micSource = null;
    }
    this.analyser = null;
    this.micStream = null;
    this.micHandler = null;
  }

  /* -------------------------------------------------------------- helpers */

  /** Nominal grid for a scenario (50 vs 60 Hz). */
  static nominalFor(scenarioId: number): NominalGrid {
    return (SCENARIOS[scenarioId]?.nominal ?? 60) as NominalGrid;
  }
}
