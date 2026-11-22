import {
  Component,
  OnDestroy,
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
import type { Severity } from '../../models';

interface SweepDevice {
  id: string;
  name: string;
  location: string;
  standbyW: number;
  emfUt: number;
  humHz: number;
  severity: Severity;
  blurb: string;
}

const CATALOG: SweepDevice[] = [
  { id: 'console', name: 'Gaming Console in Instant-On Standby', location: 'Living room media shelf', standbyW: 42, emfUt: 38.5, humHz: 120, severity: 'VAMPIRE', blurb: 'Instant-on + network standby keeps the PSU transformer energised 24/7.' },
  { id: 'dvr', name: 'Old Cable/DVR Box', location: 'TV stand', standbyW: 35, emfUt: 27.2, humHz: 120, severity: 'VAMPIRE', blurb: 'Tuner + hard-drive controller draws a full running-load at idle.' },
  { id: 'wallwart', name: 'Hot Failing Wall-Wart Transformer', location: 'Hallway outlet', standbyW: 18, emfUt: 64.1, humHz: 100, severity: 'FIRE', blurb: 'Magnetostrictive 100 Hz hum + 64 µT near-field: replace immediately.' },
  { id: 'strip', name: 'Smart Power Strip in Eco-Cutoff', location: 'Office desk', standbyW: 0.4, emfUt: 2.1, humHz: 0, severity: 'CLEAN', blurb: 'Relay-cutoff strip with a 0.4 W standby — the control reference.' },
];

/**
 * Contactless phantom-load sweeper.  Fuses the proximity-driven near-field
 * flux model with the live 3-axis magnetometer (or its simulator) and the
 * 100/120 Hz magnetostrictive hum amplitude.
 */
@Component({
  selector: 'vs-vampire-hunter',
  standalone: true,
  imports: [AnalogGaugeComponent],
  template: `
    <section class="module">
      <div class="module-head">
        <div>
          <h2>Vampire EMF Hunter</h2>
          <p class="lede">
            Drag the proximity sweep toward a power strip, wall brick or appliance. The
            near-field µT flux and 100/120 Hz hum fuse into a culprit lock — then tap
            <strong>Add to Vampire Kill-List</strong> to bank the annual dollars.
          </p>
        </div>
        <div class="spacer"></div>
        <div class="row">
          <button class="chip" [class.active]="liveEmf()" (click)="toggleLive()">🧲 Live EMF</button>
          <span class="badge" [class.good]="liveEmf()">{{ emfStatus() }}</span>
        </div>
      </div>

      <div class="grid grid-3 mb">
        <div class="glass glass-pad col">
          <div class="section-title">Proximity sweep simulator</div>
          <div class="row" style="justify-content:space-between">
            <span class="faint mono" style="font-size:11px">DISTANCE</span>
            <span class="mono" style="font-size:12px">{{ distanceCm() }} cm</span>
          </div>
          <input type="range" min="4" max="250" [value]="distanceCm()" (input)="onDistance($event)" />
          <div class="row" style="justify-content:space-between">
            <span class="badge good">NEAR · 4 cm</span>
            <span class="badge">FAR · 250 cm</span>
          </div>

          <div class="divider"></div>
          <div class="stat-row">
            <div class="stat"><div class="label">Flux density</div><div class="value">{{ fluxText() }}</div></div>
            <div class="stat"><div class="label">Hum amplitude</div><div class="value">{{ humText() }}</div></div>
            <div class="stat"><div class="label">Hum frequency</div><div class="value">{{ activeDevice().humHz }} Hz</div></div>
          </div>

          <div class="glass glass-pad mt" style="--radius-lg:16px">
            <div class="row">
              <span class="badge" [class.good]="activeDevice().severity === 'CLEAN'" [class.warn]="activeDevice().severity === 'VAMPIRE'" [class.bad]="activeDevice().severity === 'FIRE'">
                {{ activeDevice().severity }}
              </span>
              <strong style="font-size:13.5px">{{ activeDevice().name }}</strong>
            </div>
            <p class="muted" style="font-size:12px;margin-top:8px">{{ activeDevice().blurb }}</p>
            <p class="mono faint" style="font-size:11px;margin-top:6px">📍 {{ activeDevice().location }} · {{ activeDevice().standbyW }} W standby</p>
            <div class="row mt">
              <button class="btn btn-primary" (click)="lockTarget()">＋ Add to Vampire Kill-List</button>
              <button class="btn" (click)="openBlueprint()">📐 Blueprint</button>
            </div>
          </div>
        </div>

        <div class="glass glass-pad" style="grid-column: span 2">
          <div class="row" style="justify-content:space-between">
            <div class="section-title" style="margin:0">EMF flux gauge</div>
            <span class="faint mono" style="font-size:11px">µT (microtesla)</span>
          </div>
          <vs-gauge [value]="flux()" [min]="0" [max]="100" label="µT" unit="near-field" [decimals]="1"
            [zones]="[{to: 10, color: 'var(--emerald)'}, {to: 40, color: 'var(--amber)'}, {to: 100, color: 'var(--crimson)'}]" />

          <div class="divider"></div>
          <div class="section-title">Sweep catalog · live proximity lock</div>
          <div class="grid grid-2">
            @for (d of catalog; track d.id) {
              <div class="appliance" [class.selected]="activeDevice().id === d.id" (click)="focusDevice(d)">
                <div class="grow">
                  <div class="name">{{ d.name }}</div>
                  <div class="meta">{{ d.emfUt }} µT · {{ d.humHz }} Hz · {{ d.standbyW }} W</div>
                </div>
                <span class="badge" [class.good]="d.severity === 'CLEAN'" [class.warn]="d.severity === 'VAMPIRE'" [class.bad]="d.severity === 'FIRE'">
                  {{ d.standbyW > 30 ? 'VAMPIRE' : d.severity === 'FIRE' ? 'FIRE' : d.severity === 'CLEAN' ? 'CLEAN' : 'VAMPIRE' }}
                </span>
              </div>
            }
          </div>
        </div>
      </div>

      <div class="grid grid-3">
        <div class="glass glass-pad">
          <div class="section-title">Annual dollars saved by unplugging</div>
          <vs-gauge [value]="telemetry.annualSavings()" [min]="0" [max]="250" label="$/yr" unit="kill-list" [decimals]="0"
            [zones]="[{to: 80, color: 'var(--emerald)'}, {to: 160, color: 'var(--amber)'}, {to: 250, color: 'var(--crimson)'}]" />
          <p class="hint" style="text-align:center">{{ telemetry.annualKwhSaved().toFixed(0) }} kWh/yr reclaimed</p>
        </div>

        <div class="glass glass-pad" style="grid-column: span 2">
          <div class="row" style="justify-content:space-between">
            <div class="section-title" style="margin:0">Vampire kill-list · IndexedDB + GraphQL</div>
            <span class="badge info">{{ telemetry.vampires().length }} logged</span>
          </div>
          @if (telemetry.vampires().length === 0) {
            <p class="muted" style="font-size:13px;margin-top:12px">
              No culprits logged yet. Sweep the proximity slider and lock your first vampire.
            </p>
          } @else {
            <div class="scroll-x">
              <table class="table mt">
                <thead><tr><th>Appliance</th><th>Standby</th><th>kWh/yr</th><th>$/yr</th><th>EMF</th><th>Sync</th><th></th></tr></thead>
                <tbody>
                  @for (v of telemetry.vampires(); track v.id) {
                    <tr>
                      <td>{{ v.name }}<div class="faint" style="font-size:11px">{{ v.location }}</div></td>
                      <td class="mono">{{ v.standbyWatts }} W</td>
                      <td class="mono">{{ v.annualKwh.toFixed(0) }}</td>
                      <td class="mono good">{{ '$' }}{{ v.annualCostUsd.toFixed(0) }}</td>
                      <td class="mono">{{ v.emfUt }} µT</td>
                      <td><span class="badge" [class.good]="v.synced === 'SYNCED'" [class.warn]="v.synced === 'PENDING'">{{ v.synced }}</span></td>
                      <td><button class="icon-btn" style="width:30px;height:30px;font-size:13px" (click)="remove(v.id)" title="Remove">✕</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class VampireHunterComponent implements OnDestroy {
  readonly telemetry = inject(TelemetryService);
  private readonly permissions = inject(PermissionService);
  private readonly haptics = inject(HapticsService);
  private readonly ui = inject(UiStateService);

  readonly catalog = CATALOG;
  readonly distanceCm = signal(120);
  readonly liveEmf = signal(false);
  private lastPulsedId = '';

  readonly flux = computed(() => {
    if (this.liveEmf()) return this.permissions.fluxUt();
    const d = Math.max(this.distanceCm(), 1);
    return 1.5 + 2600 / (d * d);
  });

  readonly activeDevice = computed(() => {
    const f = this.flux();
    let best = CATALOG[0];
    let bestErr = Number.POSITIVE_INFINITY;
    for (const d of CATALOG) {
      const err = Math.abs(d.emfUt - f);
      if (err < bestErr) {
        bestErr = err;
        best = d;
      }
    }
    return best;
  });

  readonly fluxText = computed(() => `${this.flux().toFixed(1)} µT`);
  readonly humText = computed(() => `${Math.min(100, (this.flux() / 64) * 100).toFixed(0)} %`);

  constructor() {
    effect(() => {
      const d = this.activeDevice();
      if (d.id !== this.lastPulsedId) {
        this.lastPulsedId = d.id;
        if (d.severity === 'FIRE') this.haptics.arc();
        else if (d.severity === 'VAMPIRE') this.haptics.vampire();
        else this.haptics.tick();
        this.telemetry.updatePlasma({
          fluxUt: this.flux(),
          thd: this.telemetry.plasma().thd,
          freqHz: this.telemetry.plasma().freqHz,
          energy: 0.6 + Math.min(this.flux() / 100, 1) * 0.4,
          verdict: this.telemetry.plasma().verdict,
          purity: this.telemetry.plasma().purity,
        });
      }
    });
  }

  ngOnDestroy(): void {
    if (this.liveEmf()) void this.permissions.disable('magnetometer');
  }

  onDistance(e: Event): void {
    this.distanceCm.set(Number((e.target as HTMLInputElement).value));
  }

  focusDevice(d: SweepDevice): void {
    // Move the sweep slider to the distance that reproduces this device's flux.
    const target = Math.sqrt(2600 / Math.max(d.emfUt - 1.5, 0.1));
    this.distanceCm.set(Math.round(Math.min(Math.max(target, 4), 250)));
  }

  async toggleLive(): Promise<void> {
    if (this.liveEmf()) {
      await this.permissions.disable('magnetometer');
      this.liveEmf.set(false);
    } else {
      await this.permissions.enable('magnetometer');
      this.liveEmf.set(true);
    }
  }

  emfStatus(): string {
    return this.permissions.status()['magnetometer'];
  }

  async lockTarget(): Promise<void> {
    const d = this.activeDevice();
    const existing = this.telemetry.vampires().find((v) => v.id === d.id);
    if (existing) {
      this.telemetry.toast(`${d.name} is already on the kill-list`, 'warn');
      return;
    }
    await this.telemetry.addVampire({
      name: d.name,
      location: d.location,
      standbyWatts: d.standbyW,
      emfUt: d.emfUt,
      humHz: d.humHz,
      severity: d.severity,
    });
    this.haptics.success();
  }

  async remove(id: string): Promise<void> {
    await this.telemetry.removeVampire(id);
  }

  openBlueprint(): void {
    const d = this.activeDevice();
    const rate = this.telemetry.blendedRate();
    const annualKwh = (d.standbyW * 8760) / 1000;
    const annualUsd = annualKwh * rate;
    const mutation = [
      `mutation AddVampire($input: VampireApplianceInput!) {`,
      `  addVampireAppliance(input: $input) {`,
      `    id name location standbyWatts annualKwh annualCostUsd emfUt humHz severity`,
      `  }`,
      `}`,
      ``,
      `# variables`,
      `{`,
      `  "input": {`,
      `    "name": ${JSON.stringify(d.name)},`,
      `    "location": ${JSON.stringify(d.location)},`,
      `    "standbyWatts": ${d.standbyW},`,
      `    "emfUt": ${d.emfUt},`,
      `    "humHz": ${d.humHz},`,
      `    "severity": "${d.severity}"`,
      `  }`,
      `}`,
    ].join('\n');

    this.ui.openBlueprint({
      title: `Blueprint · ${d.name}`,
      subtitle: 'GraphQL mutation + Ruby 3.3 vampire-drain arithmetic',
      language: 'GraphQL + Ruby',
      source: [
        `#GraphQL mutation (executed locally by the offline engine)`,
        mutation,
        ``,
        `# Ruby 3.3 — api/tariff_auditor.rb`,
        `VampireCatalog.annual_drain(${d.standbyW}, ${rate})`,
        `# => { standby_w: ${d.standbyW}, annual_kwh: ${annualKwh.toFixed(1)}, annual_usd: ${annualUsd.toFixed(2)} } }`,
      ].join('\n'),
      meta: [
        { label: 'Standby', value: `${d.standbyW} W` },
        { label: 'Annual kWh', value: annualKwh.toFixed(1) },
        { label: 'Annual cost', value: `$${annualUsd.toFixed(2)}` },
        { label: 'Near-field', value: `${d.emfUt} µT` },
        { label: 'Hum', value: `${d.humHz} Hz` },
        { label: 'Severity', value: d.severity },
      ],
    });
  }
}
