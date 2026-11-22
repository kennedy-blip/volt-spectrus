import { Injectable, signal } from '@angular/core';

export interface BlueprintPayload {
  title: string;
  subtitle: string;
  language: string;
  source: string;
  meta: { label: string; value: string }[];
}

export interface ApplianceBlueprintPayload {
  kind: 'vampire' | 'audit' | 'meter';
  title: string;
  subtitle: string;
  language: string;
  source: string;
  meta: { label: string; value: string }[];
}

/**
 * Cross-component chrome state: drawers, modals and the shared-element
 * blueprint inspector.  Kept separate from telemetry so pure UI concerns do
 * not pollute the energy data store.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  readonly drawerOpen = signal<boolean>(false);
  readonly apkOpen = signal<boolean>(false);
  readonly blueprint = signal<BlueprintPayload | ApplianceBlueprintPayload | null>(null);

  openDrawer(): void {
    this.drawerOpen.set(true);
  }
  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  openApk(): void {
    this.apkOpen.set(true);
  }
  closeApk(): void {
    this.apkOpen.set(false);
  }

  openBlueprint(payload: BlueprintPayload | ApplianceBlueprintPayload): void {
    this.blueprint.set(payload);
  }
  closeBlueprint(): void {
    this.blueprint.set(null);
  }
}
