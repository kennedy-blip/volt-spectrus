import { Injectable, Signal, computed, signal } from '@angular/core';
import type {
  Appliance,
  HarmonicCompliance,
  PanelCheck,
  TariffSlot,
  Vampire,
} from '../models';

export interface Tier {
  name: string;
  from: number;
  to: number;
  ratePerKwh: number;
}

export interface TariffSchedule {
  id: string;
  name: string;
  currency: string;
  blendedRate: number;
  tiers: Tier[];
}

export interface ArbitrageRow {
  id: string;
  name: string;
  kw: number;
  hours: number;
  fromHour: number;
  toHour: number;
  shiftable: boolean;
  baselineUsd: number;
  shiftedUsd: number;
  savingsUsd: number;
}

export interface ArbitrageReport {
  schedule: string;
  currency: string;
  perAppliance: ArbitrageRow[];
  baselineDailyUsd: number;
  shiftedDailyUsd: number;
  savingsDailyUsd: number;
  savingsMonthlyUsd: number;
  savingsAnnualUsd: number;
}

/**
 * TypeScript mirror of api/tariff_auditor.rb.
 *
 * The Ruby file is the canonical serverless/CLI engine; this port lets the
 * Angular UI compute the identical TOU arbitrage, vampire-drain and IEEE 519
 * figures offline.  Keep the two in sync (see scripts/test-bridge-parity.mjs
 * for the DSP equivalent).
 */
@Injectable({ providedIn: 'root' })
export class TariffEngineService {
  /* ------------------------------------------------- offline tariff mirror */

  readonly schedules: Record<string, TariffSchedule> = {
    ca_sou_tou: {
      id: 'ca_sou_tou',
      name: 'CA Solar & Storage TOU (Off 0.12 / Mid 0.24 / Surge 0.52)',
      currency: 'USD',
      blendedRate: 0.2,
      tiers: [
        { name: 'Off-Peak', from: 23, to: 6, ratePerKwh: 0.12 },
        { name: 'Mid-Peak', from: 6, to: 16, ratePerKwh: 0.24 },
        { name: 'Surge Peak', from: 16, to: 21, ratePerKwh: 0.52 },
        { name: 'Mid-Peak', from: 21, to: 23, ratePerKwh: 0.24 },
      ],
    },
    kenya_power_tou: {
      id: 'kenya_power_tou',
      name: 'Kenya Power TOU (representative mirror, Meru region)',
      currency: 'KES',
      blendedRate: 20,
      tiers: [
        { name: 'Off-Peak', from: 23, to: 6, ratePerKwh: 12 },
        { name: 'Mid-Peak', from: 6, to: 16, ratePerKwh: 24 },
        { name: 'Surge Peak', from: 16, to: 21, ratePerKwh: 52 },
        { name: 'Mid-Peak', from: 21, to: 23, ratePerKwh: 24 },
      ],
    },
  };

  readonly appliances: Appliance[] = [
    { id: 'ev', name: 'EV Charger', kw: 7.2, hours: 4, startHour: 17, shiftable: true },
    { id: 'dryer', name: 'Electric Clothes Dryer', kw: 4.5, hours: 1, startHour: 18, shiftable: true },
    { id: 'dishwasher', name: 'Dishwasher', kw: 1.8, hours: 2, startHour: 19, shiftable: true },
    { id: 'pool', name: 'Pool Pump', kw: 2.2, hours: 6, startHour: 15, shiftable: true },
    { id: 'heater', name: 'Space Heater', kw: 1.5, hours: 5, startHour: 17, shiftable: true },
  ];

  private readonly vampireMirror = [
    { id: 'console', name: 'Gaming Console in Instant-On Standby', location: 'Living room media shelf', standbyW: 42, emfUt: 38.5, humHz: 120, severity: 'VAMPIRE' as const },
    { id: 'dvr', name: 'Old Cable/DVR Box', location: 'TV stand', standbyW: 35, emfUt: 27.2, humHz: 120, severity: 'VAMPIRE' as const },
    { id: 'wallwart', name: 'Hot Failing Wall-Wart Transformer', location: 'Hallway outlet', standbyW: 18, emfUt: 64.1, humHz: 100, severity: 'FIRE' as const },
    { id: 'strip', name: 'Smart Power Strip in Eco-Cutoff', location: 'Office desk', standbyW: 0.4, emfUt: 2.1, humHz: 0, severity: 'CLEAN' as const },
  ];

  readonly activeScheduleId = signal<string>('ca_sou_tou');
  readonly schedule: Signal<TariffSchedule> = computed(
    () => this.schedules[this.activeScheduleId()] ?? this.schedules['ca_sou_tou'],
  );

  /* -------------------------------------------------------------- engine */

  tierAt(scheduleId: string, hour: number): Tier | undefined {
    const h = ((hour % 24) + 24) % 24;
    const sched = this.schedules[scheduleId] ?? this.schedules['ca_sou_tou'];
    return sched.tiers.find((t) =>
      t.from < t.to ? h >= t.from && h < t.to : h >= t.from || h < t.to,
    );
  }

  rateAt(scheduleId: string, hour: number): number {
    return this.tierAt(scheduleId, hour)?.ratePerKwh ?? this.schedule().blendedRate;
  }

