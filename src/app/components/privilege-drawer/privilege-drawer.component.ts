import { Component, inject } from '@angular/core';
import { TelemetryService } from '../../services/telemetry.service';
import { UiStateService } from '../../services/ui-state.service';
import { PermissionService, PERMISSION_META } from '../../services/permission.service';
import { ROLE_TIERS, type PermissionKey, type Role } from '../../models';

const ROLES: Role[] = ['HOMEOWNER', 'MASTER_ELECTRICIAN', 'GRID_SYSTEMS_DIRECTOR'];

const RUNTIME = [
  { lang: 'Angular 19', detail: 'Standalone components · fine-grained signals · springs' },
  { lang: 'ANSI C99', detail: 'Interpolated Goertzel DSP kernel · WASM-ready' },
  { lang: 'Ruby 3.3', detail: 'TOU arbitrage · vampire drain · IEEE 519' },
  { lang: 'GraphQL SDL', detail: 'Offline-first executable schema' },
  { lang: 'GLSL ES 3.00', detail: 'WebGL2 plasma / flux-line field' },
];

const PERM_KEYS: PermissionKey[] = ['microphone', 'magnetometer', 'camera', 'haptics'];

@Component({
  selector: 'vs-privilege-drawer',
  standalone: true,
  template: `
    @if (ui.drawerOpen()) {
      <div class="drawer-backdrop" (click)="ui.closeDrawer()"></div>
      <aside class="drawer" role="dialog" aria-label="Privileges and polyglot runtime">
        <header>
          <div>
            <h3>Privileges &amp; Runtime</h3>
            <p class="muted" style="font-size:12px">RBAC tiers, hardware sensors, polyglot build</p>
          </div>
          <div class="right">
            <button class="icon-btn" (click)="ui.closeDrawer()" aria-label="Close">✕</button>
          </div>
        </header>

        <div class="drawer-body">
          <div class="section-title">Role-based access control</div>
          <div class="col mb">
            @for (r of roles; track r) {
              <div
                class="role-card"
                [class.active]="telemetry.role() === r"
                (click)="telemetry.setRole(r)"
              >
                <div class="row">
                  <span class="badge" [class.info]="telemetry.role() === r">
                    TIER {{ roleTier(r) }}
                  </span>
                  <strong>{{ roleLabel(r) }}</strong>
                  <span class="right mono faint">Tier {{ roleTier(r) }}/3</span>
                </div>
                <p class="muted" style="font-size:12px;margin-top:8px">{{ roleBlurb(r) }}</p>
              </div>
            }
          </div>

          <div class="divider"></div>
          <div class="section-title">Hardware &amp; OS sensor permission matrix</div>
          <div class="col">
            @for (key of permKeys; track key) {
              <div class="perm-row">
                <div class="perm-icon">{{ icon(key) }}</div>
                <div class="perm-body">
                  <div class="perm-title">{{ meta(key).label }}</div>
                  <div class="perm-detail">{{ meta(key).detail }}</div>
                  <div class="row" style="margin-top:8px">
                    <span class="badge"
                      [class.good]="permStatus(key) === 'ACTIVE' || permStatus(key) === 'SIMULATOR ACTIVE'"
                      [class.warn]="permStatus(key) === 'RESTRICTED'"
                      [class.bad]="permStatus(key) === 'UNSUPPORTED'">
                      {{ permStatus(key) }}
                    </span>
                    <span class="right kbd">live µT {{ flux().toFixed(1) }}</span>
                  </div>
                </div>
                <div
                  class="switch"
                  [class.on]="permStatus(key) === 'ACTIVE' || permStatus(key) === 'SIMULATOR ACTIVE'"
                  (click)="toggle(key)"
                  role="switch"
                  [attr.aria-checked]="permStatus(key) === 'ACTIVE'"
                  tabindex="0"
                ></div>
              </div>
            }
          </div>

          <div class="divider"></div>
          <div class="section-title">Polyglot runtime manifest</div>
          <div class="col">
            @for (rt of runtime; track rt.lang) {
              <div class="row" style="justify-content:space-between">
                <span class="mono" style="font-size:12.5px">{{ rt.lang }}</span>
                <span class="faint" style="font-size:11.5px;text-align:right">{{ rt.detail }}</span>
              </div>
            }
          </div>
        </div>
      </aside>
    }
  `,
})
export class PrivilegeDrawerComponent {
  readonly telemetry = inject(TelemetryService);
  readonly ui = inject(UiStateService);
  readonly permissions = inject(PermissionService);
  readonly roles = ROLES;
  readonly permKeys = PERM_KEYS;
  readonly runtime = RUNTIME;

  roleTier(r: Role): number {
    return ROLE_TIERS[r].tier;
  }
  roleLabel(r: Role): string {
    return ROLE_TIERS[r].label;
  }
  roleBlurb(r: Role): string {
    return ROLE_TIERS[r].blurb;
  }
  icon(key: PermissionKey): string {
    return PERMISSION_META[key].icon === 'mic' ? '🎙'
      : PERMISSION_META[key].icon === 'magnet' ? '🧲'
      : PERMISSION_META[key].icon === 'camera' ? '📷' : '📳';
  }
  meta(key: PermissionKey) {
    return PERMISSION_META[key];
  }
  permStatus(key: PermissionKey): string {
    return this.permissions.status()[key];
  }
  flux(): number {
    return this.permissions.fluxUt();
  }
  toggle(key: PermissionKey): void {
    void this.permissions.toggle(key);
  }
}
