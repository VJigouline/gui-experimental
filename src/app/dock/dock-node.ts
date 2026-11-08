import { Component, ElementRef, inject, input } from '@angular/core';
import { LayoutNode, SplitNode } from '../core/layout/layout.model';
import { LayoutService } from '../core/layout/layout.service';
import { DockStack } from './dock-stack';

/**
 * A node of the layout tree: a stack, or a split of nodes side by side or one
 * above another, with gutters between them to resize them.
 */
@Component({
  selector: 'app-dock-node',
  imports: [DockStack],
  host: {
    class: 'dock-node',
    '[class.split-row]': "node().type === 'split' && asSplit().direction === 'row'",
    '[class.split-column]': "node().type === 'split' && asSplit().direction === 'column'",
  },
  template: `
    @if (node().type === 'stack') {
      <app-dock-stack [node]="$any(node())" />
    } @else {
      @let s = asSplit();
      @for (child of s.children; track child.id; let i = $index, last = $last) {
        <app-dock-node class="split-child" [node]="child" [style.flex]="s.sizes[i] + ' 1 0px'" />
        @if (!last) {
          <div
            class="gutter"
            role="separator"
            tabindex="0"
            [attr.aria-orientation]="s.direction === 'row' ? 'vertical' : 'horizontal'"
            [attr.aria-valuenow]="Math.round(s.sizes[i] * 100)"
            title="Drag to resize; double-click to share equally"
            (pointerdown)="startResize($event, i)"
            (dblclick)="layout.equalizeSplit(s.id)"
            (keydown)="onGutterKey($event, i)"></div>
        }
      }
    }
  `,
})
export class DockNode {
  readonly node = input.required<LayoutNode>();

  protected readonly layout = inject(LayoutService);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly Math = Math;

  protected asSplit(): SplitNode {
    return this.node() as SplitNode;
  }

  /** The split's length along its direction, less its gutters. */
  private length(): number {
    const s = this.asSplit();
    const r = this.el.getBoundingClientRect();
    const gutters = [...this.el.children].filter(c => c.classList.contains('gutter'));
    const g = gutters.reduce((a, c) => a + (s.direction === 'row' ? (c as HTMLElement).offsetWidth : (c as HTMLElement).offsetHeight), 0);
    return Math.max(1, (s.direction === 'row' ? r.width : r.height) - g);
  }

  protected startResize(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const gutter = event.currentTarget as HTMLElement;
    gutter.setPointerCapture(event.pointerId);
    gutter.classList.add('active');
    document.body.classList.add(this.asSplit().direction === 'row' ? 'resizing-col' : 'resizing-row');
    const length = this.length();
    const id = this.asSplit().id;
    let last = this.asSplit().direction === 'row' ? event.clientX : event.clientY;

    const move = (e: PointerEvent) => {
      const pos = this.asSplit().direction === 'row' ? e.clientX : e.clientY;
      const delta = (pos - last) / length;
      if (delta !== 0) {
        this.layout.resizeSplit(id, index, delta);
        last = pos;
      }
    };
    const end = () => {
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', end);
      gutter.removeEventListener('pointercancel', end);
      gutter.classList.remove('active');
      document.body.classList.remove('resizing-col', 'resizing-row');
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', end);
    gutter.addEventListener('pointercancel', end);
  }

  protected onGutterKey(event: KeyboardEvent, index: number): void {
    const row = this.asSplit().direction === 'row';
    const step = (event.shiftKey ? 40 : 10) / this.length();
    const keys: Record<string, number> = row ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
    const d = keys[event.key];
    if (d) {
      event.preventDefault();
      this.layout.resizeSplit(this.asSplit().id, index, d);
    }
  }
}
