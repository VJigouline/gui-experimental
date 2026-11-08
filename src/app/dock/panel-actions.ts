import { Injectable, inject } from '@angular/core';
import { CHANNELS } from '../core/bus/panel-bus';
import { DropTarget } from '../core/layout/layout.model';
import { LayoutService } from '../core/layout/layout.service';
import { stackOfPanel, windowOfNode } from '../core/layout/layout.ops';
import { DialogService } from '../ui/dialog/dialog.service';
import { MenuEntry } from '../ui/menu/menu.service';
import { DockDrag } from './dock-drag.service';

/** The menus and commands for panels, shared by tabs, windows and the menu bar. */
@Injectable()
export class PanelActions {
  private readonly layoutService = inject(LayoutService);
  private readonly dialogs = inject(DialogService);
  private readonly drag = inject(DockDrag);

  /** Items to add each panel type, at a target or in the largest stack. They can be dragged into place too. */
  addPanelEntries(target?: DropTarget): MenuEntry[] {
    return this.layoutService.panelTypes.map(t => ({
      label: t.title,
      icon: t.icon,
      hint: `${t.description}${t.multiple ? '' : ' (one only)'} — click to add, or drag into place`,
      action: () => this.layoutService.addPanel(t.type, target),
      press: (e: PointerEvent, close: () => void) => this.drag.pressNew(e, t.type, close),
    }));
  }

  channelEntries(panelId: string): MenuEntry[] {
    const current = this.layoutService.layout().panels[panelId]?.channel;
    return CHANNELS.map(c => ({
      label: c.label,
      swatch: c.color,
      checked: c.id === current,
      action: () => this.layoutService.setChannel(panelId, c.id),
    }));
  }

  /** The menu for one panel, on its tab. */
  panelMenu(panelId: string): MenuEntry[] {
    const layout = this.layoutService.layout();
    const s = stackOfPanel(layout, panelId);
    const floating = !!(s && windowOfNode(layout, s.id));
    return [
      { label: 'Link channel', icon: '⛓', children: this.channelEntries(panelId) },
      { label: 'Rename…', icon: '✎', action: () => this.rename(panelId) },
      'separator',
      { label: 'Float in a window', icon: '⧉', disabled: floating && s!.panels.length === 1, action: () => this.float(panelId) },
      {
        label: layout.maximized === s?.id ? 'Restore' : 'Maximize',
        icon: '⤢',
        disabled: floating,
        action: () => s && this.layoutService.toggleMaximized(s.id),
      },
      'separator',
      {
        label: 'Close others in this stack',
        disabled: !s || s.panels.length < 2,
        action: () => s?.panels.filter(p => p !== panelId).forEach(p => this.layoutService.closePanel(p)),
      },
      { label: 'Close', icon: '✕', action: () => this.layoutService.closePanel(panelId) },
    ];
  }

  async rename(panelId: string): Promise<void> {
    const title = this.layoutService.layout().panels[panelId]?.title ?? '';
    const t = await this.dialogs.prompt('Rename panel', 'Title', title, 'Rename');
    if (t) this.layoutService.renamePanel(panelId, t);
  }

  /** Moves a panel into a new floating window, cascaded from the last. */
  float(panelId: string): void {
    const n = this.layoutService.layout().floating.length;
    this.layoutService.floatPanel(panelId, 80 + 28 * (n % 8), 60 + 28 * (n % 8), 460, 340);
  }
}
