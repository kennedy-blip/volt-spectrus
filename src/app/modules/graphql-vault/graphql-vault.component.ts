import { computed, inject, signal } from '@angular/core';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { TelemetryService } from '../../services/telemetry.service';
import { SupabaseSyncService } from '../../services/supabase-sync.service';
import { GraphqlEngineService } from '../../services/graphql-engine.service';
import { UiStateService } from '../../services/ui-state.service';
import {
  APK_WORKFLOW,
  C99_HARMONIC_SOURCE,
  CAPACITOR_CONFIG,
  DSP_BRIDGE_SOURCE,
  GLSL_PLASMA_SOURCE,
  GRAPHQL_SDL,
  RUBY_TARIFF_SOURCE,
} from '../../../generated/embedded-sources';
import { ROLE_TIERS, type Role } from '../../models';

const EXAMPLES: { label: string; query: string }[] = [
  {
    label: 'Grid overview',
    query: `query GridOverview {
  gridAudits { frequencyHz thdPercent crestFactor purityScore verdict source }
  vampireSavings
  syncQueue { operation typename status attempts }
}`,
  },
  {
    label: 'Vampire kill-list',
    query: `query VampireList {
  vampireAppliances { name location standbyWatts annualKwh annualCostUsd emfUt humHz severity }
  vampireSavings
}`,
  },
  {
    label: 'TOU tariff curve',
    query: `query Tou($id: ID!) {
  tariffCurve(scheduleId: $id) { id name currency blendedRate curve { hour rate tier } }
}`,
  },
  {
    label: 'IEEE 519 compliance',
    query: `query Compliance {
  ieee519(thdPercent: 28.2, harmonics: [100, 18, 11, 0, 15, 0, 10, 0, 5]) {
    thdPercent voltageThdLimit voltageCompliant worstHarmonic individualLimit currentTddLimit compliant
  }
}`,
  },
  {
    label: 'Cloud link status',
    query: `query CloudLink {
  cloudLink { enabled url lastSyncAt lastError pending remoteCount }
}`,
  },
  {
    label: 'Mutation · add vampire',
    query: `mutation AddVampire($input: VampireApplianceInput!) {
  addVampireAppliance(input: $input) { id name standbyWatts annualCostUsd synced }
}`,
  },
  {
    label: 'Mutation · record meter read',
    query: `mutation RecordRead($input: SmartMeterReadInput!) {
  recordSmartMeterRead(input: $input) { id pulseConstant intervalSeconds powerKw costPerHourUsd }
}`,
  },
];

const POLYGLOT: { key: string; label: string; language: string; source: string }[] = [
  { key: 'c99', label: 'C99 · Goertzel DSP', language: 'C99', source: C99_HARMONIC_SOURCE },
  { key: 'ruby', label: 'Ruby 3.3 · Tariff', language: 'Ruby', source: RUBY_TARIFF_SOURCE },
  { key: 'graphql', label: 'GraphQL SDL', language: 'GraphQL', source: GRAPHQL_SDL },
  { key: 'glsl', label: 'GLSL · Plasma', language: 'GLSL', source: GLSL_PLASMA_SOURCE },
  { key: 'bridge', label: 'TS · C99 Bridge', language: 'TypeScript', source: DSP_BRIDGE_SOURCE },
  { key: 'capacitor', label: 'Capacitor', language: 'TypeScript', source: CAPACITOR_CONFIG },
  { key: 'ci', label: 'APK Pipeline', language: 'YAML', source: APK_WORKFLOW },
];

const ROLES: Role[] = ['HOMEOWNER', 'MASTER_ELECTRICIAN', 'GRID_SYSTEMS_DIRECTOR'];

/**
 * Interactive GraphQL console, five-language polyglot inspector and the
 * offline→online sync controller.  Admin tier unlocks execution.
 */
