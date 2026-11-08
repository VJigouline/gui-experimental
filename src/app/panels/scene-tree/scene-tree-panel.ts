import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PanelContext } from '../../core/panels/panel-context';
import { SceneDocument, SceneTreeNode } from '../../scene/scene-document';

const ICONS: Record<string, string> = { Mesh: '◆', Group: '▣', Light: '☀', Line: '╱', Points: '∴' };

/**
 * The scene's objects as a tree. Selecting here selects in the 3D views and
 * properties on the same channel; double-clicking frames the object in them.
 * Drag a row onto another to put it inside, or onto the top row to take it out.
 */
@Component({
  selector: 'app-scene-tree-panel',
  imports: [NgTemplateOutlet],
  host: { class: 'tree-panel' },
  template: `
    <div class="panel-toolbar">
      <input
        class="input"
        type="search"
        placeholder="Filter"
        aria-label="Filter objects"
        [value]="filter()"
        (input)="filter.set($any($event.target).value)" />
      <button type="button" class="tool-btn" title="Expand all" (click)="expandAll()">⊞</button>
      <button type="button" class="tool-btn" title="Collapse all" (click)="collapseAll()">⊟</button>
    </div>
    <div
      class="tree"
      role="tree"
      tabindex="0"
      aria-label="Scene objects"
      aria-multiselectable="true"
      (keydown)="onKey($event)">
      <div
        class="tree-row tree-root"
        [class.drop-into]="dropTarget() === null && dragging()"
        (dragover)="onDragOver($event, null)"
        (drop)="onDrop($event, null)">
        <span class="tree-icon">⌂</span><span class="tree-name">{{ doc.scene.name }}</span>
        <span class="tree-count">{{ doc.objectCount() }} objects</span>
      </div>
      <ng-container [ngTemplateOutlet]="branch" [ngTemplateOutletContext]="{ $implicit: nodes(), depth: 1 }" />
      @if (!nodes().length) {
        <div class="panel-empty small">{{ filter() ? 'Nothing matches.' : 'The scene is empty.' }}</div>
      }
    </div>

    <ng-template #branch let-nodes let-depth="depth">
      @for (n of $any(nodes); track n.id) {
        <div
          class="tree-row"
          role="treeitem"
          draggable="true"
          [attr.aria-selected]="selected().has(n.id)"
          [attr.aria-expanded]="n.children.length ? !collapsed().has(n.id) : null"
          [class.selected]="selected().has(n.id)"
          [class.hidden-object]="!n.visible"
          [class.drop-into]="dropTarget() === n.id"
          [style.padding-left.px]="depth * 14"
          (click)="select($event, n.id)"
          (dblclick)="frame(n.id)"
          (dragstart)="onDragStart($event, n.id)"
          (dragend)="onDragEnd()"
          (dragover)="onDragOver($event, n.id)"
          (dragleave)="dropTarget.set(undefined)"
          (drop)="onDrop($event, n.id)">
          <button
            type="button"
            class="tree-toggle"
            [class.invisible]="!n.children.length"
            [attr.aria-label]="collapsed().has(n.id) ? 'Expand' : 'Collapse'"
            (click)="$event.stopPropagation(); toggleCollapsed(n.id)">
            {{ collapsed().has(n.id) ? '▸' : '▾' }}
          </button>
          <span class="tree-icon">{{ icon(n.kind) }}</span>
          <span class="tree-name">{{ n.name }}</span>
          <button
            type="button"
            class="tree-eye"
            [title]="n.visible ? 'Hide' : 'Show'"
            [attr.aria-label]="n.visible ? 'Hide' : 'Show'"
            (click)="$event.stopPropagation(); doc.setVisible([n.id], !n.visible)">
            {{ n.visible ? '👁' : '◌' }}
          </button>
        </div>
        @if (n.children.length && !collapsed().has(n.id)) {
          <ng-container [ngTemplateOutlet]="branch" [ngTemplateOutletContext]="{ $implicit: n.children, depth: depth + 1 }" />
        }
      }
    </ng-template>
  `,
})
export class SceneTreePanel {
  private readonly panel = inject(PanelContext);
  protected readonly doc = inject(SceneDocument);

