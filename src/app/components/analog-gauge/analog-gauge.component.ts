import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  inject,
} from '@angular/core';
import { SpringPhysicsService } from '../../services/spring-physics.service';

export interface GaugeZone {
  /** Upper bound of the zone (in gauge units). */
  to: number;
  color: string;
}

/**
 * Analog needle gauge driven by a real Hooke's-law spring.  The needle sweeps
 * with the specified stiffness/damping/mass instead of snapping.
 */
@Component({
  selector: 'vs-gauge',
  standalone: true,
  template: `
    <div class="gauge">
      <svg viewBox="0 0 220 150" [attr.aria-label]="label">
        <defs>
          <linearGradient [id]="gradId" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" [attr.stop-color]="firstColor()" />
            <stop offset="100%" [attr.stop-color]="lastColor()" />
          </linearGradient>
        </defs>

        <!-- dial face -->
        <circle cx="110" cy="110" r="98" [attr.fill]="'color-mix(in srgb, var(--glass-bg) 70%, transparent)'" [attr.stroke]="'var(--glass-border)'" />
        <path [attr.d]="arcPath()" fill="none" [attr.stroke]="'url(' + gradId + ')'" stroke-width="7" stroke-linecap="round" opacity="0.85" />

        @for (t of ticks; track $index) {
          <line [attr.x1]="t.x1" [attr.y1]="t.y1" [attr.x2]="t.x2" [attr.y2]="t.y2"
                [attr.stroke]="'var(--faint)'" stroke-width="1.4" />
        }

        <!-- needle (spring-driven) -->
        <g [attr.transform]="'rotate(' + angle().toFixed(2) + ' 110 110)'">
          <line x1="110" y1="110" x2="110" y2="34" [attr.stroke]="'var(--ink)'" stroke-width="2.6" stroke-linecap="round" />
          <circle cx="110" cy="110" r="6" [attr.fill]="'var(--cyan)'" />
        </g>
      </svg>
      <div class="gauge-read">
        <div style="font-size:22px">{{ display() }}</div>
        <div class="faint" style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase">{{ label }} · {{ unit }}</div>
      </div>
    </div>
  `,
})
export class AnalogGaugeComponent implements OnChanges, OnDestroy {
  @Input() value = 0;
  @Input() min = 0;
  @Input() max = 100;
  @Input() label = '';
  @Input() unit = '';
  @Input() decimals = 2;
  @Input() zones: GaugeZone[] = [
    { to: 25, color: 'var(--emerald)' },
    { to: 60, color: 'var(--amber)' },
    { to: 100, color: 'var(--crimson)' },
  ];

  private readonly physics = inject(SpringPhysicsService);
  private readonly spring = this.physics.create(0);
  readonly gradId = `gauge-grad-${Math.random().toString(36).slice(2, 8)}`;

  firstColor(): string {
    return this.zones[0]?.color ?? 'var(--emerald)';
  }

  lastColor(): string {
    return this.zones[this.zones.length - 1]?.color ?? 'var(--crimson)';
  }

  angle(): number {
    const f = this.fraction();
    return -120 + f * 240;
  }

  display(): string {
    const v = this.spring.value();
    return v.toFixed(this.decimals);
  }

  private fraction(): number {
    const v = Math.min(Math.max(this.spring.value(), this.min), this.max);
    return (v - this.min) / Math.max(this.max - this.min, 1e-9);
  }

  arcPath(): string {
    return describeArc(110, 110, 88, -120, 120);
  }

  get ticks(): { x1: number; y1: number; x2: number; y2: number }[] {
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = ((-120 + i * 30) * Math.PI) / 180;
      out.push({
        x1: 110 + 74 * Math.sin(a),
        y1: 110 - 74 * Math.cos(a),
        x2: 110 + 82 * Math.sin(a),
        y2: 110 - 82 * Math.cos(a),
      });
    }
    return out;
  }

  ngOnChanges(): void {
    this.spring.set(this.value);
  }

  ngOnDestroy(): void {
    this.physics.destroy(this.spring);
  }
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

export function describeArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const start = polar(cx, cy, r, a0);
  const end = polar(cx, cy, r, a1);
  const largeArc = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}
