import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { PlasmaRendererService } from '../../services/plasma-renderer.service';
import { TelemetryService } from '../../services/telemetry.service';

/**
 * Fixed WebGL2 plasma / electromagnetic flux-line underlay.
 * Reads the live telemetry signals every frame and feeds the GLSL uniforms.
 */
@Component({
  selector: 'vs-plasma-background',
  standalone: true,
  template: `
    @if (supported) {
      <canvas #canvas class="plasma-canvas" aria-hidden="true"></canvas>
    } @else {
      <div class="plasma-fallback" aria-hidden="true"></div>
    }
  `,
})
export class PlasmaBackgroundComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef?: ElementRef<HTMLCanvasElement>;
  private readonly renderer = inject(PlasmaRendererService);
  private readonly telemetry = inject(TelemetryService);
  readonly supported = true;
  private ok = false;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    this.ok = this.renderer.init(canvas);
    if (this.ok) {
      this.renderer.start(() => {
        const p = this.telemetry.plasma();
        return {
          thd: p.thd,
          fluxUt: p.fluxUt,
          freqHz: p.freqHz,
          energy: p.energy,
          theme: this.telemetry.theme(),
          lowGpu: this.telemetry.theme() === 'eco',
        };
      });
    }
  }

  ngOnDestroy(): void {
    this.renderer.stop();
  }
}
