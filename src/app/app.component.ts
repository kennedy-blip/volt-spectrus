import {
  Component,
  computed,
  effect,
  inject,
  OnInit,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TelemetryService } from './services/telemetry.service';
import { UiStateService } from './services/ui-state.service';
import { HeaderComponent } from './components/header/header.component';
import { GooeyDockComponent } from './components/gooey-dock/gooey-dock.component';
import { PlasmaBackgroundComponent } from './components/plasma-background/plasma-background.component';
import { PrivilegeDrawerComponent } from './components/privilege-drawer/privilege-drawer.component';
import { BlueprintModalComponent } from './components/blueprint-modal/blueprint-modal.component';
import { ApkDownloadComponent } from './components/apk-download/apk-download.component';

@Component({
  selector: 'vs-root',
  standalone: true,
  imports: [
    RouterOutlet,
    HeaderComponent,
    GooeyDockComponent,
    PlasmaBackgroundComponent,
    PrivilegeDrawerComponent,
    BlueprintModalComponent,
    ApkDownloadComponent,
  ],
  template: `
    <div class="app-shell" [class.depth-push]="overlayOpen()">
      <vs-plasma-background />
      <div class="grid-overlay" aria-hidden="true"></div>
      <div class="specular" aria-hidden="true"></div>

      <vs-header />

      @if (telemetry.formFactor() === 'mobile') {
        <div class="phone-chassis">
          <div class="phone-screen">
            <router-outlet />
          </div>
        </div>
      } @else {
        <router-outlet />
      }

      <vs-gooey-dock />
    </div>

    <div class="grain" aria-hidden="true"></div>

    <!-- gooey metaball filter for the liquid navigation dock -->
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <defs>
        <filter id="vs-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix in="blur" mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>

    <vs-privilege-drawer />
    <vs-blueprint-modal />
    <vs-apk-download />

    <div class="toast-stack" aria-live="polite">
      @for (t of telemetry.toasts(); track t.id) {
        <div class="toast" [class.good]="t.tone === 'good'" [class.warn]="t.tone === 'warn'" [class.bad]="t.tone === 'bad'">
          {{ t.text }}
        </div>
      }
    </div>
  `,
})
export class AppComponent implements OnInit {
  readonly telemetry = inject(TelemetryService);
  private readonly ui = inject(UiStateService);

  readonly overlayOpen = computed(
    () => this.ui.drawerOpen() || this.ui.apkOpen() || this.ui.blueprint() !== null,
  );

  constructor() {
    // Reflect theme + form factor onto <html> so the CSS variable system applies.
    effect(() => {
      const theme = this.telemetry.theme();
      const factor = this.telemetry.formFactor();
      document.documentElement.dataset['theme'] = theme;
      document.documentElement.dataset['formFactor'] = factor;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'daylight' ? '#e9eef6' : '#05070e');
    });
  }

  ngOnInit(): void {
    void this.telemetry.init();

    // Auto-select the mobile chassis on small screens (once, before a saved pref exists).
    if (window.matchMedia('(max-width: 720px)').matches && !localStorage.getItem('voltspectra.prefs.v1')) {
      this.telemetry.setFormFactor('mobile');
    }

    // Cursor + gyroscope specular sweep.
    window.addEventListener('mousemove', this.onPointer, { passive: true });
    window.addEventListener('deviceorientation', this.onTilt, { passive: true });
  }

  private readonly onPointer = (e: MouseEvent): void => {
    this.setSpecular(e.clientX, e.clientY);
  };

  private readonly onTilt = (e: DeviceOrientationEvent): void => {
    const x = ((e.gamma ?? 0) + 90) / 180;
    const y = ((e.beta ?? 0) + 90) / 180;
    this.setSpecular(x * window.innerWidth, y * window.innerHeight);
  };

  private setSpecular(x: number, y: number): void {
    const root = document.documentElement.style;
    root.setProperty('--mx', `${(x / Math.max(window.innerWidth, 1)) * 100}%`);
    root.setProperty('--my', `${(y / Math.max(window.innerHeight, 1)) * 100}%`);
  }
}
