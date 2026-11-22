import { Injectable, Signal, WritableSignal, signal } from '@angular/core';

/**
 * Real Hooke's-law spring integrator.
 *
 *   F = -k (x - target) - c v
 *   a = F / m
 *
 * Tuned to the VOLT-SPECTRA analog instrument spec: stiffness 320, damping 25,
 * mass 0.8 — a slightly under-damped "lab gauge" settle with one visible
 * overshoot.  Every needle, tachometer dial, harmonic bar and glass card in
 * the UI is driven by a spring from this service.
 */
export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface Spring {
  readonly value: Signal<number>;
  readonly target: Signal<number>;
  readonly velocity: Signal<number>;
  set(target: number): void;
  /** Instantaneous read without creating a reactive dependency. */
  snapshot(): number;
}

interface SpringState {
  x: number;
  v: number;
  target: number;
  cfg: SpringConfig;
  sig: WritableSignal<number>;
  velSig: WritableSignal<number>;
  targetSig: WritableSignal<number>;
}

export const DEFAULT_SPRING: SpringConfig = {
  stiffness: 320,
  damping: 25,
  mass: 0.8,
};

@Injectable({ providedIn: 'root' })
export class SpringPhysicsService {
  readonly defaults: SpringConfig = DEFAULT_SPRING;
  private readonly states = new Set<SpringState>();
  private rafId = 0;
  private lastTs = 0;
  private running = false;

  constructor() {
    if (typeof requestAnimationFrame !== 'undefined') {
      this.lastTs = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  /** Create a spring initialised at `initial`. */
  create(initial = 0, cfg: Partial<SpringConfig> = {}): Spring {
    const full: SpringConfig = { ...this.defaults, ...cfg };
    const state: SpringState = {
      x: initial,
      v: 0,
      target: initial,
      cfg: full,
      sig: signal(initial),
      velSig: signal(0),
      targetSig: signal(initial),
    };
    this.states.add(state);
    this.start();
    return {
      value: state.sig,
      target: state.targetSig,
      velocity: state.velSig,
      set: (t: number) => {
        state.target = t;
        state.targetSig.set(t);
      },
      snapshot: () => state.x,
    };
  }

  /** Destroy a spring (call from component ngOnDestroy). */
  destroy(spring: Spring): void {
    for (const s of this.states) {
      if (s.sig === spring.value) {
        this.states.delete(s);
        return;
      }
    }
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private readonly tick = (ts: number): void => {
    // Clamp dt so a background tab does not explode the integrator.
    const dt = Math.min(Math.max((ts - this.lastTs) / 1000, 0), 1 / 30);
    this.lastTs = ts;

    for (const s of this.states) {
      const { stiffness: k, damping: c, mass: m } = s.cfg;
      const displacement = s.x - s.target;
      const force = -k * displacement - c * s.v;
      const accel = force / m;
      s.v += accel * dt;
      s.x += s.v * dt;

      // Snap to rest once below visual threshold to avoid endless jitter.
      if (Math.abs(s.v) < 1e-4 && Math.abs(displacement) < 1e-4) {
        s.x = s.target;
        s.v = 0;
      }

      s.sig.set(s.x);
      s.velSig.set(s.v);
    }

    if (this.states.size > 0) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.running = false;
    }
  };

  /** Format a spring value as a CSS transform (scale) — squish & press cards. */
  static scale(x: number): string {
    return `scale(${x.toFixed(4)})`;
  }
}