@Component({
  selector: 'vs-graphql-vault',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <section class="module">
      <div class="module-head">
        <div>
          <h2>GraphQL &amp; Polyglot Vault</h2>
          <p class="lede">
            A real GraphQL runtime compiled from the embedded SDL and executed against
            IndexedDB-backed resolvers — plus the five-language source inspector and the
            offline sync queue.
          </p>
        </div>
        <div class="spacer"></div>
        <span class="badge" [class.good]="telemetry.hasAdmin()" [class.warn]="!telemetry.hasAdmin()">
          {{ telemetry.hasAdmin() ? 'ADMIN · EXECUTION ENABLED' : 'PRO · EXECUTION LOCKED' }}
        </span>
      </div>

      @if (!telemetry.hasAdmin()) {
        <div class="glass glass-pad" style="text-align:center;padding:40px">
          <div style="font-size:40px">⬡</div>
          <h3 class="mt">Grid Systems Director clearance required</h3>
          <p class="muted" style="max-width:56ch;margin:10px auto 0">
            The GraphQL console, polyglot inspector, telemetry exporter and cloud-sync
            controller are restricted to Tier 3. Switch your privilege tier from the
            header drawer to unlock execution.
          </p>
          <div class="row mt" style="justify-content:center">
            @for (r of roles; track r) {
              <button class="chip" [class.active]="telemetry.role() === r" (click)="telemetry.setRole(r)">
                {{ roleLabel(r) }}
              </button>
            }
          </div>
        </div>
      } @else {
        <div class="grid grid-2 mb">
          <div class="glass glass-pad col">
            <div class="row" style="justify-content:space-between">
              <div class="section-title" style="margin:0">Interactive GraphQL console</div>
              <select class="btn" style="padding:7px 10px" (change)="loadExample($event)">
                <option value="">load example…</option>
                @for (e of examples; track e.label) { <option [value]="e.label">{{ e.label }}</option> }
              </select>
            </div>
            <textarea
              class="code-view"
              style="min-height:190px;resize:vertical"
              spellcheck="false"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
              aria-label="GraphQL query"
            ></textarea>
            <div class="row">
              <button class="btn btn-primary" (click)="run()">▶ Execute</button>
              <button class="btn" (click)="runMutation()" [disabled]="!isMutation()">▶ Execute mutation</button>
              <span class="faint mono" style="font-size:11px">{{ result()?.durationMs?.toFixed(1) ?? '0.0' }} ms</span>
            </div>
            <div class="section-title">JSON response</div>
            <div class="code-view" style="min-height:190px;max-height:280px">{{ responseText() }}</div>
          </div>

          <div class="glass glass-pad col">
            <div class="section-title">5-language polyglot inspector</div>
            <div class="code-tabs">
              @for (p of polyglot; track p.key) {
                <button class="chip" [class.active]="activeTab() === p.key" (click)="activeTab.set(p.key)">{{ p.label }}</button>
              }
            </div>
            <div class="code-view" style="flex:1;min-height:340px">{{ activeSource() }}</div>
            <div class="row">
              <button class="btn" (click)="copy()">⧉ Copy {{ activePolyglot().language }}</button>
              <button class="btn" (click)="ui.openBlueprint({title: activePolyglot().label, subtitle: 'Polyglot Vault source inspector', language: activePolyglot().language, source: activeSource(), meta: meta()})">
                📐 Blueprint modal
              </button>
            </div>
          </div>
        </div>

        <div class="grid grid-2">
          <div class="glass glass-pad">
            <div class="row" style="justify-content:space-between">
              <div class="section-title" style="margin:0">Offline → online sync queue</div>
              <div class="row">
                <button class="btn" (click)="flush()">⇪ Flush queue</button>
                <button class="btn" (click)="clear()">🗑 Clear</button>
              </div>
            </div>
            <div class="row mt" style="justify-content:space-between">
              <span class="badge" [class.good]="cloud.enabled()" [class.warn]="!cloud.enabled()">
                {{ cloud.enabled() ? 'SUPABASE LINKED' : 'OFFLINE-FIRST · NO CLOUD KEY' }}
              </span>
              <div class="row">
                <button class="btn" (click)="pingCloud()" [disabled]="cloud.pushing()">⇄ Test link</button>
                <button class="btn" (click)="flush()" [disabled]="cloud.pushing()">
                  {{ cloud.pushing() ? '⇪ Pushing…' : '⇪ Sync now' }}
                </button>
              </div>
            </div>
            @if (cloudPing(); as ping) {
              <p class="hint" style="margin:6px 0 0">
                {{ ping.ok ? '✓' : '✕' }} {{ ping.message }}
                @if (cloud.lastSyncAt(); as at) { · last push {{ at | date: 'HH:mm:ss' }} }
                @if (cloud.lastError(); as err) { · {{ err }} }
              </p>
            }
            <div class="scroll-x mt">
              <table class="table">
                <thead><tr><th>Operation</th><th>Type</th><th>Status</th><th>Attempts</th><th>Created</th></tr></thead>
                <tbody>
                  @for (e of telemetry.syncQueue(); track e.id) {
                    <tr>
                      <td class="mono">{{ e.operation }}</td>
                      <td class="mono">{{ e.typename }}</td>
                      <td><span class="badge" [class.good]="e.status === 'SYNCED'" [class.warn]="e.status === 'PENDING'" [class.bad]="e.status === 'FAILED'">{{ e.status }}</span></td>
                      <td class="mono">{{ e.attempts }}</td>
                      <td class="mono faint">{{ e.createdAt | date: 'HH:mm:ss' }}</td>
                    </tr>
                  }
                  @if (telemetry.syncQueue().length === 0) {
                    <tr><td colspan="5" class="muted">Queue empty — every audit is synced.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="glass glass-pad col">
            <div class="section-title">Raw telemetry exporter</div>
            <p class="hint">Export every IndexedDB store as JSON or CSV for the Grid Systems Director tier.</p>
            <div class="row">
              <button class="btn" (click)="exportJson()">⬇ JSON</button>
              <button class="btn" (click)="exportCsv()">⬇ CSV</button>
              <span class="badge info">{{ telemetry.audits().length }} audits · {{ telemetry.vampires().length }} vampires · {{ telemetry.meterReads().length }} reads</span>
            </div>
            <div class="divider"></div>
            <div class="section-title">Embedded schema · {{ sdlLength() }} chars</div>
            <div class="code-view" style="max-height:200px">{{ sdlPreview() }}</div>
          </div>
        </div>
      }
    </section>
  `,
})
export class GraphqlVaultComponent {
  readonly telemetry = inject(TelemetryService);
  readonly cloud = inject(SupabaseSyncService);
  private readonly gql = inject(GraphqlEngineService);
  readonly ui = inject(UiStateService);
  readonly cloudPing = signal<{ ok: boolean; message: string } | null>(null);

  readonly examples = EXAMPLES;
  readonly polyglot = POLYGLOT;
  readonly roles = ROLES;
  readonly query = signal(EXAMPLES[0].query);
  readonly result = signal<{ data?: Record<string, unknown> | null; errors?: { message: string }[]; durationMs: number } | null>(null);
  readonly activeTab = signal('c99');
  readonly copied = signal(false);

  readonly activePolyglot = computed(() => this.polyglot.find((p) => p.key === this.activeTab()) ?? this.polyglot[0]);
  readonly activeSource = computed(() => this.activePolyglot().source);
  readonly responseText = computed(() => {
    const r = this.result();
    if (!r) return '// response will appear here';
    return JSON.stringify(r.errors ? { errors: r.errors } : { data: r.data }, null, 2);
  });
  readonly sdlLength = computed(() => this.gql.sdl.length);
  readonly sdlPreview = computed(() => this.gql.sdl.slice(0, 1400) + (this.gql.sdl.length > 1400 ? '\n…' : ''));

  meta(): { label: string; value: string }[] {
    const p = this.activePolyglot();
    return [
      { label: 'Language', value: p.language },
      { label: 'File', value: p.key },
      { label: 'Size', value: `${p.source.length} chars` },
    ];
  }

  roleLabel(r: Role): string {
    return ROLE_TIERS[r].label;
  }

  isMutation(): boolean {
    return /^\s*mutation\b/m.test(this.query());
  }

  loadExample(e: Event): void {
    const label = (e.target as HTMLSelectElement).value;
    const ex = this.examples.find((x) => x.label === label);
    if (ex) this.query.set(ex.query);
    (e.target as HTMLSelectElement).value = '';
  }

  async run(): Promise<void> {
    const r = await this.gql.execute(this.query());
    this.result.set(r);
  }

  async runMutation(): Promise<void> {
    await this.run();
  }

  async flush(): Promise<void> {
    await this.telemetry.flushSync();
  }

  async pingCloud(): Promise<void> {
    this.cloudPing.set(await this.cloud.ping());
  }

  async clear(): Promise<void> {
    await this.telemetry.clearSyncQueue();
    this.telemetry.toast('Sync queue cleared', 'info');
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.activeSource());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* denied */
    }
  }

  async exportJson(): Promise<void> {
    const data = await this.telemetry.exportTelemetry();
    this.download('voltspectra-telemetry.json', data, 'application/json');
  }

  async exportCsv(): Promise<void> {
    const rows = this.telemetry.audits().map((a) =>
      [a.createdAt, a.source, a.frequencyHz.toFixed(3), a.thdPercent.toFixed(2), a.crestFactor.toFixed(3), a.purityScore.toFixed(1), a.verdict].join(','),
    );
    const csv = ['createdAt,source,frequencyHz,thdPercent,crestFactor,purityScore,verdict', ...rows].join('\n');
    this.download('voltspectra-audits.csv', csv, 'text/csv');
  }

  private download(name: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
}
