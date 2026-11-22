import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';

/**
 * Dual 60fps AC oscilloscope: ideal pure sine (cyan) vs. detected distorted
 * waveform reconstructed from the measured 1..9 harmonic amplitudes.
 */
@Component({
  selector: 'vs-oscilloscope',
  standalone: true,
  template: `
    <div class="scope">
      <span class="scope-label">Ideal sine vs. detected · {{ frequencyHz }} Hz</span>
      <canvas #canvas></canvas>
    </div>
  `,
})
export class OscilloscopeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef?: ElementRef<HTMLCanvasElement>;
  @Input() harmonics: number[] = [1, 0, 0, 0, 0, 0, 0, 0, 0];
  @Input() frequencyHz = 60;
  @Input() purity = 100;

  private raf = 0;
  private start = 0;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    this.start = performance.now();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      this.render(ctx!, canvas, (performance.now() - this.start) / 1000);
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
  }

  private render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, t: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = Math.max(w, 1);
      canvas.height = Math.max(h, 1);
    }
    ctx.clearRect(0, 0, w, h);

    // graticule
    ctx.strokeStyle = 'rgba(120,160,220,0.10)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const x = (w / 8) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // zero line
    ctx.strokeStyle = 'rgba(120,160,220,0.22)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const mid = h / 2;
    const amp = h * 0.34;
    const cycles = 2.5;
    const samples = Math.max(120, Math.floor(w / 2));

    // ideal pure sine
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(34,211,238,0.95)';
    ctx.lineWidth = 1.8 * dpr;
    ctx.shadowColor = 'rgba(34,211,238,0.8)';
    ctx.shadowBlur = 8 * dpr;
    for (let i = 0; i <= samples; i++) {
      const x = (i / samples) * w;
      const phase = (i / samples) * cycles * Math.PI * 2 - t * 2.2;
      const y = mid - Math.sin(phase) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // detected distorted waveform
    const hot = this.purity < 60;
    ctx.beginPath();
    ctx.strokeStyle = hot ? 'rgba(239,68,68,0.95)' : 'rgba(245,158,11,0.95)';
    ctx.lineWidth = 1.8 * dpr;
    ctx.shadowColor = hot ? 'rgba(239,68,68,0.8)' : 'rgba(245,158,11,0.8)';
    ctx.shadowBlur = 8 * dpr;
    for (let i = 0; i <= samples; i++) {
      const x = (i / samples) * w;
      const phase = (i / samples) * cycles * Math.PI * 2 - t * 2.2;
      let y = 0;
      for (let hOrder = 1; hOrder <= 9; hOrder++) {
        const a = this.harmonics[hOrder - 1] ?? 0;
        y += a * Math.sin(phase * hOrder);
      }
      y = mid - y * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