  touCurve(scheduleId?: string): TariffSlot[] {
    const id = scheduleId ?? this.activeScheduleId();
    const slots: TariffSlot[] = [];
    for (let hour = 0; hour < 24; hour++) {
      slots.push({
        hour,
        rate: this.rateAt(id, hour),
        tier: this.tierAt(id, hour)?.name ?? 'Flat',
      });
    }
    return slots;
  }

  energyCost(scheduleId: string, kw: number, hours: number, startHour: number): number {
    let total = 0;
    for (let i = 0; i < hours; i++) {
      total += kw * this.rateAt(scheduleId, (startHour + i) % 24);
    }
    return total;
  }

  arbitrage(appliances: Appliance[], shifts: Record<string, number>, scheduleId?: string): ArbitrageReport {
    const id = scheduleId ?? this.activeScheduleId();
    const sched = this.schedules[id] ?? this.schedules['ca_sou_tou'];
    const rows: ArbitrageRow[] = appliances.map((app) => {
      const baseline = this.energyCost(id, app.kw, app.hours, app.startHour);
      const target = shifts[app.id] ?? app.startHour;
      const shifted = app.shiftable ? this.energyCost(id, app.kw, app.hours, target) : baseline;
      return {
        id: app.id,
        name: app.name,
        kw: app.kw,
        hours: app.hours,
        fromHour: app.startHour,
        toHour: target,
        shiftable: app.shiftable,
        baselineUsd: round2(baseline),
        shiftedUsd: round2(shifted),
        savingsUsd: round2(baseline - shifted),
      };
    });

    const baseline = round2(rows.reduce((s, r) => s + r.baselineUsd, 0));
    const shifted = round2(rows.reduce((s, r) => s + r.shiftedUsd, 0));
    const daily = round2(baseline - shifted);
    return {
      schedule: sched.name,
      currency: sched.currency,
      perAppliance: rows,
      baselineDailyUsd: baseline,
      shiftedDailyUsd: shifted,
      savingsDailyUsd: daily,
      savingsMonthlyUsd: round2(daily * 30),
      savingsAnnualUsd: round2(daily * 365),
    };
  }

  autoShift(appliances: Appliance[], scheduleId?: string): Record<string, number> {
    const id = scheduleId ?? this.activeScheduleId();
    const shifts: Record<string, number> = {};
    for (const app of appliances) {
      if (!app.shiftable) continue;
      let bestStart = app.startHour;
      let bestCost = this.energyCost(id, app.kw, app.hours, app.startHour);
      for (let start = 0; start < 24; start++) {
        const cost = this.energyCost(id, app.kw, app.hours, start);
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          bestStart = start;
        }
      }
      shifts[app.id] = bestStart;
    }
    return shifts;
  }

  panelHeadroom(panelAmps: number, voltage: number, concurrentKw: number): PanelCheck {
    const capacityKw = (panelAmps * voltage) / 1000;
    return {
      panelAmps,
      voltage,
      capacityKw: round2(capacityKw),
      concurrentKw: round2(concurrentKw),
      headroomKw: round2(capacityKw - concurrentKw),
      loadPercent: round1((concurrentKw / capacityKw) * 100),
      trips: concurrentKw > capacityKw * 0.8,
    };
  }

  /* ------------------------------------------------------------- vampires */

  vampireSweep(blendedRate?: number): Vampire[] {
    const rate = blendedRate ?? this.schedule().blendedRate;
    return this.vampireMirror.map((v) => {
      const annualKwh = (v.standbyW * 8760) / 1000;
      return {
        id: v.id,
        name: v.name,
        location: v.location,
        standbyWatts: v.standbyW,
        annualKwh: round1(annualKwh),
        annualCostUsd: round2(annualKwh * rate),
        emfUt: v.emfUt,
        humHz: v.humHz,
        severity: v.severity,
        addedAt: '',
        synced: 'PENDING',
      };
    });
  }

  /* ------------------------------------------------------------- IEEE 519 */

  ieee519(
    thdPercent: number,
    harmonics: number[],
    bus = '<69kV',
    iscOverIl = 50,
  ): HarmonicCompliance {
    const vlim =
      bus === '69-161kV'
        ? { thd: 2.5, individual: 1.5 }
        : bus === '>161kV'
          ? { thd: 1.5, individual: 1.0 }
          : { thd: 5.0, individual: 3.0 };
    const ilim =
      iscOverIl < 20 ? 4.0 : iscOverIl < 50 ? 6.0 : iscOverIl < 100 ? 10.0 : iscOverIl < 1000 ? 12.0 : 15.0;

    let worst = 1;
    let worstPct = 0;
    harmonics.forEach((pct, i) => {
      if (pct > worstPct) {
        worstPct = pct;
        worst = i + 1;
      }
    });

    const voltageCompliant = thdPercent <= vlim.thd;
    const individualCompliant = worstPct <= vlim.individual;
    const currentCompliant = thdPercent <= ilim;
    return {
      bus,
      thdPercent: round3(thdPercent),
      voltageThdLimit: vlim.thd,
      voltageCompliant,
      worstHarmonic: worst,
      individualLimit: vlim.individual,
      individualCompliant,
      currentTddLimit: ilim,
      currentCompliant,
      compliant: voltageCompliant && individualCompliant && currentCompliant,
    };
  }

  setSchedule(id: string): void {
    if (this.schedules[id]) this.activeScheduleId.set(id);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
