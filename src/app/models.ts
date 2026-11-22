/** Shared VOLT-SPECTRA domain models (mirrors the GraphQL SDL). */

export type Role = 'HOMEOWNER' | 'MASTER_ELECTRICIAN' | 'GRID_SYSTEMS_DIRECTOR';
export type NominalGrid = 50 | 60;
export type ThemeKey = 'obsidian' | 'daylight' | 'amber' | 'eco';
export type FormFactor = 'desktop' | 'mobile';
export type Severity = 'CLEAN' | 'VAMPIRE' | 'FIRE';
export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED';
export type Verdict = 'PURE_SINE' | 'ACCEPTABLE' | 'DIRTY_POWER' | 'DANGER';

export const ROLE_TIERS: Record<Role, { tier: number; label: string; blurb: string }> = {
  HOMEOWNER: {
    tier: 1,
    label: 'Homeowner & Renter',
    blurb: 'EMF Vampire Hunter, Grid Purity Scanner, Optical Tachometer, TOU Bill Reducer.',
  },
  MASTER_ELECTRICIAN: {
    tier: 2,
    label: 'Master Electrician Pro',
    blurb: 'Odd-harmonic spectrum (1st–9th), IEEE 519 THD synthesizer, 100 A / 200 A breaker load balancer.',
  },
  GRID_SYSTEMS_DIRECTOR: {
    tier: 3,
    label: 'Grid Systems Director',
    blurb: 'GraphQL console, 5-language polyglot inspector, CSV/JSON exporter, IndexedDB cloud-sync controller.',
  },
};

export interface Vampire {
  id: string;
  name: string;
  location: string;
  standbyWatts: number;
  annualKwh: number;
  annualCostUsd: number;
  emfUt: number;
  humHz: number;
  severity: Severity;
  addedAt: string;
  synced: SyncStatus;
}

export interface GridAudit {
  id: string;
  frequencyHz: number;
  thdPercent: number;
  crestFactor: number;
  purityScore: number;
  snrDb: number;
  nominalHz: number;
  verdict: Verdict;
  verdictText: string;
  harmonics: number[];
  harmonicPercent: number[];
  source: string;
  createdAt: string;
  synced: SyncStatus;
}

export interface SmartMeterRead {
  id: string;
  pulseConstant: number;
  pulseConstantUnit: string;
  intervalSeconds: number;
  powerW: number;
  powerKw: number;
  costPerHourUsd: number;
  projectedMonthlyUsd: number;
  mode: string;
  createdAt: string;
  synced: SyncStatus;
}

export interface SyncQueueEntry {
  id: string;
  operation: string;
  typename: string;
  payload: Record<string, unknown>;
  status: SyncStatus;
  attempts: number;
  createdAt: string;
}

export interface TariffSlot {
  hour: number;
  rate: number;
  tier: string;
}

export interface Appliance {
  id: string;
  name: string;
  kw: number;
  hours: number;
  startHour: number;
  shiftable: boolean;
}

export interface HarmonicCompliance {
  bus: string;
  thdPercent: number;
  voltageThdLimit: number;
  voltageCompliant: boolean;
  worstHarmonic: number;
  individualLimit: number;
  individualCompliant: boolean;
  currentTddLimit: number;
  currentCompliant: boolean;
  compliant: boolean;
}

export interface PanelCheck {
  panelAmps: number;
  voltage: number;
  capacityKw: number;
  concurrentKw: number;
  headroomKw: number;
  loadPercent: number;
  trips: boolean;
}

export type PermissionKey = 'microphone' | 'magnetometer' | 'camera' | 'haptics';
export type PermissionState = 'ACTIVE' | 'SIMULATOR ACTIVE' | 'RESTRICTED' | 'UNSUPPORTED';

export interface ModuleMeta {
  path: string;
  label: string;
  short: string;
  icon: string;
  blurb: string;
  minRole: Role;
}
