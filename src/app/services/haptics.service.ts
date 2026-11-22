import { Injectable, signal } from '@angular/core';

/**
 * Arc-pulse haptic engine.  Uses the Vibration API on Android/Capacitor and
 * degrades silently on desktops that lack it.
 *
 * Patterns:
 *  - vampire   : double pulse when sweeping past a phantom-load culprit
 *  - dirty     : serrated buzz on a harmonic spike / modified-sine inverter
 *  - arc       : single heavy thud on breaker overload / arc-flash warning
 *  - tick      : faint tap for optical meter pulse lock
 */
@Injectable({ providedIn: 'root' })
export class HapticsService {
  readonly supported = signal<boolean>(typeof navigator !== 'undefined' && 'vibrate' in navigator);

  private fire(pattern: number | number[]): void {
    if (!this.supported()) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* OS-level denial */
    }
  }

  tick(): void {
    this.fire(8);
  }

  vampire(): void {
    this.fire([35, 60, 35]);
  }

  dirty(): void {
    this.fire([90, 40, 90, 40, 140]);
  }

  arc(): void {
    this.fire([220]);
  }

  success(): void {
    this.fire([20, 40, 20, 40, 60]);
  }
}
