import { Injectable, Signal, computed, signal } from '@angular/core';
import { IndexedDbService } from './indexed-db.service';
import { SupabaseSyncService, SYNC_TABLES } from './supabase-sync.service';
import {
  ROLE_TIERS,
  type FormFactor,
  type GridAudit,
  type Role,
  type SyncQueueEntry,
  type SyncStatus,
  type SmartMeterRead,
  type ThemeKey,
  type Vampire,
  type Verdict,
} from '../models';

export interface PlasmaState {
  /** THD percent, 0..60 */
  thd: number;
  /** magnetic flux density, microtesla */
  fluxUt: number;
  /** measured fundamental, Hz */
  freqHz: number;
  /** sine purity score 0..100 */
  purity: number;
  verdict: Verdict;
  energy: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad';
}

const PREF_KEY = 'voltspectra.prefs.v1';

interface Prefs {
  role: Role;
  theme: ThemeKey;
  formFactor: FormFactor;
}

/**
 * Central reactive store for the whole workstation.  Every hardware sensor,
 * simulator and GraphQL mutation funnels through here, and the GLSL plasma
 * background reads the same signals — one source of truth, no prop drilling.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  /* ------------------------------------------------------------- prefs */
  readonly role = signal<Role>('HOMEOWNER');
  readonly theme = signal<ThemeKey>('obsidian');
  readonly formFactor = signal<FormFactor>('desktop');
  readonly modulePath = signal<string>('');

  /* ------------------------------------------------------------- plasma */
  readonly plasma = signal<PlasmaState>({
    thd: 1.8,
    fluxUt: 2.1,
    freqHz: 60,
    purity: 92,
    verdict: 'PURE_SINE',
    energy: 0.8,
  });

  /* -------------------------------------------------------------- data */
  readonly vampires = signal<Vampire[]>([]);
  readonly audits = signal<GridAudit[]>([]);
  readonly meterReads = signal<SmartMeterRead[]>([]);
  readonly syncQueue = signal<SyncQueueEntry[]>([]);
  readonly ready = signal<boolean>(false);
  readonly online = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

  /* ----------------------------------------------------------- toasts */
  readonly toasts = signal<Toast[]>([]);
  private toastSeq = 1;

  /* --------------------------------------------------------- simulator */
  readonly scenarioId = signal<number>(0);
  readonly simulatorOn = signal<boolean>(false);
  readonly micOn = signal<boolean>(false);
  readonly tariffScheduleId = signal<string>('ca_sou_tou');
  readonly selectedAppliances = signal<Record<string, number>>({});
  readonly meterPulseConstant = signal<number>(1000);
  readonly meterRatePerKwh = signal<number>(0.2);
  readonly blendedRate = signal<number>(0.2);
  readonly panelAmps = signal<number>(100);

  private readonly db: IndexedDbService;
  private readonly cloud: SupabaseSyncService;

  constructor(db: IndexedDbService, cloud: SupabaseSyncService) {
    this.db = db;
    this.cloud = cloud;
  }

  /* ----------------------------------------------------------- derived */

  readonly tier = computed(() => ROLE_TIERS[this.role()].tier);
  readonly hasPro = computed(() => this.tier() >= 2);
  readonly hasAdmin = computed(() => this.tier() >= 3);

  /** Annual dollars saved by unplugging every logged vampire. */
  readonly annualSavings = computed(() =>
    this.vampires().reduce((sum, v) => sum + v.annualCostUsd, 0),
  );
  readonly annualKwhSaved = computed(() =>
    this.vampires().reduce((sum, v) => sum + v.annualKwh, 0),
  );

  /** 0..1 normalisations consumed by the GLSL plasma uniforms. */
  readonly thdNorm = computed(() => Math.min(this.plasma().thd / 40, 1));
  readonly fluxNorm = computed(() => Math.min(this.plasma().fluxUt / 100, 1));
  readonly freqNorm = computed(() =>
    Math.min(Math.max((this.plasma().freqHz - 45) / 25, 0), 1),
  );

  /* -------------------------------------------------------------- init */

  async init(): Promise<void> {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) {
        const prefs = JSON.parse(raw) as Partial<Prefs>;
        if (prefs.role && ROLE_TIERS[prefs.role]) this.role.set(prefs.role);
        if (prefs.theme) this.theme.set(prefs.theme);
        if (prefs.formFactor) this.formFactor.set(prefs.formFactor);
      }
    } catch {
      /* private mode etc. */
    }

    this.ready.set(await this.db.ready());
    if (this.ready()) {
      const [vampires, audits, meterReads, syncQueue] = await Promise.all([
        this.db.allVampires(),
        this.db.allAudits(),
        this.db.allMeterReads(),
        this.db.allSync(),
      ]);
      this.vampires.set(vampires.sort((a, b) => a.addedAt.localeCompare(b.addedAt)));
      this.audits.set(audits.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      this.meterReads.set(meterReads.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      this.syncQueue.set(syncQueue);
    }

    // Resolve cloud credentials now (no-op, and no bundle fetch, when unset).
    await this.cloud.connect();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.online.set(true);
        if (this.cloud.enabled() && this.syncQueue().some((e) => e.status !== 'SYNCED')) {
          void this.flushSync();
        }
      });
      window.addEventListener('offline', () => this.online.set(false));
    }
  }

  private persistPrefs(): void {
    try {
      const prefs: Prefs = {
        role: this.role(),
        theme: this.theme(),
        formFactor: this.formFactor(),
      };
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------- prefs */

  setRole(role: Role): void {
    this.role.set(role);
    this.persistPrefs();
    this.toast(`Privilege tier: ${ROLE_TIERS[role].label}`, 'info');
  }

  setTheme(theme: ThemeKey): void {
    this.theme.set(theme);
    this.persistPrefs();
  }

  setFormFactor(formFactor: FormFactor): void {
    this.formFactor.set(formFactor);
    this.persistPrefs();
  }

  setModule(path: string): void {
    this.modulePath.set(path);
  }

  /* ------------------------------------------------------------ plasma */

  updatePlasma(patch: Partial<PlasmaState>): void {
    this.plasma.update((p) => ({ ...p, ...patch }));
  }

  /* ------------------------------------------------------------ toasts */

  toast(text: string, tone: Toast['tone'] = 'info'): void {
    const id = this.toastSeq++;
    this.toasts.update((list) => [...list, { id, text, tone }]);
    setTimeout(() => {
      this.toasts.update((list) => list.filter((t) => t.id !== id));
    }, 4200);
  }

  /* ---------------------------------------------------------- vampires */

  async addVampire(
    v: Omit<Vampire, 'id' | 'addedAt' | 'synced' | 'annualKwh' | 'annualCostUsd'>,
  ): Promise<Vampire> {
    const row: Vampire = {
      ...v,
      annualKwh: (v.standbyWatts * 8760) / 1000,
      annualCostUsd: ((v.standbyWatts * 8760) / 1000) * this.blendedRate(),
      id: crypto.randomUUID(),
      addedAt: new Date().toISOString(),
      synced: 'PENDING',
    };
    this.vampires.update((list) => [...list, row]);
    await this.db.putVampire(row);
    await this.enqueue('addVampireAppliance', 'VampireAppliance', row as unknown as Record<string, unknown>);
    this.toast(`Kill-List + $${row.annualCostUsd.toFixed(0)}/yr — ${row.name}`, 'good');
    return row;
  }

  async removeVampire(id: string): Promise<void> {
    const row = this.vampires().find((v) => v.id === id);
    this.vampires.update((list) => list.filter((v) => v.id !== id));
    await this.db.removeVampire(id);
    if (row) {
      await this.enqueue('removeVampireAppliance', 'VampireAppliance', { id } as Record<string, unknown>);
    }
  }

  /* ------------------------------------------------------------ audits */

  async recordAudit(a: Omit<GridAudit, 'id' | 'createdAt' | 'synced'>): Promise<GridAudit> {
    const row: GridAudit = {
      ...a,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      synced: 'PENDING',
    };
    this.audits.update((list) => [row, ...list]);
    await this.db.putAudit(row);
    await this.enqueue('recordGridAudit', 'GridAudit', row as unknown as Record<string, unknown>);
    return row;
  }

  /* -------------------------------------------------------- meter reads */

  async recordMeterRead(r: Omit<SmartMeterRead, 'id' | 'createdAt' | 'synced'>): Promise<SmartMeterRead> {
    const row: SmartMeterRead = {
      ...r,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      synced: 'PENDING',
    };
    this.meterReads.update((list) => [row, ...list]);
    await this.db.putMeterRead(row);
    await this.enqueue('recordSmartMeterRead', 'SmartMeterRead', row as unknown as Record<string, unknown>);
    return row;
  }

  /* --------------------------------------------------------- sync queue */

  async enqueue(operation: string, typename: string, payload: Record<string, unknown>): Promise<void> {
    const entry: SyncQueueEntry = {
      id: crypto.randomUUID(),
      operation,
      typename,
      payload,
      status: 'PENDING',
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    this.syncQueue.update((list) => [...list, entry]);
    await this.db.putSync(entry);
  }

  async flushSync(): Promise<void> {
    const pending = this.syncQueue().filter((e) => e.status !== 'SYNCED');
    if (pending.length === 0) {
      this.toast('Sync queue already empty', 'info');
      return;
    }
    if (!this.online()) {
      this.toast(`${pending.length} record(s) queued — device is offline`, 'warn');
      return;
    }

    // Cloud-first: a configured Supabase project receives the queue.
    const outcome = await this.cloud.push(
      pending.map((entry) => ({ typename: entry.typename, payload: entry.payload })),
    );

    if (outcome.pushed > 0) {
      const pushedIds = new Set(
        pending
          .filter((entry) => !!this.cloudTableFor(entry.typename))
          .slice(0, outcome.pushed)
          .map((entry) => entry.id),
      );
      for (const entry of pending) {
        const done: SyncQueueEntry = {
          ...entry,
          status: pushedIds.has(entry.id) ? 'SYNCED' : 'FAILED',
          attempts: entry.attempts + 1,
        };
        this.syncQueue.update((list) => list.map((e) => (e.id === done.id ? done : e)));
        await this.db.updateSync(done);
      }
      this.toast(`${outcome.message} — queue reconciled`, 'good');
      await this.refreshSyncBadges();
      return;
    }

    if (outcome.failed > 0 && this.cloud.enabled()) {
      for (const entry of pending) {
        const failed: SyncQueueEntry = { ...entry, status: 'FAILED', attempts: entry.attempts + 1 };
        this.syncQueue.update((list) => list.map((e) => (e.id === failed.id ? failed : e)));
        await this.db.updateSync(failed);
      }
      this.toast(outcome.message, 'bad');
      await this.refreshSyncBadges();
      return;
    }

    // No credentials (local dev / offline APK): replay locally as before.
    for (const entry of pending) {
      const done: SyncQueueEntry = { ...entry, status: 'SYNCED', attempts: entry.attempts + 1 };
      this.syncQueue.update((list) => list.map((e) => (e.id === done.id ? done : e)));
      await this.db.updateSync(done);
    }
    this.toast(
      `Offline-first replay: ${pending.length} record(s) marked synced locally` +
        (this.cloud.enabled() ? '' : ' (no Supabase credentials)'),
      'good',
    );
    await this.refreshSyncBadges();
  }

  private cloudTableFor(typename: string): string | null {
    return (SYNC_TABLES as Record<string, string>)[typename] ?? null;
  }

  /** Keep the per-record `synced` badge in step with the sync queue. */
  private async refreshSyncBadges(): Promise<void> {
    const synced = new Set(
      this.syncQueue()
        .filter((e) => e.status === 'SYNCED')
        .map((e) => String(e.payload['id'] ?? '')),
    );
    const apply = <T extends { id: string; synced: SyncStatus }>(rows: T[]): T[] =>
      rows.map((row) => (synced.has(row.id) ? { ...row, synced: 'SYNCED' } : row));
    this.vampires.update(apply);
    this.audits.update(apply);
    this.meterReads.update(apply);
  }

  async clearSyncQueue(): Promise<void> {
    this.syncQueue.set([]);
    await this.db.clearSync();
  }

  /* ------------------------------------------------------------ export */

  async exportTelemetry(): Promise<string> {
    const data = this.ready() ? await this.db.exportAll() : { vampires: this.vampires(), audits: this.audits() };
    return JSON.stringify(data, null, 2);
  }
}
