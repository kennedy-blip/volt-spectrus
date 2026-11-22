import { Injectable, signal } from '@angular/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/** GraphQL type name → Supabase table. Kept in lockstep with the SDL + migration. */
export const SYNC_TABLES = {
  VampireAppliance: 'vampire_appliances',
  GridAudit: 'grid_audits',
  SmartMeterRead: 'smart_meter_reads',
} as const;

export type SyncableTypename = keyof typeof SYNC_TABLES;

export interface PushOutcome {
  pushed: number;
  failed: number;
  message: string;
}

/** Payload shapes accepted by {@link SYNC_TABLES}. */
interface CloudRow {
  id: string;
  [key: string]: unknown;
}

/**
 * Cloud sync for the offline-first IndexedDB mirror.
 *
 * The client is loaded with a dynamic `import()` so `supabase-js` stays out of
 * the main bundle (it is only fetched when a deployment actually has
 * credentials).  When no URL/anon key is configured — the default for a local
 * `npm run dev` or an APK built from a clean checkout — the service reports
 * `enabled === false` and {@link TelemetryService.flushSync} falls back to the
 * local replay it always had.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseSyncService {
  /** True only when both a URL and an anon key resolved. */
  readonly enabled = signal(false);
  readonly pushing = signal(false);
  readonly lastSyncAt = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly remoteCount = signal<number | null>(null);

  private client: SupabaseClient | null = null;
  private projectUrl: string | null = null;
  private anonKey: string | null = null;

  /** Project URL when linked, otherwise `null`. Never exposes the anon key. */
  get url(): string | null {
    return this.projectUrl;
  }

  /* ------------------------------------------------------------ config */

  /** Resolve credentials: runtime window config wins over the build env. */
  resolveConfig(): { url: string; anonKey: string } | null {
    const runtime =
      typeof window !== 'undefined' && window.__VOLT_CONFIG__
        ? window.__VOLT_CONFIG__
        : undefined;
    const url = (runtime?.supabaseUrl || environment.supabaseUrl || '').trim();
    const anonKey = (runtime?.supabaseAnonKey || environment.supabaseAnonKey || '').trim();
    if (!url || !anonKey) return null;
    return { url, anonKey };
  }

  /** Lazily construct the client. Safe to call on every flush. */
  async connect(): Promise<SupabaseClient | null> {
    if (this.client) return this.client;
    const cfg = this.resolveConfig();
    if (!cfg) {
      this.enabled.set(false);
      return null;
    }
    try {
      const { createClient } = await import('@supabase/supabase-js');
      this.client = createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        db: { schema: 'public' },
      });
      this.projectUrl = cfg.url;
      this.anonKey = cfg.anonKey;
      this.enabled.set(true);
      return this.client;
    } catch (err) {
      this.enabled.set(false);
      this.lastError.set(`Supabase client unavailable: ${describe(err)}`);
      console.warn('[SupabaseSync]', this.lastError());
      return null;
    }
  }

  /* -------------------------------------------------------------- push */

  /**
   * Push a batch of offline rows, one `INSERT ... ON CONFLICT DO UPDATE` per
   * table.  Returns how many rows actually landed.
   */
  async push(rows: { typename: string; payload: Record<string, unknown> }[]): Promise<PushOutcome> {
    const client = await this.connect();
    if (!client) {
      return {
        pushed: 0,
        failed: rows.length,
        message: 'No Supabase credentials configured — staying offline-first.',
      };
    }

    const byTable = new Map<string, CloudRow[]>();
    for (const row of rows) {
      const table = this.tableFor(row.typename);
      if (!table) continue;
      const list = byTable.get(table) ?? [];
      list.push(sanitize(row.payload));
      byTable.set(table, list);
    }

    let pushed = 0;
    let failed = 0;
    this.pushing.set(true);
    try {
      for (const [table, values] of byTable) {
        if (values.length === 0) continue;
        const { error } = await client.from(table).upsert(values, { onConflict: 'id' });
        if (error) {
          failed += values.length;
          this.lastError.set(`${table}: ${error.message}`);
          console.warn('[SupabaseSync] upsert failed', table, error.message);
        } else {
          pushed += values.length;
        }
      }
      if (failed === 0) {
        this.lastSyncAt.set(new Date().toISOString());
        this.lastError.set(null);
      }
      return {
        pushed,
        failed,
        message:
          failed === 0
            ? `Pushed ${pushed} row(s) to ${this.projectUrl}`
            : `Pushed ${pushed}, rejected ${failed}`,
      };
    } finally {
      this.pushing.set(false);
    }
  }

  /* --------------------------------------------------------------- pull */

  /** Pull a table back down into the local mirror. Used by "sync now". */
  async pull(table: SyncableTypename, limit = 200): Promise<CloudRow[]> {
    const client = await this.connect();
    if (!client) return [];
    const { data, error } = await client
      .from(SYNC_TABLES[table])
      .select('*')
      .order('synced_at', { ascending: false })
      .limit(limit);
    if (error) {
      this.lastError.set(`${SYNC_TABLES[table]}: ${error.message}`);
      return [];
    }
    this.remoteCount.set(data?.length ?? 0);
    return (data ?? []) as CloudRow[];
  }

  /** Cheap reachability probe used by the GraphQL vault diagnostics. */
  async ping(): Promise<{ ok: boolean; message: string }> {
    const client = await this.connect();
    if (!client) {
      return { ok: false, message: 'Not configured — offline-first mode' };
    }
    const { error } = await client.from('grid_audits').select('id', { head: true, count: 'exact' });
    if (error) {
      this.lastError.set(error.message);
      return { ok: false, message: error.message };
    }
    return { ok: true, message: 'Connected' };
  }

  /* ------------------------------------------------------------- helper */

  private tableFor(typename: string): string | null {
    return SYNC_TABLES[typename as SyncableTypename] ?? null;
  }
}

/** Coerce a loosely-typed queue payload into something Postgres accepts. */
function sanitize(payload: Record<string, unknown>): CloudRow {
  const out: CloudRow = { id: String(payload['id'] ?? '') };
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (key === 'synced') continue; // local-only status flag
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  out['synced_at'] = new Date().toISOString();
  return out;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
