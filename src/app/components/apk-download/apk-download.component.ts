import { Component, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { UiStateService } from '../../services/ui-state.service';
import { QrCodeService } from '../../services/qr-code.service';
import { APK_SHA256, APK_SIZE_BYTES } from '../../../generated/embedded-sources';

const DOWNLOAD_URL = '/releases/voltspectra-release.apk';
const FILE_NAME = 'VoltSpectra-GridDSP-v1.0.0.apk';

const SPEC = [
  { label: 'Version', value: 'v1.0.0-arm64' },
  { label: 'Package', value: 'com.voltspectra.griddsp' },
  { label: 'Stack', value: 'Angular Signals + C99 DSP + Ruby + GraphQL + GLSL' },
  { label: 'Offline', value: '100% blackout / basement / off-grid ready' },
  { label: 'Size', value: `${(APK_SIZE_BYTES / 1024).toFixed(1)} KB (pre-bundled stub)` },
  { label: 'SHA-256', value: APK_SHA256 },
];

const STEPS = [
  { n: 1, title: 'Download', body: 'Tap the glowing button — Chrome/Safari saves the .APK next to your other downloads.' },
  { n: 2, title: 'Allow sideload', body: 'Android will prompt “Install unknown apps”. Grant it for this browser only.' },
  { n: 3, title: 'Install & sweep', body: 'Open VoltSpectra, grant mic/camera/EMF, and start hunting vampire loads.' },
];

/**
 * One-tap .APK Download Center with an instant SVG QR code for laptop→phone
 * handoff, the polyglot build spec and a 3-step sideloading guide.
 */
@Component({
  selector: 'vs-apk-download',
  standalone: true,
  template: `
    @if (ui.apkOpen()) {
      <div class="modal-backdrop" (click)="ui.closeApk()">
        <div class="modal glass glass-strong" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <header>
            <div>
              <h3>APK Distribution Center</h3>
              <p class="muted" style="font-size:12.5px">One-tap Android replica · offline field instrument</p>
            </div>
            <div class="right">
              <button class="icon-btn" (click)="ui.closeApk()" aria-label="Close">✕</button>
            </div>
          </header>

          <div class="modal-body">
            <div class="grid grid-2" style="align-items:start">
              <div class="col">
                <a class="btn btn-primary btn-glow" [href]="url" [download]="fileName" style="padding:14px 18px;font-size:15px">
                  ⬇ Download Android .APK
                </a>
                <a class="btn" [href]="url" [download]="fileName">⤓ Alternative direct stream</a>
                <div class="glass glass-pad" style="--radius-lg:18px">
                  <div class="section-title">Polyglot APK build spec</div>
                  <div class="col" style="gap:8px">
                    @for (s of spec; track s.label) {
                      <div class="row" style="justify-content:space-between;gap:16px">
                        <span class="faint" style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase">{{ s.label }}</span>
                        <span class="mono" style="font-size:11.5px;text-align:right;word-break:break-all">{{ s.value }}</span>
                      </div>
                    }
                  </div>
                </div>
              </div>

              <div class="col" style="align-items:center;text-align:center">
                <div class="glass glass-pad" style="--radius-lg:18px">
                  <div class="section-title" style="text-align:left">Scan to sideload</div>
                  <div [innerHTML]="qr()" style="width:200px;height:200px;margin:0 auto;border-radius:12px;overflow:hidden;display:grid;place-items:center;background:#e8f0ff"></div>
                  <p class="hint mt">{{ downloadAbsolute() }}</p>
                </div>
              </div>
            </div>

            <div class="divider"></div>
            <div class="section-title">3-step Android sideloading guide</div>
            <div class="grid grid-3">
              @for (s of steps; track s.n) {
                <div class="glass glass-pad" style="--radius-lg:16px">
                  <div class="row">
                    <span class="badge info">STEP {{ s.n }}</span>
                    <strong style="font-size:13px">{{ s.title }}</strong>
                  </div>
                  <p class="muted" style="font-size:12px;margin-top:10px">{{ s.body }}</p>
                </div>
              }
            </div>

            <p class="hint mt">
              The signed release APK is produced by
              <span class="mono">.github/workflows/build-and-bundle-apk.yml</span>
              and overwrites this pre-bundled artifact on every tag.
            </p>
          </div>
        </div>
      </div>
    }
  `,
})
export class ApkDownloadComponent {
  readonly ui = inject(UiStateService);
  private readonly qrService = inject(QrCodeService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly url = DOWNLOAD_URL;
  readonly fileName = FILE_NAME;
  readonly spec = SPEC;
  readonly steps = STEPS;
  readonly qr = signal<SafeHtml>('');

  constructor() {
    effect((onCleanup) => {
      if (!this.ui.apkOpen()) return;
      const target = this.downloadAbsolute();
      let alive = true;
      void this.qrService.svg(target, 400).then((svg) => {
        if (alive) this.qr.set(this.sanitizer.bypassSecurityTrustHtml(svg));
      });
      onCleanup(() => {
        alive = false;
      });
    });
  }

  downloadAbsolute(): string {
    if (typeof window === 'undefined') return DOWNLOAD_URL;
    return `${window.location.origin}${DOWNLOAD_URL}`;
  }
}
