import { computed, inject, signal } from '@angular/core';
import { Component } from '@angular/core';
import { AnalogGaugeComponent } from '../../components/analog-gauge/analog-gauge.component';
import { TelemetryService } from '../../services/telemetry.service';
import { TariffEngineService } from '../../services/tariff-engine.service';
import { UiStateService } from '../../services/ui-state.service';
import { RUBY_TARIFF_SOURCE } from '../../../generated/embedded-sources';

const TIER_COLOR: Record<string, string> = {
  'Off-Peak': 'var(--emerald)',
  'Mid-Peak': 'var(--cyan)',
  'Surge Peak': 'var(--crimson)',
};

/**
 * Time-of-Use peak arbitrage + breaker load sizer, powered by the Ruby 3.3
 * tariff engine (TypeScript mirror; the canonical source is embedded for the
 * Polyglot Vault).
 */
@Component({
  selector: 'vs-tariff-auditor',
  standalone: true,
  imports: [AnalogGaugeComponent],
  template: `
    <section class="module">
      <div class="module-head">
        <div>
          <h2>Ruby TOU Tariff Auditor</h2>
          <p class="lede">
            Drag heavy loads out of the 4–9 PM surge window into the green off-peak valley and
            watch the annual arbitrage savings — then verify the concurrent load against a
            100 A / 200 A main panel.
          </p>
        </div>
        <div class="spacer"></div>
        <div class="row">
          <button class="chip" [class.active]="scheduleId() === 'ca_sou_tou'" (click)="setSchedule('ca_sou_tou')">🇺🇸 CA TOU</button>
          <button class="chip" [class.active]="scheduleId() === 'kenya_power_tou'" (click)="setSchedule('kenya_power_tou')">🇰🇪 Kenya Power</button>
          <button class="btn btn-primary" (click)="autoShift()">⇤ Auto-shift to off-peak</button>
        </div>
      </div>

      <div class="grid grid-3 mb">
        <div class="glass glass-pad" style="grid-column: span 2">
          <div class="row" style="justify-content:space-between">
            <div class="section-title" style="margin:0">24-hour Time-of-Use rate curve</div>
            <div class="row">
              <span class="badge good">Off {{ '$' }}{{ offRate().toFixed(2) }}</span>
              <span class="badge info">Mid</span>
              <span class="badge bad">Surge</span>
            </div>
          </div>
          <div class="row mt" style="align-items:flex-end;gap:3px;height:170px">
            @for (slot of curve(); track slot.hour) {
              <div class="col" style="flex:1;align-items:center;gap:6px;height:100%">
                <span class="mono faint" style="font-size:9px">{{ slot.rate.toFixed(2) }}</span>
                <div style="width:100%;border-radius:6px 6px 3px 3px;height:{{ barHeight(slot.rate) }}%;
                            background:linear-gradient(180deg, {{ tierColor(slot.tier) }}, color-mix(in srgb, {{ tierColor(slot.tier) }} 45%, transparent));
                            transition:height 0.4s var(--ease-out)"></div>
                <span class="mono faint" style="font-size:9px">{{ slot.hour % 3 === 0 ? slot.hour : '' }}</span>
              </div>
            }
          </div>
          <p class="hint mt">Red surge window 16:00–21:00 · green off-peak 23:00–06:00</p>
        </div>

        <div class="glass glass-pad col">
          <div class="section-title">Arbitrage savings</div>
          <div class="stat-row">
            <div class="stat"><div class="label">Daily</div><div class="value">{{ report().savingsDailyUsd.toFixed(2) }}</div></div>
            <div class="stat"><div class="label">Monthly</div><div class="value good">{{ report().savingsMonthlyUsd.toFixed(0) }}</div></div>
            <div class="stat"><div class="label">Annual</div><div class="value good" style="font-size:22px">{{ '$' }}{{ report().savingsAnnualUsd.toFixed(0) }}</div></div>
          </div>
          <div class="divider"></div>
          <div class="row" style="justify-content:space-between">
            <span class="faint" style="font-size:11px">BASELINE</span>
            <span class="mono">{{ '$' }}{{ report().baselineDailyUsd.toFixed(2) }}/day</span>
          </div>
          <div class="row" style="justify-content:space-between">
            <span class="faint" style="font-size:11px">SHIFTED</span>
            <span class="mono good">{{ '$' }}{{ report().shiftedDailyUsd.toFixed(2) }}/day</span>
          </div>
          <button class="btn mt" (click)="openRuby()">📐 Ruby 3.3 engine blueprint</button>
        </div>
      </div>

      <div class="grid grid-3 mb">
        <div class="glass glass-pad" style="grid-column: span 2">
          <div class="section-title">Shiftable appliance scheduler</div>
          <div class="col">
            @for (row of rows(); track row.id) {
              <div class="appliance" [class.selected]="isSelected(row.id)" (click)="toggle(row.id)">
                <div class="grow">
                  <div class="name">{{ row.name }}</div>
                  <div class="meta">{{ row.kw }} kW · {{ row.hours }} h · now {{ row.fromHour }}:00 → {{ row.toHour }}:00</div>
                </div>
                <div class="col" style="gap:2px;min-width:150px" (click)="$event.stopPropagation()">
                  <input type="range" min="0" max="23" [value]="row.toHour" (input)="shift(row.id, +$any($event.target).value)" [disabled]="!isSelected(row.id)" />
                  <div class="row" style="justify-content:space-between">
                    <span class="mono faint" style="font-size:10px">{{ tierAt(row.toHour) }}</span>
                    <span class="mono" style="font-size:10.5px" [class.good]="row.savingsUsd > 0">+{{ '$' }}{{ row.savingsUsd.toFixed(2) }}</span>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>

        <div class="glass glass-pad col">
          <div class="section-title">Breaker panel load-sizing</div>
          <div class="row">
            <button class="chip" [class.active]="panelAmps() === 100" (click)="panelAmps.set(100)">100 A</button>
            <button class="chip" [class.active]="panelAmps() === 200" (click)="panelAmps.set(200)">200 A</button>
          </div>
          <vs-gauge [value]="panel().loadPercent" [min]="0" [max]="120" label="load" unit="%" [decimals]="0"
            [zones]="[{to: 60, color: 'var(--emerald)'}, {to: 80, color: 'var(--amber)'}, {to: 120, color: 'var(--crimson)'}]" />
          <div class="stat-row">
            <div class="stat"><div class="label">Capacity</div><div class="value small">{{ panel().capacityKw.toFixed(1) }} kW</div></div>
            <div class="stat"><div class="label">Concurrent</div><div class="value small">{{ panel().concurrentKw.toFixed(1) }} kW</div></div>
            <div class="stat"><div class="label">Headroom</div><div class="value small">{{ panel().headroomKw.toFixed(1) }} kW</div></div>
          </div>
          <span class="badge" [class.bad]="panel().trips" [class.good]="!panel().trips">
            {{ panel().trips ? '⚠ BREAKER TRIP RISK (>80% continuous)' : 'WITHIN 80% CONTINUOUS LIMIT' }}
          </span>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="glass glass-pad">
          <div class="section-title">IEEE 519 harmonic compliance (current audit)</div>
          <div class="stat-row">
            <div class="stat"><div class="label">THD</div><div class="value">{{ compliance().thdPercent.toFixed(2) }}%</div></div>
            <div class="stat"><div class="label">Voltage limit</div><div class="value small">{{ compliance().voltageThdLimit }}%</div></div>
            <div class="stat"><div class="label">Worst harmonic</div><div class="value small">#{{ compliance().worstHarmonic }}</div></div>
            <div class="stat"><div class="label">Verdict</div><div class="value small" [class.good]="compliance().compliant" [class.bad]="!compliance().compliant">{{ compliance().compliant ? 'COMPLIANT' : 'EXCEEDS' }}</div></div>
          </div>
        </div>

        <div class="glass glass-pad">
          <div class="section-title">Ruby vampire-drain mirror</div>
          <div class="scroll-x">
            <table class="table">
              <thead><tr><th>Appliance</th><th>W</th><th>kWh/yr</th><th>$/yr</th><th>µT</th></tr></thead>
              <tbody>
                @for (v of vampireMirror(); track v.id) {
                  <tr>
                    <td>{{ v.name }}</td>
                    <td class="mono">{{ v.standbyWatts }}</td>
                    <td class="mono">{{ v.annualKwh.toFixed(0) }}</td>
                    <td class="mono good">{{ '$' }}{{ v.annualCostUsd.toFixed(0) }}</td>
                    <td class="mono">{{ v.emfUt }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class TariffAuditorComponent {
  private readonly telemetry = inject(TelemetryService);
  private readonly tariff = inject(TariffEngineService);
  private readonly ui = inject(UiStateService);

  readonly scheduleId = signal('ca_sou_tou');
  readonly shifts = signal<Record<string, number>>({});
  readonly selected = signal<Record<string, boolean>>({
    ev: true, dryer: true, dishwasher: true, pool: true, heater: true,
  });
  readonly panelAmps = signal(100);

  readonly curve = computed(() => this.tariff.touCurve(this.scheduleId()));
  readonly report = computed(() =>
    this.tariff.arbitrage(
      this.tariff.appliances.filter((a) => this.selected()[a.id]),
      this.shifts(),
      this.scheduleId(),
    ),
  );
  readonly rows = computed(() => this.report().perAppliance);
  readonly concurrentKw = computed(() =>
    this.tariff.appliances.filter((a) => this.selected()[a.id]).reduce((s, a) => s + a.kw, 0),
  );
  readonly panel = computed(() =>
    this.tariff.panelHeadroom(this.panelAmps(), 240, this.concurrentKw()),
  );
  readonly vampireMirror = computed(() => this.tariff.vampireSweep());
  readonly compliance = computed(() => {
    const audit = this.telemetry.audits()[0];
    const harmonics = audit?.harmonicPercent ?? [100, 0, 0, 0, 0, 0, 0, 0, 0];
    return this.tariff.ieee519(audit?.thdPercent ?? 0, harmonics);
  });

  readonly maxRate = computed(() => Math.max(...this.curve().map((s) => s.rate), 0.01));
  readonly offRate = computed(() => this.tariff.tierAt(this.scheduleId(), 2)?.ratePerKwh ?? 0.12);

  barHeight(rate: number): number {
    return Math.max(3, (rate / this.maxRate()) * 100);
  }

  tierColor(tier: string): string {
    return TIER_COLOR[tier] ?? 'var(--cyan)';
  }

  tierAt(hour: number): string {
    return this.tariff.tierAt(this.scheduleId(), hour)?.name ?? 'Flat';
  }

  setSchedule(id: string): void {
    this.scheduleId.set(id);
    this.tariff.setSchedule(id);
    this.telemetry.blendedRate.set(this.tariff.schedules[id]?.blendedRate ?? 0.2);
    this.shifts.set({});
  }

  isSelected(id: string): boolean {
    return !!this.selected()[id];
  }

  toggle(id: string): void {
    this.selected.update((s) => ({ ...s, [id]: !s[id] }));
  }

  shift(id: string, hour: number): void {
    this.shifts.update((s) => ({ ...s, [id]: hour }));
  }

  autoShift(): void {
    const shifts = this.tariff.autoShift(
      this.tariff.appliances.filter((a) => this.selected()[a.id]),
      this.scheduleId(),
    );
    this.shifts.set(shifts);
    this.telemetry.toast('Loads shifted into the off-peak valley', 'good');
  }

  openRuby(): void {
    const r = this.report();
    this.ui.openBlueprint({
      title: 'Ruby 3.3 · tariff_auditor.rb',
      subtitle: 'Time-of-Use arbitrage engine — canonical serverless/CLI source',
      language: 'Ruby',
      source: RUBY_TARIFF_SOURCE,
      meta: [
        { label: 'Schedule', value: r.schedule },
        { label: 'Daily savings', value: `$${r.savingsDailyUsd.toFixed(2)}` },
        { label: 'Monthly', value: `$${r.savingsMonthlyUsd.toFixed(2)}` },
        { label: 'Annual', value: `$${r.savingsAnnualUsd.toFixed(2)}` },
        { label: 'Panel', value: `${this.panel().panelAmps} A · ${this.panel().loadPercent.toFixed(0)}%` },
      ],
    });
  }
}
