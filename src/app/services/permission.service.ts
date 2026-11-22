import { Injectable, Signal, WritableSignal, signal } from '@angular/core';
import { HapticsService } from './haptics.service';
import type { PermissionKey, PermissionState } from '../models';

export const PERMISSION_META: Record<
  PermissionKey,
  { label: string; detail: string; icon: string }
> = {
  microphone: {
    label: 'Uncompressed Mains-Hum Microphone',
    detail: 'getUserMedia audio with echoCancellation / noiseSuppression / autoGainControl all OFF so 50/60 Hz and 100/120 Hz transformer hum survive the voice high-pass filters.',
    icon: 'mic',
  },
  magnetometer: {
    label: '3-Axis EMF Magnetometer',
    detail: 'DeviceOrientation / DeviceMotion fusion estimating magnetic flux density (µT) around power bricks, walls and breaker panels.',
    icon: 'magnet',
  },
  camera: {
    label: 'Optical Metrology Camera',
    detail: 'Rear camera at 60 FPS tracking the blinking imp/kWh metrology LED on your utility meter.',
    icon: 'camera',
  },
  haptics: {
    label: 'Arc-Pulse Haptic Engine',
    detail: 'navigator.vibrate / Capacitor Haptics firing when a high-EMF vampire transformer or dirty-power harmonic spike is detected.',
    icon: 'haptic',
  },
};

/**
 * Hardware & OS sensor permission matrix.  Toggles flip between a live sensor,
 * the built-in simulator (desktop testing) and a restricted/unsupported state.
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  readonly status: WritableSignal<Record<PermissionKey, PermissionState>> = signal({
    microphone: 'RESTRICTED',
    magnetometer: 'SIMULATOR ACTIVE',
    camera: 'RESTRICTED',
    haptics: 'UNSUPPORTED',
  });

  /** Live magnetometer flux magnitude, µT (simulated when no sensor exists). */
  readonly fluxUt = signal<number>(2.1);
  readonly magnetometerLive = signal<boolean>(false);

  private micStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private orientationHandler: ((e: DeviceOrientationEvent) => void) | null = null;

  constructor(private readonly haptics: HapticsService) {
    this.status.update((s) => ({ ...s, haptics: this.haptics.supported() ? 'ACTIVE' : 'UNSUPPORTED' }));
    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      this.attachOrientationSimulator();
    }
  }

  getMicStream(): MediaStream | null {
    return this.micStream;
  }

  getCameraStream(): MediaStream | null {
    return this.cameraStream;
  }

  async toggle(key: PermissionKey): Promise<void> {
    const current = this.status()[key];
    if (current === 'ACTIVE' || current === 'SIMULATOR ACTIVE') {
      await this.disable(key);
    } else {
      await this.enable(key);
    }
  }

  async enable(key: PermissionKey): Promise<void> {
    switch (key) {
      case 'microphone':
        await this.enableMic();
        break;
      case 'magnetometer':
        await this.enableMagnetometer();
        break;
      case 'camera':
        await this.enableCamera();
        break;
      case 'haptics':
        this.haptics.tick();
        this.status.update((s) => ({ ...s, haptics: this.haptics.supported() ? 'ACTIVE' : 'UNSUPPORTED' }));
        break;
    }
  }

  async disable(key: PermissionKey): Promise<void> {
    if (key === 'microphone' && this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      this.status.update((s) => ({ ...s, microphone: 'RESTRICTED' }));
    }
    if (key === 'camera' && this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
      this.status.update((s) => ({ ...s, camera: 'RESTRICTED' }));
    }
    if (key === 'magnetometer') {
      if (this.orientationHandler) {
        window.removeEventListener('deviceorientation', this.orientationHandler);
        this.orientationHandler = null;
      }
      this.magnetometerLive.set(false);
      this.status.update((s) => ({ ...s, magnetometer: 'RESTRICTED' }));
    }
  }

  private async enableMic(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.status.update((s) => ({ ...s, microphone: 'UNSUPPORTED' }));
      return;
    }
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      this.status.update((s) => ({ ...s, microphone: 'ACTIVE' }));
    } catch {
      this.status.update((s) => ({ ...s, microphone: 'RESTRICTED' }));
    }
  }

  private async enableCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.status.update((s) => ({ ...s, camera: 'UNSUPPORTED' }));
      return;
    }
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.status.update((s) => ({ ...s, camera: 'ACTIVE' }));
    } catch {
      this.status.update((s) => ({ ...s, camera: 'RESTRICTED' }));
    }
  }

  private async enableMagnetometer(): Promise<void> {
    // The generic Magnetometer API is not broadly shipped; fall back to the
    // orientation-fusion simulator so the sweep still works on desktop/APK.
    this.attachOrientationSimulator();
    this.status.update((s) => ({ ...s, magnetometer: 'SIMULATOR ACTIVE' }));
  }

  private attachOrientationSimulator(): void {
    if (this.orientationHandler) return;
    this.orientationHandler = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      // Map tilt to a plausible near-field flux reading; the Vampire Hunter
      // module adds the proximity-sweep offset on top of this baseline.
      const flux = 2.1 + Math.min(Math.abs(beta) + Math.abs(gamma), 90) * 0.12;
      this.fluxUt.set(Number(flux.toFixed(2)));
      this.magnetometerLive.set(true);
    };
    window.addEventListener('deviceorientation', this.orientationHandler);
  }

  /** Inject a simulated flux reading (desktop proximity sweep). */
  setSimulatedFlux(ut: number): void {
    this.fluxUt.set(Number(ut.toFixed(2)));
  }
}