  protected readonly filter = signal('');
  protected readonly collapsed = signal(new Set<string>());
  protected readonly dropTarget = signal<string | null | undefined>(undefined);
  protected readonly dragging = signal<string | null>(null);

  private readonly selection = this.panel.retained('selection');
  protected readonly selected = computed(() => new Set(this.selection()?.ids ?? []));

  /** The tree, filtered by name. A match keeps its parents. */
  protected readonly nodes = computed(() => {
    const f = this.filter().trim().toLowerCase();
    const tree = this.doc.tree();
    if (!f) return tree;
    const keep = (n: SceneTreeNode): SceneTreeNode | null => {
      const children = n.children.map(keep).filter((c): c is SceneTreeNode => !!c);
      return n.name.toLowerCase().includes(f) || children.length ? { ...n, children } : null;
    };
    return tree.map(keep).filter((n): n is SceneTreeNode => !!n);
  });

  /** Rows in display order, for keyboard moves and range selection. */
  private readonly order = computed(() => {
    const out: string[] = [];
    const visit = (nodes: SceneTreeNode[]) =>
      nodes.forEach(n => {
        out.push(n.id);
        if (!this.collapsed().has(n.id)) visit(n.children);
      });
    visit(this.nodes());
    return out;
  });

  private anchor: string | null = null;

  protected icon(kind: string): string {
    return ICONS[kind] ?? '•';
  }

  protected select(event: MouseEvent, id: string): void {
    const current = this.selection()?.ids ?? [];
    let ids: string[];
    if (event.shiftKey && this.anchor) {
      const order = this.order();
      const a = order.indexOf(this.anchor);
      const b = order.indexOf(id);
      ids = a < 0 || b < 0 ? [id] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else if (event.ctrlKey || event.metaKey) {
      ids = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
      this.anchor = id;
    } else {
      ids = [id];
      this.anchor = id;
    }
    this.panel.publish('selection', { ids }, true);
  }

  protected frame(id: string): void {
    this.panel.publish('viewport.command', { action: 'fit', ids: [id] });
  }

  protected toggleCollapsed(id: string): void {
    this.collapsed.update(s => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  }

  protected expandAll(): void {
    this.collapsed.set(new Set());
  }

  protected collapseAll(): void {
    const all = new Set<string>();
    const visit = (nodes: SceneTreeNode[]) =>
      nodes.forEach(n => {
        if (n.children.length) all.add(n.id);
        visit(n.children);
      });
    visit(this.doc.tree());
    this.collapsed.set(all);
  }

  protected onKey(event: KeyboardEvent): void {
    const order = this.order();
    const ids = this.selection()?.ids ?? [];
    const current = ids.length ? order.indexOf(ids[ids.length - 1]) : -1;
    const go = (i: number) => {
      const id = order[Math.max(0, Math.min(order.length - 1, i))];
      if (id) {
        this.anchor = id;
        this.panel.publish('selection', { ids: [id] }, true);
      }
    };
    switch (event.key) {
      case 'ArrowDown':
        go(current + 1);
        break;
      case 'ArrowUp':
        go(current < 0 ? 0 : current - 1);
        break;
      case 'Delete':
        if (!ids.length) return;
        this.doc.remove(ids);
        this.panel.publish('selection', { ids: [] }, true);
        break;
      case 'Enter':
        if (ids.length) this.panel.publish('viewport.command', { action: 'fit', ids });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // ------------------------------------------------------------ reparenting by drag

  protected onDragStart(event: DragEvent, id: string): void {
    event.dataTransfer?.setData('application/x-scene-object', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.dragging.set(id);
  }

  protected onDragEnd(): void {
    this.dragging.set(null);
    this.dropTarget.set(undefined);
  }

  protected onDragOver(event: DragEvent, id: string | null): void {
    const dragged = this.dragging();
    if (!dragged || dragged === id) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropTarget.set(id);
  }

  protected onDrop(event: DragEvent, id: string | null): void {
    event.preventDefault();
    const dragged = this.dragging();
    this.onDragEnd();
    if (dragged) this.doc.reparent(dragged, id);
  }
}
