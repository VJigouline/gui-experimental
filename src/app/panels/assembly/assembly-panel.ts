import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import * as THREE from 'three';
import { channelInfo } from '../../core/bus/panel-bus';
import { PanelContext } from '../../core/panels/panel-context';
import { ProductNode, assemblyOf, isAssembly, productTree } from '../../scene/assemblies';
import { SceneDocument } from '../../scene/scene-document';

const ICONS: Record<ProductNode['kind'], string> = { assembly: '🗂', group: '▣', solid: '◈', part: '◆' };

/**
 * The product structure: assemblies, subassemblies and their parts, with how many parts each
 * holds. Select items here or in a 3D view, then combine them into an assembly; drag rows into
 * assemblies to move them, keeping where they are.
 */
@Component({
  selector: 'app-assembly-panel',
  imports: [NgTemplateOutlet],
  host: { class: 'tree-panel assembly-panel' },
  template: `
    <div class="panel-caption">
      <span class="channel-chip" [style.background]="channel().color"></span>
      Product structure · selection on {{ channel().label }}
    </div>
    <div class="panel-toolbar">
      <button
        type="button"
        class="tool-btn"
        [disabled]="!canMake()"
        title="Make an assembly of the selected items (they keep where they are). Inside an assembly, it is a subassembly."
        (click)="make()">
        🗂 Make assembly
      </button>
      <button
        type="button"
        class="tool-btn"
        [disabled]="!canDissolve()"
        title="Dissolve the selected assembly: its items move up into the one it is in"
        (click)="dissolve()">
        ⇱ Dissolve
      </button>
      <button type="button" class="tool-btn" [disabled]="!canGoUp()" title="Select the assembly the selection is in (U in a 3D view)" (click)="up()">
        ↑ Up
      </button>
      <span class="tool-sep"></span>
      <button type="button" class="tool-btn" title="Expand all" (click)="collapsed.set(emptySet())">⊞</button>
      <button type="button" class="tool-btn" title="Collapse all" (click)="collapseAll()">⊟</button>
    </div>
    <div class="panel-toolbar">
      <input class="input" type="search" placeholder="Filter" aria-label="Filter the product structure" [value]="filter()" (input)="filter.set($any($event.target).value)" />
    </div>
    <div class="tree" role="tree" tabindex="0" aria-label="Product structure" aria-multiselectable="true" (keydown)="onKey($event)">
      <div
        class="tree-row tree-root"
        [class.drop-into]="dropTarget() === null && dragging()"
        title="Drop here to take an item out of its assemblies"
        (dragover)="onDragOver($event, null)"
        (drop)="onDrop($event, null)">
        <span class="tree-icon">⌂</span><span class="tree-name">{{ doc.scene.name }}</span>
        <span class="tree-count">{{ summary() }}</span>
      </div>
      <ng-container [ngTemplateOutlet]="branch" [ngTemplateOutletContext]="{ $implicit: nodes(), depth: 1 }" />
      @if (!nodes().length) {
        <div class="panel-empty small">{{ filter() ? 'Nothing matches.' : 'No parts in the scene.' }}</div>
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
          [class.assembly-row]="n.kind === 'assembly'"
          [style.padding-left.px]="depth * 14"
          [title]="tip(n)"
          (click)="select($event, n.id)"
          (dblclick)="frame(n.id)"
          (dragstart)="onDragStart($event, n.id)"
          (dragend)="onDragEnd()"
          (dragover)="onDragOver($event, n)"
          (dragleave)="dropTarget.set(undefined)"
          (drop)="onDrop($event, n)">
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
          @if (n.partNumber) {
            <span class="tree-pn">{{ n.partNumber }}</span>
          }
          @if (n.kind === 'assembly' || n.kind === 'group') {
            <span class="tree-count">{{ n.parts }} {{ n.parts === 1 ? 'part' : 'parts' }}</span>
          }
        </div>
        @if (n.children.length && !collapsed().has(n.id)) {
          <ng-container [ngTemplateOutlet]="branch" [ngTemplateOutletContext]="{ $implicit: n.children, depth: depth + 1 }" />
        }
      }
    </ng-template>
    <p class="status-text assembly-status">{{ status() }}</p>
  `,
})
export class AssemblyPanel {
  private readonly panel = inject(PanelContext);
  protected readonly doc = inject(SceneDocument);

  protected readonly channel = computed(() => channelInfo(this.panel.channel()));
  protected readonly filter = signal('');
  protected readonly collapsed = signal(new Set<string>());
  protected readonly dropTarget = signal<string | null | undefined>(undefined);
  protected readonly dragging = signal<string | null>(null);
  protected readonly status = signal('Select parts here or in a 3D view, then Make assembly. Drag rows into assemblies to move them.');

  private readonly selection = this.panel.retained('selection');
  protected readonly selected = computed(() => new Set(this.selection()?.ids ?? []));
  private readonly selectedObjects = computed(() => {
    this.doc.revision();
    return this.doc.objects(this.selection()?.ids);
  });

