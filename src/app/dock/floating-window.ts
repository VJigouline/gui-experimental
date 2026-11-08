import { Component, computed, inject, input } from '@angular/core';
import { FloatingWindow } from '../core/layout/layout.model';
import { LayoutService } from '../core/layout/layout.service';
import { stacksOf } from '../core/layout/layout.ops';
import { DockNode } from './dock-node';

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** A window over the docked area, moved by its title bar and resized by its edges. */
@Component({
  selector: 'app-floating-window',
  imports: [DockNode],
  host: {
    class: 'floating-window',
    role: 'dialog',
    '[attr.aria-label]': 'title()',
    '[attr.data-window-id]': 'window().id',
    '[style.left.px]': 'window().x',
    '[style.top.px]': 'window().y',
    '[style.width.px]': 'window().width',
    '[style.height.px]': 'window().height',
    '[style.z-index]': '20 + index()',
    '(pointerdown)': 'layout.raiseWindow(window().id)',
  },
  template: `
    <div class="window-titlebar" (pointerdown)="startMove($event)" (dblclick)="layout.dockWindow(window().id)">
      <span class="window-title">{{ title() }}</span>
      <button type="button" class="icon-btn" title="Dock to the right of the workspace" aria-label="Dock" (pointerdown)="$event.stopPropagation()" (click)="layout.dockWindow(window().id)">⇲</button>
      <button type="button" class="icon-btn" title="Close the window and its panels" aria-label="Close window" (pointerdown)="$event.stopPropagation()" (click)="layout.closeWindow(window().id)">✕</button>
    </div>
    <app-dock-node class="window-content" [node]="window().root" />
    @for (edge of edges; track edge) {
      <div class="window-resize" [class]="'window-resize edge-' + edge" (pointerdown)="startResize($event, edge)"></div>
    }
  `,
})
export class FloatingWindowView {
  readonly window = input.required<FloatingWindow>();
  readonly index = input(0);

  protected readonly layout = inject(LayoutService);
  protected readonly edges: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  protected readonly title = computed(() => {
    const panels = this.layout.layout().panels;
    return stacksOf(this.window().root)
      .map(s => (s.active ? panels[s.active]?.title : undefined))
      .filter(Boolean)
      .join(' · ');
  });

  protected startMove(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const w = this.window();
    this.track(event, (dx, dy, ws) => ({
      x: clamp(w.x + dx, -w.width + 80, ws.width - 80),
      y: clamp(w.y + dy, 0, ws.height - 28),
    }));
  }

  protected startResize(event: PointerEvent, edge: Edge): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.layout.raiseWindow(this.window().id);
    const w = this.window();
    const minW = 200;
    const minH = 120;
    this.track(event, (dx, dy) => {
      let { x, y, width, height } = w;
      if (edge.includes('e')) width = Math.max(minW, w.width + dx);
      if (edge.includes('s')) height = Math.max(minH, w.height + dy);
      if (edge.includes('w')) {
        width = Math.max(minW, w.width - dx);
        x = w.x + w.width - width;
      }
      if (edge.includes('n')) {
        height = Math.max(minH, w.height - dy);
        y = Math.max(0, w.y + w.height - height);
        height = w.y + w.height - y;
      }
      return { x, y, width, height };
    });
  }

  /** Follows the pointer, applying the window change that `fn` gives for each move. */
  private track(event: PointerEvent, fn: (dx: number, dy: number, workspace: DOMRect) => Partial<FloatingWindow>): void {
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const ws = target.closest('.workspace')!.getBoundingClientRect();
    const sx = event.clientX;
    const sy = event.clientY;
    const id = this.window().id;
    document.body.classList.add('window-moving');
    const move = (e: PointerEvent) => {
      const patch = fn(e.clientX - sx, e.clientY - sy, ws);
      this.layout.moveWindow(id, {
        ...patch,
        ...(patch.x !== undefined ? { x: Math.round(patch.x) } : {}),
        ...(patch.y !== undefined ? { y: Math.round(patch.y) } : {}),
      });
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      document.body.classList.remove('window-moving');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max));
}
