import { Component, DestroyRef, ElementRef, afterNextRender, inject } from '@angular/core';
import { LayoutService } from '../core/layout/layout.service';
import { DockDrag } from './dock-drag.service';
import { DockNode } from './dock-node';
import { FloatingWindowView } from './floating-window';

/** The docked layout, the floating windows over it, and the drop indicator while dragging. */
@Component({
  selector: 'app-dock-workspace',
  imports: [DockNode, FloatingWindowView],
  host: {
    class: 'workspace',
    '[class.has-maximized]': '!!layout.layout().maximized',
  },
  template: `
    <app-dock-node class="dock-root" [node]="layout.layout().root" />
    @for (w of layout.layout().floating; track w.id; let i = $index) {
      <app-floating-window [window]="w" [index]="i" />
    }
    @if (drag.state(); as d) {
      @if (d.indicator; as r) {
        <div
          class="drop-indicator"
          [class.tab-line]="d.tabLine"
          [class.float]="d.target?.kind === 'float'"
          [style.left.px]="r.left"
          [style.top.px]="r.top"
          [style.width.px]="r.width"
          [style.height.px]="r.height"></div>
      }
      <div class="drag-ghost" [style.left.px]="d.x + 12" [style.top.px]="d.y + 8">
        {{ d.label }}
        @if (!d.target) {
          <span class="drag-hint">— no drop here</span>
        } @else if (d.target.kind === 'float') {
          <span class="drag-hint">— new window</span>
        }
      </div>
    }
  `,
})
export class DockWorkspace {
  protected readonly layout = inject(LayoutService);
  protected readonly drag = inject(DockDrag);

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => this.drag.setWorkspace(el));
    inject(DestroyRef).onDestroy(() => this.drag.setWorkspace(null));

    // Keep windows reachable when the page gets smaller.
    const observer = new ResizeObserver(() => {
      const ws = el.getBoundingClientRect();
      for (const w of this.layout.layout().floating) {
        const x = Math.min(w.x, Math.max(0, ws.width - 80));
        const y = Math.min(w.y, Math.max(0, ws.height - 28));
        if (x !== w.x || y !== w.y) this.layout.moveWindow(w.id, { x, y });
      }
    });
    afterNextRender(() => observer.observe(el));
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}