  /** The product structure, filtered by name or part number. A match keeps its assemblies. */
  protected readonly nodes = computed(() => {
    this.doc.revision();
    const tree = productTree(this.doc.scene);
    const f = this.filter().trim().toLowerCase();
    if (!f) return tree;
    const keep = (n: ProductNode): ProductNode | null => {
      const children = n.children.map(keep).filter((c): c is ProductNode => !!c);
      return n.name.toLowerCase().includes(f) || n.partNumber.toLowerCase().includes(f) || children.length ? { ...n, children } : null;
    };
    return tree.map(keep).filter((n): n is ProductNode => !!n);
  });

  protected readonly summary = computed(() => {
    let assemblies = 0;
    let parts = 0;
    const visit = (nodes: ProductNode[]) =>
      nodes.forEach(n => {
        if (n.kind === 'assembly') assemblies++;
        else if (n.kind !== 'group') parts++;
        visit(n.children);
      });
    this.doc.revision();
    visit(productTree(this.doc.scene));
    return `${assemblies} ${assemblies === 1 ? 'assembly' : 'assemblies'}, ${parts} ${parts === 1 ? 'part' : 'parts'}`;
  });

  protected readonly canMake = computed(() => this.selectedObjects().some(o => !(o as THREE.Light).isLight));
  protected readonly canDissolve = computed(() => {
    const s = this.selectedObjects();
    return s.length === 1 && isAssembly(s[0]) && !!s[0].parent;
  });
  protected readonly canGoUp = computed(() => this.selectedObjects().some(o => !!assemblyOf(o)));

  /** Rows in display order, for keyboard moves and range selection. */
  private readonly order = computed(() => {
    const out: string[] = [];
    const visit = (nodes: ProductNode[]) =>
      nodes.forEach(n => {
        out.push(n.id);
        if (!this.collapsed().has(n.id)) visit(n.children);
      });
    visit(this.nodes());
    return out;
  });
  private anchor: string | null = null;

  protected icon(kind: string): string {
    return ICONS[kind as ProductNode['kind']] ?? '•';
  }

  protected emptySet(): Set<string> {
    return new Set();
  }

  protected tip(n: ProductNode): string {
    const what = { assembly: 'Assembly', group: 'Group', solid: 'Solid', part: 'Part' }[n.kind];
    const pn = n.partNumber ? ` · ${n.partNumber}` : '';
    const count = n.kind === 'assembly' || n.kind === 'group' ? ` · ${n.parts} parts in all` : '';
    return `${what}: ${n.name}${pn}${count}`;
  }

  // ------------------------------------------------------------ commands

  protected make(): void {
    const id = this.doc.makeAssembly(this.selection()?.ids ?? []);
    if (!id) {
      this.status.set('Select parts or assemblies first; lights and the shapes of solids stay where they are.');
      return;
    }
    const a = this.doc.get(id)!;
    this.status.set(`Made ${a.name} of ${productTree(a.parent ?? this.doc.scene).find(n => n.id === id)?.parts ?? 0} parts. Name it in Properties.`);
    this.collapsed.update(s => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    this.panel.publish('selection', { ids: [id] }, true);
  }

  protected dissolve(): void {
    const a = this.selectedObjects()[0];
    const name = a.name;
    const ids = this.doc.ungroup(a.uuid);
    this.status.set(`Dissolved ${name}; its ${ids.length} items are selected.`);
    this.panel.publish('selection', { ids }, true);
  }

  /** Selects the assemblies the selected items are in. */
  protected up(): void {
    const ids = [...new Set(this.selectedObjects().map(o => assemblyOf(o)?.uuid).filter((x): x is string => !!x))];
    if (ids.length) this.panel.publish('selection', { ids }, true);
  }

  // ------------------------------------------------------------ selection

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

  protected collapseAll(): void {
    const all = new Set<string>();
    const visit = (nodes: ProductNode[]) =>
      nodes.forEach(n => {
        if (n.children.length) all.add(n.id);
        visit(n.children);
      });
    visit(this.nodes());
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
      case 'Enter':
        if (ids.length) this.panel.publish('viewport.command', { action: 'fit', ids });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // ------------------------------------------------------------ moving by drag

  protected onDragStart(event: DragEvent, id: string): void {
    event.dataTransfer?.setData('application/x-scene-object', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.dragging.set(id);
  }

  protected onDragEnd(): void {
    this.dragging.set(null);
    this.dropTarget.set(undefined);
  }

  /** Items go into assemblies and groups, or onto the top row to leave them. */
  protected onDragOver(event: DragEvent, n: ProductNode | null): void {
    const dragged = this.dragging();
    if (!dragged || dragged === n?.id) return;
    if (n && n.kind !== 'assembly' && n.kind !== 'group') return;
    event.preventDefault();
    event.stopPropagation();
    this.dropTarget.set(n?.id ?? null);
  }

  protected onDrop(event: DragEvent, n: ProductNode | null): void {
    event.preventDefault();
    const dragged = this.dragging();
    this.onDragEnd();
    if (!dragged) return;
    const o = this.doc.get(dragged);
    if (this.doc.reparent(dragged, n?.id ?? null)) {
      this.status.set(n ? `Moved ${o?.name} into ${n.name}.` : `Took ${o?.name} out of its assemblies.`);
    }
  }
}
