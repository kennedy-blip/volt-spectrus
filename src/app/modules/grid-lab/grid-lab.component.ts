import {
  Component,
  OnDestroy,
  Signal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { OscilloscopeComponent } from '../../components/oscilloscope/oscilloscope.component';
import { AnalogGaugeComponent } from '../../components/analog-gauge/analog-gauge.component';
import { HarmonicBarsComponent } from '../../components/harmonic-bars/harmonic-bars.component';
import { TelemetryService } from '../../services/telemetry.service';
import { AudioHumService } from '../../services/audio-hum.service';
import { PermissionService } from '../../services/permission.service';
import { HapticsService } from '../../services/haptics.service';
import { UiStateService } from '../../services/ui-state.service';
import { SCENARIOS, type HarmonicReport } from '../../../wasm/c99HarmonicBridge';
import { C99_HARMONIC_SOURCE } from '../../../generated/embedded-sources';
import type { GridAudit, NominalGrid, Verdict } from '../../models';

const HARMONIC_LABELS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
const HARMONIC_HZ = (grid: number) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map((h) => `${(h * grid).toFixed(0)}`);

function verdictOf(r: HarmonicReport): Verdict {
  const fErr = Math.abs(r.freqHz - r.nominalHz);
  if (r.thdPercent < 3 && fErr < 0.5) return 'PURE_SINE';
  if (r.thdPercent < 8) return 'ACCEPTABLE';
  if (r.thdPercent < 15) return 'DIRTY_POWER';
  return 'DANGER';
}

@Component({
  selector: 'vs-grid-lab',
  standalone: true,
  imports: [OscilloscopeComponent, AnalogGaugeComponent, HarmonicBarsComponent],
  template: `
    <section class="module">
      <div class="module-head">
        <div>
          <h2>Grid &amp; Inverter THD Lab</h2>
          <p class="lede">
            Interpolated Goertzel sub-millihertz filter on the ANSI C99 kernel. Track the
            50/60 Hz fundamental, resolve the 1st–9th harmonics and score sine-wave purity —
            before a cheap inverter fries your fridge compressor.
          </p>
        </div>
        <div class="spacer"></div>
        <div class="row">
          <button class="chip" [class.active]="grid() === 60" (click)="setGrid(60)">🇺🇸 60 Hz</button>
          <button class="chip" [class.active]="grid() === 50" (click)="setGrid(50)">🌍 50 Hz</button>
          <button class="chip" [class.active]="humsOn()" (click)="toggleHums()">🔊 Hum</button>
        </div>
      </div>

      <div class="grid grid-3 mb">
        <div class="glass glass-pad col">
          <div class="section-title">Signal source · 5 power simulators</div>
          <div class="col" style="gap:8px">
            @for (s of scenarios; track s.id) {
              <div class="appliance" [class.selected]="scenarioId() === s.id && !micActive()" (click)="selectScenario(s.id)">
                <div class="grow">
                  <div class="name">{{ s.name }}</div>
                  <div class="meta">{{ s.expected }}</div>
                </div>
                <span class="badge" [class.good]="s.danger === 'safe'" [class.warn]="s.danger === 'warn'" [class.bad]="s.danger === 'danger'">
                  {{ s.danger === 'safe' ? 'SAFE' : s.danger === 'warn' ? 'WARN' : 'DANGER' }}
                </span>
              </div>
            }
          </div>

          <div class="divider"></div>
          <div class="row">
            <button class="btn" [class.btn-primary]="!micActive()" (click)="toggleMic()">
              {{ micActive() ? '⏹ Stop live mic' : '🎙 Live mic mode' }}
            </button>
            <span class="badge" [class.good]="micActive()" [class.warn]="!micActive()">
              {{ micActive() ? 'MIC ACTIVE' : micStatus() }}
            </span>
          </div>
          <p class="hint">
            Mic requests raw audio (echoCancellation / noiseSuppression / autoGainControl OFF)
            so transformer hum is never high-pass filtered away.
          </p>
        </div>

        <div class="glass glass-pad" style="grid-column: span 2">
          <div class="row" style="justify-content:space-between">
            <div class="section-title" style="margin:0">60 fps AC oscilloscope</div>
            <span class="badge info">{{ grid() }} Hz nominal</span>
          </div>
          <div class="mt">
            <vs-oscilloscope
              [harmonics]="waveform()"
              [frequencyHz]="report()?.freqHz ?? grid()"
              [purity]="report()?.purityScore ?? 100"
            />
          </div>
          <div class="stat-row mt">
            <div class="stat"><div class="label">Fundamental</div><div class="value">{{ freqText() }}</div></div>
            <div class="stat"><div class="label">THD</div><div class="value" [class.bad]="(report()?.thdPercent ?? 0) > 15" [class.warn]="(report()?.thdPercent ?? 0) > 8">{{ thdText() }}</div></div>
            <div class="stat"><div class="label">Crest factor</div><div class="value">{{ crestText() }}</div></div>
            <div class="stat"><div class="label">Purity</div><div class="value">{{ purityText() }}</div></div>
          </div>
          <div class="row mt">
            <span class="badge" [class.good]="verdict() === 'PURE_SINE'" [class.warn]="verdict() === 'ACCEPTABLE' || verdict() === 'DIRTY_POWER'" [class.bad]="verdict() === 'DANGER'">
              {{ verdict() }}
            </span>
            <span class="muted" style="font-size:12.5px">{{ report()?.verdict ?? 'awaiting analysis' }}</span>
          </div>
        </div>
      </div>

      <div class="grid grid-3 mb">
        <div class="glass glass-pad">
          <div class="section-title">Frequency needle</div>
          <vs-gauge [value]="report()?.freqHz ?? grid()" [min]="45" [max]="70" label="Hz" unit="mains" [decimals]="3"
            [zones]="[{to: 58, color: 'var(--crimson)'}, {to: 62, color: 'var(--emerald)'}, {to: 70, color: 'var(--crimson)'}]" />
        </div>
        <div class="glass glass-pad">
          <div class="section-title">THD needle</div>
          <vs-gauge [value]="report()?.thdPercent ?? 0" [min]="0" [max]="40" label="THD%" unit="IEEE 519" [decimals]="1"
            [zones]="[{to: 3, color: 'var(--emerald)'}, {to: 15, color: 'var(--amber)'}, {to: 40, color: 'var(--crimson)'}]" />
        </div>
        <div class="glass glass-pad">
          <div class="section-title">Sine purity needle</div>
          <vs-gauge [value]="report()?.purityScore ?? 0" [min]="0" [max]="100" label="Purity" unit="score" [decimals]="1"
            [zones]="[{to: 40, color: 'var(--crimson)'}, {to: 80, color: 'var(--amber)'}, {to: 100, color: 'var(--emerald)'}]" />
        </div>
      </div>

      <div class="grid grid-3">
        <div class="glass glass-pad" style="grid-column: span 2">
          <div class="row" style="justify-content:space-between">
            <div class="section-title" style="margin:0">Harmonic spectrum · 1st–9th</div>
            <span class="faint mono" style="font-size:11px">{{ harmonicHzLabels() }}</span>
          </div>
          <vs-harmonic-bars [values]="harmonicPercents()" [labels]="harmonicLabels" [max]="30" />
        </div>

        <div class="glass glass-pad col">
          <div class="section-title">Engineer actions</div>
          <button class="btn btn-primary" (click)="recordAudit()" [disabled]="!report()">⬆ Record grid audit</button>
          <button class="btn" (click)="openBlueprint()">📐 C99 blueprint inspector</button>
          <button class="btn" (click)="openWaveformBlueprint()">∿ THD waveform synthesizer</button>
          <p class="hint">
            Recording persists to IndexedDB, enqueues a GraphQL mutation and feeds the
            offline sync queue.
          </p>
        </div>
      </div>
    </section>
  `,
})
export class GridLabComponent implements OnDestroy {
  private readonly telemetry = inject(TelemetryService);
  private readonly audio = inject(AudioHumService);
  private readonly permissions = inject(PermissionService);
  private readonly haptics = inject(HapticsService);
  private readonly ui = inject(UiStateService);

  readonly scenarios = SCENARIOS;
  readonly harmonicLabels = HARMONIC_LABELS;
  readonly grid = signal<NominalGrid>(60);
  readonly scenarioId = signal(0);
  readonly report = signal<HarmonicReport | null>(null);
  readonly micActive = signal(false);
  readonly humsOn = signal(true);

  readonly waveform = computed(() => {
    const r = this.report();
    if (!r) return [1, 0, 0, 0, 0, 0, 0, 0, 0];
    const a1 = r.harmonicAmp[0] || 1;
    return r.harmonicAmp.map((a) => a / a1);
  });
  readonly harmonicPercents = computed(() => this.report()?.harmonicPercent ?? new Array(9).fill(0));
  readonly verdict = computed(() => (this.report() ? verdictOf(this.report()!) : 'PURE_SINE'));

  readonly freqText = computed(() => `${(this.report()?.freqHz ?? this.grid()).toFixed(3)} Hz`);
  readonly thdText = computed(() => `${(this.report()?.thdPercent ?? 0).toFixed(2)} %`);
  readonly crestText = computed(() => (this.report()?.crestFactor ?? 0).toFixed(3));
  readonly purityText = computed(() => `${(this.report()?.purityScore ?? 0).toFixed(1)} / 100`);
  readonly harmonicHzLabels = computed(() => HARMONIC_HZ(this.grid()).join(' · '));

  micStatus(): string {
    return this.permissions.status()['microphone'];
  }

  selectScenario(id: number): void {
    this.scenarioId.set(id);
    this.micActive.set(false);
    this.audio.stopMic();
    const r = this.audio.analyzeSimulator(id, this.grid());
    this.report.set(r);
    this.applyReport(r);
    if (this.humsOn()) this.audio.startHum(id);
    const scenario = SCENARIOS[id];
    if (scenario?.danger === 'danger') this.haptics.dirty();
    else if (scenario?.danger === 'warn') this.haptics.vampire();
  }

  setGrid(g: NominalGrid): void {
    this.grid.set(g);
    if (this.micActive()) {
      const stream = this.permissions.getMicStream();
      if (stream) this.audio.startMic(stream, g, this.onMicReport);
    } else {
      const r = this.audio.analyzeSimulator(this.scenarioId(), g);
      this.report.set(r);
      this.applyReport(r);
    }
  }

  toggleHums(): void {
    if (this.humsOn()) {
      this.audio.stopHum();
      this.humsOn.set(false);
    } else {
      this.humsOn.set(true);
      this.audio.startHum(this.scenarioId());
    }
  }

  async toggleMic(): Promise<void> {
    if (this.micActive()) {
      this.audio.stopMic();
      await this.permissions.disable('microphone');
      this.micActive.set(false);
      const r = this.audio.analyzeSimulator(this.scenarioId(), this.grid());
      this.report.set(r);
      this.applyReport(r);
      return;
    }
    await this.permissions.enable('microphone');
    const stream = this.permissions.getMicStream();
    if (!stream) {
      this.telemetry.toast('Microphone unavailable — staying on simulator', 'warn');
      return;
    }
    const started = this.audio.startMic(stream, this.grid(), this.onMicReport);
    if (!started) {
      this.telemetry.toast('Audio context unavailable — mic analysis disabled', 'warn');
    }
    this.micActive.set(started);
    if (started) this.telemetry.toast('Live mic DSP engaged', 'good');
  }

  readonly onMicReport = (r: HarmonicReport): void => {
    this.report.set(r);
    this.applyReport(r);
    if (r.thdPercent > 15) this.haptics.dirty();
  };

  private applyReport(r: HarmonicReport | null): void {
    if (!r) return;
    this.telemetry.updatePlasma({
      thd: r.thdPercent,
      freqHz: r.freqHz,
      purity: r.purityScore,
      verdict: verdictOf(r),
      fluxUt: this.permissions.fluxUt(),
      energy: 0.65 + Math.min(r.thdPercent / 40, 1) * 0.4,
    });
  }

  async recordAudit(): Promise<void> {
    const r = this.report();
    if (!r) return;
    const payload: Omit<GridAudit, 'id' | 'createdAt' | 'synced'> = {
      frequencyHz: r.freqHz,
      thdPercent: r.thdPercent,
      crestFactor: r.crestFactor,
      purityScore: r.purityScore,
      snrDb: r.snrDb,
      nominalHz: this.grid(),
      verdict: verdictOf(r),
      verdictText: r.verdict,
      harmonics: [...r.harmonicAmp],
      harmonicPercent: [...r.harmonicPercent],
      source: this.micActive() ? 'live-microphone' : `simulator:${SCENARIOS[this.scenarioId()].key}`,
    };
    await this.telemetry.recordAudit(payload);
    this.haptics.success();
    this.telemetry.toast('Grid audit recorded + queued for sync', 'good');
  }

  openBlueprint(): void {
    const r = this.report();
    this.ui.openBlueprint({
      title: 'ANSI C99 · Interpolated Goertzel Kernel',
      subtitle: 'electromagnetic_harmonic.c — the canonical DSP source compiled by the CI parity test',
      language: 'C99',
      source: C99_HARMONIC_SOURCE,
      meta: [
        { label: 'Fundamental', value: this.freqText() },
        { label: 'THD', value: this.thdText() },
        { label: 'Purity', value: this.purityText() },
        { label: 'Kernel', value: 'O(N) Goertzel × 9 + 3-bin interpolation' },
      ],
    });
  }

  openWaveformBlueprint(): void {
    const r = this.report();
    const harmonics = r?.harmonicPercent ?? [];
    this.ui.openBlueprint({
      title: 'THD Waveform Synthesizer · IEEE 519',
      subtitle: 'Detected harmonic vector reconstructed into a distorted AC waveform',
      language: 'DSP',
      source: [
        `# Detected harmonic vector (orders 1..9, % of fundamental)`,
        `harmonics = [${harmonics.map((h) => h.toFixed(3)).join(', ')}]`,
        ``,
        `# Ideal sine:  y(t) = sin(2πft)`,
        `# Distorted:    y(t) = Σ h_k · sin(2πkft)`,
        `THD%  = ${this.thdText()}`,
        `Crest = ${this.crestText()}  (ideal √2 = 1.4142)`,
        `Purity= ${this.purityText()}`,
        ``,
        `# IEEE 519 voltage THD limit (<69 kV bus) = 5.0%`,
        `# Verdict: ${r?.verdict ?? 'n/a'}`,
      ].join('\n'),
      meta: [
        { label: 'Fundamental', value: this.freqText() },
        { label: 'THD', value: this.thdText() },
        { label: 'Worst harmonic', value: `#${worstHarmonic(harmonics)}` },
        { label: 'Crest factor', value: this.crestText() },
      ],
    });
  }

  ngOnDestroy(): void {
    this.audio.stopMic();
    this.audio.stopHum();
  }
}

function worstHarmonic(percent: number[]): number {
  let idx = 0;
  let max = -1;
  percent.forEach((p, i) => {
    if (i > 0 && p > max) {
      max = p;
      idx = i;
    }
  });
  return idx + 1;
}
