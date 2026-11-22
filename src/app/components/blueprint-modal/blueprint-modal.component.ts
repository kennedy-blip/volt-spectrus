import { Component, effect, inject, signal } from '@angular/core';
import { UiStateService, type BlueprintPayload, type ApplianceBlueprintPayload } from '../../services/ui-state.service';

type Payload = BlueprintPayload | ApplianceBlueprintPayload;

/**
 * Full-screen Electrical Engineering Blueprint & Polyglot Code Inspector.
 * Opens with the depth-push backdrop (app shell scales to 0.94 / blur).
 */
@Component({
  selector: 'vs-blueprint-modal',
  standalone: true,
  template: `
    @if (payload(); as p) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal glass glass-strong blueprint" role="dialog" aria-modal="true"
             (click)="$event.stopPropagation()">
          <header>
            <div>
              <h3>{{ p.title }}</h3>
              <p class="muted" style="font-size:12.5px">{{ p.subtitle }}</p>
            </div>
            <div class="right">
              <span class="badge info">{{ p.language }}</span>
              <button class="icon-btn" (click)="close()" aria-label="Close">✕</button>
            </div>
          </header>

          <div class="modal-body">
            <div class="stat-row mb">
              @for (m of p.meta; track m.label) {
                <div class="stat">
                  <div class="label">{{ m.label }}</div>
                  <div class="value small">{{ m.value }}</div>
                </div>
              }
            </div>

            <div class="code-view">{{ p.source }}</div>

            <div class="row mt">
              <button class="btn" (click)="copy(p)">⧉ Copy source</button>
              <span class="hint">{{ p.source.length }} chars · read-only inspector</span>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class BlueprintModalComponent {
  private readonly ui = inject(UiStateService);
  readonly payload = this.ui.blueprint;
  readonly copied = signal(false);

  constructor() {
    effect((onCleanup) => {
      const open = this.ui.blueprint();
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') this.close();
      };
      if (open) window.addEventListener('keydown', handler);
      onCleanup(() => window.removeEventListener('keydown', handler));
    });
  }

  close(): void {
    this.ui.closeBlueprint();
  }

  async copy(p: Payload): Promise<void> {
    try {
      await navigator.clipboard.writeText(p.source);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    } catch {
      /* clipboard denied */
    }
  }
}
