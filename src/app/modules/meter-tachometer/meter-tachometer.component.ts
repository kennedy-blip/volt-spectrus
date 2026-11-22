import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AnalogGaugeComponent } from '../../components/analog-gauge/analog-gauge.component';
import { TelemetryService } from '../../services/telemetry.service';
import { PermissionService } from '../../services/permission.service';
import { HapticsService } from '../../services/haptics.service';
import { UiStateService } from '../../services/ui-state.service';

interface PulseOption {
  label: string;
  kh: number;
  unit: 'imp/kWh' | 'Wh/rev';
  note: string;
}

const PULSE_OPTIONS: PulseOption[] = [
  { label: '1000 imp/kWh', kh: 1000, unit: 'imp/kWh', note: 'common residential electronic meter' },
  { label: '800 imp/kWh', kh: 800, unit: 'imp/kWh', note: 'older electromechanical' },
  { label: '3200 imp/kWh', kh: 3200, unit: 'imp/kWh', note: 'high-resolution meter' },
  { label: '7.2 Wh/rev', kh: 3600 / 7.2, unit: 'Wh/rev', note: 'electromechanical disc' },
];

/**
 * Optical imp/kWh LED pulse scanner + tactile tap-sync.  Turns any utility
 * meter into a live whole-home kW / $/hr monitor.
 */
