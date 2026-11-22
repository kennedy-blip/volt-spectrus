import { Component, inject } from '@angular/core';
import { TelemetryService } from '../../services/telemetry.service';
import { UiStateService } from '../../services/ui-state.service';
import { ROLE_TIERS, type FormFactor, type ThemeKey } from '../../models';

const THEMES: { key: ThemeKey; label: string }[] = [
  { key: 'obsidian', label: 'High-Voltage Obsidian' },
  { key: 'daylight', label: 'Utility Daylight Frost' },
  { key: 'amber', label: 'Substation Amber-Red' },
  { key: 'eco', label: 'Eco-Glass / Low-GPU' },
];

const FORM_FACTORS: FormFactor[] = ['desktop', 'mobile'];

@Component({
  selector: 'vs-header',
  standalone: true,
  template: `
    <header class="header">
      <div class="brand">
        <div class="brand-mark">VS</div>
        <div>
          <h1>VOLT-SPECTRA</h1>
          <small>Grid DSP · THD · Vampire Load</small>
        </div>
      </div>

      <span class="badge info" data-testid="role-badge">
        ⛨ {{ tierLabel() }}
      </span>
      <span class="badge" [class.good]="telemetry.online()" [class.warn]="!telemetry.online()">
        {{ telemetry.online() ? 'ONLINE' : 'OFFLINE' }}
      </span>

      <div class="header-spacer"></div>

      <div class="theme-switch" role="group" aria-label="Theme and substation environment">
        @for (t of themes; track t.key) {
          <button
            class="theme-dot"
            [class.active]="telemetry.theme() === t.key"
            [attr.data-theme-dot]="t.key"
            [title]="t.label"
            [attr.aria-label]="t.label"
            (click)="telemetry.setTheme(t.key)"
          ></button>
        }
      </div>

      <div class="form-toggle" role="group" aria-label="Form factor">
        @for (f of formFactors; track f) {
          <button
            [class.active]="telemetry.formFactor() === f"
            (click)="telemetry.setFormFactor(f)"
          >
            {{ f === 'desktop' ? '🖥 Desktop Grid' : '📱 Mobile APK' }}
          </button>
        }
      </div>

      <button class="icon-btn" title="Privileges & polyglot runtime" (click)="ui.openDrawer()">
        ⚙
      </button>

      <a
        class="btn btn-primary btn-glow"
        href="/releases/voltspectra-release.apk"
        download="VoltSpectra-GridDSP-v1.0.0.apk"
        (click)="ui.openApk()"
        title="One-tap Android .APK download"
      >
        ⬇ APK
      </a>
    </header>
  `,
})
export class HeaderComponent {
  readonly telemetry = inject(TelemetryService);
  readonly ui = inject(UiStateService);
  readonly themes = THEMES;
  readonly formFactors = FORM_FACTORS;

  tierLabel(): string {
    return ROLE_TIERS[this.telemetry.role()].label;
  }
}
