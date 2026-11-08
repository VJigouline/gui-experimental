import { Component, ElementRef, computed, inject, input } from '@angular/core';
import { channelInfo } from '../core/bus/panel-bus';
import { StackNode } from '../core/layout/layout.model';
import { LayoutService } from '../core/layout/layout.service';
import { windowOfNode } from '../core/layout/layout.ops';
import { MenuService } from '../ui/menu/menu.service';
import { DockDrag } from './dock-drag.service';
import { PanelActions } from './panel-actions';
import { PanelSlot } from './panel-slot';

/** A rectangle of tabbed panels: a tab strip with its buttons, and the panel shown. */
@Component({
  selector: 'app-dock-stack',
  imports: [PanelSlot],
  host: {
    class: 'dock-stack',
    '[attr.data-stack-id]': 'node().id',
    '[attr.data-empty]': 'node().panels.length === 0',
    '[class.maximized]': 'maximized()',
    '[class.focused]': 'focused()',
  },
  template: `
    <div class="stack-header">
      <div class="tab-strip" data-tab-strip role="tablist" (dblclick)="onStripDblClick($event)">
        @for (tab of tabs(); track tab.id) {
          <div
            class="tab"
            role="tab"
            tabindex="0"
            [attr.data-tab-id]="tab.id"
            [attr.aria-selected]="tab.id === node().active"
            [class.active]="tab.id === node().active"
            [title]="tab.title + ' — ' + tab.channel.label + '. Drag to move; Ctrl+drag to float.'"
            (pointerdown)="onTabPress($event, tab.id)"
            (click)="layout.activate(tab.id)"
            (dblclick)="toggleMaximized($event)"
            (contextmenu)="openTabMenu($event, tab.id)"
            (keydown.enter)="layout.activate(tab.id)"
            (auxclick)="onAuxClick($event, tab.id)">
            <span class="tab-channel" [style.background]="tab.channel.color" [class.unlinked]="tab.channel.id === 'none'"></span>
            <span class="tab-icon">{{ tab.icon }}</span>
            <span class="tab-title">{{ tab.title }}</span>
            <button
              type="button"
              class="tab-close"
              title="Close"
              aria-label="Close panel"
              (pointerdown)="$event.stopPropagation()"
              (click)="$event.stopPropagation(); layout.closePanel(tab.id)">
              ✕
            </button>
          </div>
        }
      </div>
      <div class="stack-actions">
        <button type="button" class="icon-btn" title="Add a panel here" aria-label="Add a panel" (click)="openAddMenu($event)">＋</button>
        @if (node().active; as active) {
          <button type="button" class="icon-btn" title="Panel menu" aria-label="Panel menu" (click)="openPanelMenu($event, active)">⋮</button>
        }
        @if (!inWindow() && node().panels.length) {
          <button type="button" class="icon-btn" title="Float this stack in a window" aria-label="Float" (click)="floatStack()">⧉</button>
          <button
            type="button"
            class="icon-btn"
            [title]="maximized() ? 'Restore' : 'Maximize'"
            [attr.aria-label]="maximized() ? 'Restore' : 'Maximize'"
            (click)="layout.toggleMaximized(node().id)">
            {{ maximized() ? '🗗' : '🗖' }}
          </button>
        }
      </div>
    </div>
    <div class="stack-body" data-stack-body>
      @if (node().active; as active) {
        <div class="panel-slot" [appPanelSlot]="active"></div>
      } @else {
        <div class="panel-empty">
          <p>No panels here.</p>
          <button type="button" class="btn" (click)="openAddMenu($event)">Add a panel…</button>
        </div>
      }
    </div>
  `,
})
export class DockStack {
  readonly node = input.required<StackNode>();

  protected readonly layout = inject(LayoutService);
  private readonly drag = inject(DockDrag);
  private readonly menus = inject(MenuService);
  private readonly actions = inject(PanelActions);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly tabs = computed(() => {
    const panels = this.layout.layout().panels;
    return this.node().panels.map(id => {
      const p = panels[id];
      return {
        id,
        title: p?.title ?? id,
        icon: (p && this.layout.typeOf(p.type)?.icon) ?? '?',
        channel: channelInfo(p?.channel ?? 'none'),
      };
    });
  });

  protected readonly maximized = computed(() => this.layout.layout().maximized === this.node().id);
  protected readonly inWindow = computed(() => !!windowOfNode(this.layout.layout(), this.node().id));
  protected readonly focused = computed(() => this.drag.state()?.target?.kind === 'stack' && (this.drag.state()?.target as { stackId: string }).stackId === this.node().id);

  protected onTabPress(event: PointerEvent, panelId: string): void {
    if (event.button === 0) this.drag.pressPanel(event, panelId);
  }

  protected onAuxClick(event: MouseEvent, panelId: string): void {
    if (event.button === 1) {
      event.preventDefault();
      this.layout.closePanel(panelId);
    }
  }

  protected toggleMaximized(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.inWindow()) this.layout.toggleMaximized(this.node().id);
  }

  protected onStripDblClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.toggleMaximized(event);
  }

  protected openTabMenu(event: MouseEvent, panelId: string): void {
    event.preventDefault();
    this.layout.activate(panelId);
    this.menus.show(this.actions.panelMenu(panelId), { x: event.clientX, y: event.clientY });
  }

  protected openPanelMenu(event: MouseEvent, panelId: string): void {
    this.menus.show(this.actions.panelMenu(panelId), event.currentTarget as HTMLElement);
  }

  protected openAddMenu(event: MouseEvent): void {
    this.menus.show(
      this.actions.addPanelEntries({ kind: 'stack', stackId: this.node().id, zone: 'center' }),
      event.currentTarget as HTMLElement,
    );
  }

  protected floatStack(): void {
    const ws = this.el.closest('.workspace')?.getBoundingClientRect();
    const r = this.el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 320), 640);
    const height = Math.min(Math.max(r.height, 240), 480);
    const x = (ws ? r.left - ws.left : r.left) + 24;
    const y = (ws ? r.top - ws.top : r.top) + 24;
    this.layout.floatStack(this.node().id, x, y, width, height);
  }
}
