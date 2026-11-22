import { Component, Input } from '@angular/core';

/**
 * Harmonic bar graph (1st fundamental 50/60 Hz through the 9th).
 * Bars are spring-animated via CSS transition on height.
 */
@Component({
  selector: 'vs-harmonic-bars',
  standalone: true,
  template: `
    <div class="bars">
      @for (v of values; track $index) {
        <div class="bar-col">
          <div class="bar-value">{{ fmt(v) }}%</div>
          <div class="bar-track">
            <div
              class="bar-fill"
              [class.hot]="v > 20"
              [class.warm]="v > 6 && v <= 20"
              [style.height.%]="height(v)"
            ></div>
          </div>
          <div class="bar-label">{{ labels.length > $index ? labels[$index] : ('H' + ($index + 1)) }}</div>
        </div>
      }
    </div>
  `,
})
export class HarmonicBarsComponent {
  @Input() values: number[] = [];
  @Input() labels: string[] = [];
  @Input() max = 100;
  @Input() decimals = 1;

  height(v: number): number {
    return Math.max(0.5, Math.min(100, (v / Math.max(this.max, 1e-9)) * 100));
  }

  fmt(v: number): string {
    return v.toFixed(this.decimals);
  }
}