@Component({
  selector: 'vs-meter-tachometer',
  standalone: true,
  imports: [AnalogGaugeComponent],
  template: `
    <section class="module">
      <div class="module-head">
        <div>
          <h2>Smart-Meter Tachometer</h2>
          <p class="lede">
            Point the reticle at the blinking metrology LED (or tap in time with it) and the
            optical photodiode model locks onto the flashes — computing exact interval Δt,
            whole-home kilowatts, $/hr and the projected monthly bill.
          </p>
        </div>
        <div class="spacer"></div>
        <div class="row">
          <button class="chip" [class.active]="mode() === 'optical'" (click)="setMode('optical')">📷 Optical auto</button>
          <button class="chip" [class.active]="mode() === 'tap'" (click)="setMode('tap')">👆 Tap-sync</button>
        </div>
      </div>

      <div class="grid grid-3 mb">
        <div class="glass glass-pad col">
          <div class="section-title">Meter pulse constant (K<sub>h</sub>)</div>
          <div class="col" style="gap:8px">
            @for (p of pulseOptions; track p.label) {
              <div class="appliance" [class.selected]="kh() === p.kh" (click)="setKh(p)">
                <div class="grow">
                  <div class="name mono">{{ p.label }}</div>
                  <div class="meta">{{ p.note }}</div>
                </div>
                @if (kh() === p.kh) { <span class="badge good">LOCKED</span> }
              </div>
            }
          </div>

          <div class="divider"></div>
          <div class="section-title">Simulated house load</div>
          <div class="row" style="justify-content:space-between">
            <span class="faint mono" style="font-size:11px">0.4 kW idle</span>
            <span class="mono" style="font-size:12px">{{ houseLoadKw().toFixed(1) }} kW</span>
            <span class="faint mono" style="font-size:11px">9.8 kW AC+EV</span>
          </div>
          <input type="range" min="0.4" max="9.8" step="0.1" [value]="houseLoadKw()"
                 (input)="houseLoadKw.set(+$any($event.target).value)" />
          <p class="hint">Expected pulse period: {{ periodText() }}</p>
        </div>

        <div class="glass glass-pad" style="grid-column: span 2">
          <div class="row" style="justify-content:space-between">
            <div class="section-title" style="margin:0">Optical reticle · live simulated LED</div>
            <div class="row">
              <span class="badge" [class.good]="locked()">{{ locked() ? 'PHOTODIODE LOCK' : 'SEARCHING' }}</span>
              <button class="chip" [class.active]="cameraOn()" (click)="toggleCamera()">📷 {{ cameraOn() ? 'Camera on' : 'Enable camera' }}</button>
            </div>
          </div>

          <div class="reticle mt">
            @if (cameraOn()) {
              <video #video autoplay playsinline muted></video>
            }
            <div class="crosshair"></div>
            <div class="led" [class.on]="ledOn()" style="top:44%;left:58%"></div>
            <div class="row" style="position:absolute;left:12px;bottom:10px;gap:8px">
              <span class="badge info">Δt {{ intervalText() }}</span>
              <span class="badge" [class.good]="locked()">{{ pulseCount() }} pulses</span>
            </div>
          </div>

          <div class="grid grid-4 mt">
            <div class="stat"><div class="label">Interval Δt</div><div class="value">{{ intervalText() }}</div></div>
            <div class="stat"><div class="label">Power</div><div class="value">{{ powerKwText() }}</div></div>
            <div class="stat"><div class="label">Burn rate</div><div class="value">{{ costText() }}</div></div>
            <div class="stat"><div class="label">Projected</div><div class="value">{{ monthlyText() }}</div></div>
          </div>

          <div class="row mt">
            @if (mode() === 'tap') {
              <button class="btn btn-primary btn-glow" (click)="tap()">👆 TAP on each blink</button>
              <span class="hint">{{ tapTimes.length }} taps recorded</span>
            } @else {
              <button class="btn" (click)="resetLock()">↺ Re-acquire</button>
            }
            <span class="right"></span>
            <button class="btn" (click)="record()">⬆ Record reading</button>
            <button class="btn" (click)="openBlueprint()">📐 Blueprint</button>
          </div>
        </div>
      </div>

      <div class="grid grid-3">
        <div class="glass glass-pad">
          <div class="section-title">Whole-home kW draw</div>
          <vs-gauge [value]="powerKw()" [min]="0" [max]="12" label="kW" unit="whole-home" [decimals]="2"
            [zones]="[{to: 4, color: 'var(--emerald)'}, {to: 8, color: 'var(--amber)'}, {to: 12, color: 'var(--crimson)'}]" />
        </div>
        <div class="glass glass-pad" style="grid-column: span 2">
          <div class="section-title">Metrology pulse math</div>
          <div class="grid grid-2">
            <div class="glass glass-pad" style="--radius-lg:16px">
              <div class="mono" style="font-size:12.5px;line-height:1.9">
                K<sub>h</sub> = {{ kh().toFixed(0) }} {{ unit() }}<br/>
                T = 3600 / (K<sub>h</sub> · kW)<br/>
                P = 3600 · K<sub>h</sub> / Δt<br/>
                $/hr = kW · rate
              </div>
            </div>
            <div class="col" style="gap:8px">
              <div class="stat"><div class="label">Pulse constant</div><div class="value small">{{ kh().toFixed(0) }} {{ unit() }}</div></div>
              <div class="stat"><div class="label">Meter rate</div><div class="value small">{{ '$' }}{{ telemetry.blendedRate().toFixed(2) }}/kWh</div></div>
              <div class="stat"><div class="label">House load target</div><div class="value small">{{ houseLoadKw().toFixed(1) }} kW</div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class MeterTachometerComponent implements AfterViewInit, OnDestroy {
  readonly telemetry = inject(TelemetryService);
  private readonly permissions = inject(PermissionService);
  private readonly haptics = inject(HapticsService);
  private readonly ui = inject(UiStateService);
  @ViewChild('video') private videoRef?: ElementRef<HTMLVideoElement>;

  readonly pulseOptions = PULSE_OPTIONS;
  readonly kh = signal(1000);
  readonly unit = signal<'imp/kWh' | 'Wh/rev'>('imp/kWh');
  readonly houseLoadKw = signal(2.4);
  readonly mode = signal<'optical' | 'tap'>('optical');
  readonly ledOn = signal(false);
  readonly locked = signal(false);
  readonly interval = signal(0);
  readonly powerW = signal(0);
  readonly powerKw = signal(0);
  readonly costPerHour = signal(0);
  readonly projectedMonthly = signal(0);
  readonly pulseCount = signal(0);
  readonly cameraOn = signal(false);
  readonly tapTimes: number[] = [];

  private lastPulseAt: number | null = null;
  private timer: number | null = null;
  private ledTimer: number | null = null;

  readonly periodSeconds = computed(() => 3600 / (this.kh() * this.houseLoadKw()));
  readonly periodText = computed(() => `${this.periodSeconds().toFixed(3)} s/pulse`);
  readonly intervalText = computed(() => (this.interval() ? `${this.interval().toFixed(3)} s` : '—'));
  readonly powerKwText = computed(() => `${this.powerKw().toFixed(2)} kW`);
  readonly costText = computed(() => `$${this.costPerHour().toFixed(3)}/hr`);
  readonly monthlyText = computed(() => `$${this.projectedMonthly().toFixed(0)}/mo`);

  constructor() {
    // Restart the pulse train whenever the pulse constant or load changes.
    effect(() => {
      const kh = this.kh();
      const load = this.houseLoadKw();
      void kh;
      void load;
      this.startMeter();
    });
  }

  ngAfterViewInit(): void {
    if (this.cameraOn()) this.attachCamera();
  }

  ngOnDestroy(): void {
    this.stopMeter();
    if (this.ledTimer) window.clearTimeout(this.ledTimer);
    if (this.cameraOn()) void this.permissions.disable('camera');
  }

  setKh(p: PulseOption): void {
    this.kh.set(p.kh);
    this.unit.set(p.unit);
    this.resetLock();
  }

  setMode(mode: 'optical' | 'tap'): void {
    this.mode.set(mode);
    this.resetLock();
  }

  resetLock(): void {
    this.locked.set(false);
    this.interval.set(0);
    this.powerW.set(0);
    this.powerKw.set(0);
    this.costPerHour.set(0);
    this.projectedMonthly.set(0);
    this.pulseCount.set(0);
    this.lastPulseAt = null;
    this.tapTimes.length = 0;
  }

  /* --------------------------------------------------------- pulse engine */

  private startMeter(): void {
    this.stopMeter();
    const loop = () => {
      this.firePulse();
      const period = Math.max(this.periodSeconds(), 0.06);
      this.timer = window.setTimeout(loop, period * 1000);
    };
    this.timer = window.setTimeout(loop, 200);
  }

  private stopMeter(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private firePulse(): void {
    const now = performance.now();
    const prev = this.lastPulseAt;
    this.lastPulseAt = now;
    this.pulseCount.update((n) => n + 1);
    this.ledOn.set(true);
    if (this.ledTimer) window.clearTimeout(this.ledTimer);
    this.ledTimer = window.setTimeout(() => this.ledOn.set(false), 100);

    if (this.mode() === 'optical' && prev !== null) {
      const dt = (now - prev) / 1000;
      if (dt > 0.05) {
        this.locked.set(true);
        this.haptics.tick();
        this.applyInterval(dt);
      }
    }
  }

  tap(): void {
    const now = performance.now();
    this.tapTimes.push(now);
    if (this.tapTimes.length > 12) this.tapTimes.shift();
    this.haptics.tick();
    this.ledOn.set(true);
    if (this.ledTimer) window.clearTimeout(this.ledTimer);
    this.ledTimer = window.setTimeout(() => this.ledOn.set(false), 90);
    if (this.tapTimes.length >= 2) {
      const dt = (this.tapTimes[this.tapTimes.length - 1] - this.tapTimes[this.tapTimes.length - 2]) / 1000;
      if (dt > 0.05) {
        this.locked.set(true);
        this.applyInterval(dt);
      }
    }
  }

  private applyInterval(dt: number): void {
    this.interval.set(dt);
    const watts = (3600 * this.kh()) / dt;
    const kw = watts / 1000;
    const cph = kw * this.telemetry.blendedRate();
    this.powerW.set(watts);
    this.powerKw.set(kw);
    this.costPerHour.set(cph);
    this.projectedMonthly.set(cph * 24 * 30);
    this.telemetry.updatePlasma({
      thd: this.telemetry.plasma().thd,
      freqHz: this.telemetry.plasma().freqHz,
      purity: this.telemetry.plasma().purity,
      fluxUt: this.telemetry.plasma().fluxUt,
      energy: 0.5 + Math.min(kw / 12, 1) * 0.5,
      verdict: this.telemetry.plasma().verdict,
    });
  }

  async toggleCamera(): Promise<void> {
    if (this.cameraOn()) {
      await this.permissions.disable('camera');
      this.cameraOn.set(false);
      return;
    }
    await this.permissions.enable('camera');
    const stream = this.permissions.getCameraStream();
    if (stream) {
      this.cameraOn.set(true);
      // Wait a frame for the ViewChild video to exist under @if.
      setTimeout(() => this.attachCamera(), 0);
    } else {
      this.telemetry.toast('Camera unavailable — reticle stays simulated', 'warn');
    }
  }

  private attachCamera(): void {
    const video = this.videoRef?.nativeElement;
    const stream = this.permissions.getCameraStream();
    if (video && stream) video.srcObject = stream;
  }

  async record(): Promise<void> {
    if (!this.locked() || !this.interval()) {
      this.telemetry.toast('Lock onto pulses first (auto or tap)', 'warn');
      return;
    }
    await this.telemetry.recordMeterRead({
      pulseConstant: Math.round(this.kh()),
      pulseConstantUnit: this.unit(),
      intervalSeconds: this.interval(),
      powerW: this.powerW(),
      powerKw: this.powerKw(),
      costPerHourUsd: this.costPerHour(),
      projectedMonthlyUsd: this.projectedMonthly(),
      mode: this.mode(),
    });
    this.haptics.success();
    this.telemetry.toast(`Meter reading recorded · ${this.powerKwText()}`, 'good');
  }

  openBlueprint(): void {
    const kh = this.kh();
    this.ui.openBlueprint({
      title: 'Optical metrology · imp/kWh → kW',
      subtitle: 'Pulse-constant tachometer math and the GraphQL mutation that records it',
      language: 'DSP + GraphQL',
      source: [
        `# Meter constant`,
        `Kh = ${kh.toFixed(0)} ${this.unit()}`,
        ``,
        `# Whole-home power from the pulse interval`,
        `T  = 3600 / (Kh * kW)        # expected period`,
        `kW = 3600 * Kh / Δt          # measured`,
        ``,
        `# Live values`,
        `Δt        = ${this.intervalText()}`,
        `power     = ${this.powerKwText()} (${this.powerW().toFixed(0)} W)`,
        `burn rate = ${this.costText()}`,
        `projected = ${this.monthlyText()}`,
        ``,
        `mutation RecordRead($input: SmartMeterReadInput!) {`,
        `  recordSmartMeterRead(input: $input) { id pulseConstant intervalSeconds powerKw costPerHourUsd }`,
        `}`,
      ].join('\n'),
      meta: [
        { label: 'Pulse constant', value: `${kh.toFixed(0)} ${this.unit()}` },
        { label: 'Interval Δt', value: this.intervalText() },
        { label: 'Power', value: this.powerKwText() },
        { label: 'Burn rate', value: this.costText() },
        { label: 'Projected', value: this.monthlyText() },
      ],
    });
  }
}
