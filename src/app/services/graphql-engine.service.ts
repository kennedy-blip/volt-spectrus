import { Injectable, Signal, signal } from '@angular/core';
import { buildSchema, graphql, type GraphQLSchema } from 'graphql';
import { GRAPHQL_SDL } from '../../generated/embedded-sources';
import { TelemetryService } from './telemetry.service';
import { TariffEngineService } from './tariff-engine.service';
import { SupabaseSyncService } from './supabase-sync.service';
import { ROLE_TIERS, type Role } from '../models';

export interface GqlResult {
  data?: Record<string, unknown> | null;
  errors?: { message: string }[];
  durationMs: number;
}

/**
 * In-app GraphQL execution engine.
 *
 * The SDL in src/graphql/grid_telemetry.graphql is compiled with the standard
 * `graphql` reference implementation and executed against resolver functions
 * backed by TelemetryService + IndexedDB.  This is a genuine GraphQL runtime —
 * not a regex mock — and it works fully offline.
 */
@Injectable({ providedIn: 'root' })
export class GraphqlEngineService {
  readonly sdl: string = GRAPHQL_SDL;
  readonly schema: GraphQLSchema;
  readonly ready = signal<boolean>(false);
  readonly lastResult = signal<GqlResult | null>(null);

  constructor(
    private readonly telemetry: TelemetryService,
    private readonly tariff: TariffEngineService,
    private readonly cloud: SupabaseSyncService,
  ) {
    this.schema = buildSchema(GRAPHQL_SDL);
    this.ready.set(true);
  }

  /** Execute a GraphQL operation (query or mutation) against the local store. */
  async execute(source: string, variables: Record<string, unknown> = {}): Promise<GqlResult> {
    const started = performance.now();
    const rootValue = this.buildRoot();
    try {
      const response = await graphql({
        schema: this.schema,
        source,
        rootValue,
        variableValues: variables,
      });
      const result: GqlResult = {
        data: (response.data as Record<string, unknown> | null) ?? null,
        errors: response.errors?.map((e) => ({ message: e.message })),
        durationMs: performance.now() - started,
      };
      this.lastResult.set(result);
      return result;
    } catch (err) {
      const result: GqlResult = {
        errors: [{ message: err instanceof Error ? err.message : String(err) }],
        durationMs: performance.now() - started,
      };
      this.lastResult.set(result);
      return result;
    }
  }

  private buildRoot(): Record<string, (args: never) => unknown> {
    const t = this.telemetry;
    const tariff = this.tariff;

    return {
      /* ---------------------------------------------------------- queries */
      gridAudits: () => t.audits(),
      gridAudit: (args: { id: string }) => t.audits().find((a) => a.id === args.id) ?? null,
      vampireAppliances: () => t.vampires(),
      vampireAppliance: (args: { id: string }) => t.vampires().find((v) => v.id === args.id) ?? null,
      smartMeterReads: () => t.meterReads(),
      smartMeterRead: (args: { id: string }) => t.meterReads().find((r) => r.id === args.id) ?? null,
      vampireSavings: () => ({
        annualKwh: t.annualKwhSaved(),
        annualUsd: t.annualSavings(),
        count: t.vampires().length,
      }),
      tariffCurve: (args: { scheduleId?: string }) => {
        const id = args.scheduleId ?? tariff.activeScheduleId();
        const sched = tariff.schedules[id] ?? tariff.schedules['ca_sou_tou'];
        return {
          id: sched.id,
          name: sched.name,
          currency: sched.currency,
          blendedRate: sched.blendedRate,
          curve: tariff.touCurve(id),
        };
      },
      ieee519: (args: { thdPercent: number; harmonics: number[]; bus?: string; iscOverIl?: number }) =>
        tariff.ieee519(args.thdPercent, args.harmonics, args.bus ?? '<69kV', args.iscOverIl ?? 50),
      panelCheck: (args: { panelAmps: number; voltage: number; concurrentKw: number }) =>
        tariff.panelHeadroom(args.panelAmps, args.voltage, args.concurrentKw),
      syncQueue: () => t.syncQueue(),
      role: () => t.role(),
      cloudLink: () => ({
        enabled: this.cloud.enabled(),
        url: this.cloud.url,
        lastSyncAt: this.cloud.lastSyncAt(),
        lastError: this.cloud.lastError(),
        pending: t.syncQueue().filter((e) => e.status !== 'SYNCED').length,
        remoteCount: this.cloud.remoteCount(),
      }),

      /* -------------------------------------------------------- mutations */
      addVampireAppliance: async (args: { input: never }) => {
        const input = args.input as unknown as {
          name: string;
          location: string;
          standbyWatts: number;
          emfUt?: number;
          humHz?: number;
          severity?: 'CLEAN' | 'VAMPIRE' | 'FIRE';
        };
        return t.addVampire({
          name: input.name,
          location: input.location,
          standbyWatts: input.standbyWatts,
          emfUt: input.emfUt ?? 0,
          humHz: input.humHz ?? 0,
          severity: input.severity ?? 'VAMPIRE',
        });
      },
      removeVampireAppliance: async (args: { id: string }) => {
        await t.removeVampire(args.id);
        return true;
      },
      recordGridAudit: async (args: { input: never }) => {
        const input = args.input as unknown as Omit<
          import('../models').GridAudit,
          'id' | 'createdAt' | 'synced'
        >;
        return t.recordAudit(input);
      },
      recordSmartMeterRead: async (args: { input: never }) => {
        const input = args.input as unknown as {
          pulseConstant: number;
          pulseConstantUnit?: string;
          intervalSeconds: number;
          mode?: string;
        };
        const powerW = (3600 * input.pulseConstant) / Math.max(input.intervalSeconds, 1e-6);
        const costPerHourUsd = (powerW / 1000) * t.blendedRate();
        return t.recordMeterRead({
          pulseConstant: input.pulseConstant,
          pulseConstantUnit: input.pulseConstantUnit ?? 'imp/kWh',
          intervalSeconds: input.intervalSeconds,
          powerW,
          powerKw: powerW / 1000,
          costPerHourUsd,
          projectedMonthlyUsd: costPerHourUsd * 24 * 30,
          mode: input.mode ?? 'optical',
        });
      },
      enqueueSync: async (args: { typename: string; payload: Record<string, unknown> }) => {
        await t.enqueue('enqueueSync', args.typename, args.payload);
        return t.syncQueue()[t.syncQueue().length - 1];
      },
      flushSync: async () => {
        await t.flushSync();
        return t.syncQueue();
      },
      clearSyncQueue: async () => {
        await t.clearSyncQueue();
        return true;
      },
      setRole: (args: { role: Role }) => {
        if (ROLE_TIERS[args.role]) t.setRole(args.role);
        return t.role();
      },
    };
  }
}
