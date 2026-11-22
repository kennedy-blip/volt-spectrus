import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MODULES } from '../../module-meta';
import { TelemetryService } from '../../services/telemetry.service';
import { ROLE_TIERS } from '../../models';

/**
 * Gooey metaball navigation dock.  The active pill stretches like liquid
 * mercury thanks to the inline SVG contrast filter declared in app.component.
 */
@Component({
  selector: 'vs-gooey-dock',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="dock-wrap" aria-label="VOLT-SPECTRA modules">
      <div class="dock">
        @for (m of modules; track m.path) {
          <a
            class="dock-pill"
            [routerLink]="m.path"
            [class.locked]="!allowed(m.minRole)"
            [class.active]="isActive(m.path)"
            [title]="allowed(m.minRole) ? m.label : m.label + ' — requires ' + roleLabel(m.minRole)"
          >
            <span class="dot"></span>
            <span>{{ m.short }}</span>
          </a>
        }
      </div>
    </nav>
  `,
})
export class GooeyDockComponent {
  private readonly telemetry = inject(TelemetryService);
  private readonly router = inject(Router);
  readonly modules = MODULES;

  allowed(minRole: keyof typeof ROLE_TIERS): boolean {
    return ROLE_TIERS[this.telemetry.role()].tier >= ROLE_TIERS[minRole].tier;
  }

  roleLabel(role: keyof typeof ROLE_TIERS): string {
    return ROLE_TIERS[role].label;
  }

  isActive(path: string): boolean {
    const url = this.router.url.split('?')[0];
    if (path === '') return url === '/' || url === '';
    return url.startsWith('/' + path);
  }
}
