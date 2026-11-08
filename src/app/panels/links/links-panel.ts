import { Component, computed, inject } from '@angular/core';
import { CHANNELS, channelInfo } from '../../core/bus/panel-bus';
import { LayoutService } from '../../core/layout/layout.service';
import { allStacks, stacksOf, windowOfNode } from '../../core/layout/layout.ops';
import { PanelActions } from '../../dock/panel-actions';
import { SelectValue } from '../../ui/select-value';

/**
 * Every open panel, with its link channel. Panels on the same channel work
 * together: a 3D view, tree, properties and tools on Link B share a selection
 * of their own, apart from those on Link A.
 */
@Component({
  imports: [SelectValue],
  selector: 'app-links-panel',
  host: { class: 'links-panel' },
  template: `
    <div class="panel-caption">
      Panels on the same link share a selection and commands. Unlinked panels keep to themselves.
    </div>
    <table class="links-table">
      <thead>
        <tr>
          <th scope="col">Panel</th>
          <th scope="col">Link</th>
          <th scope="col">Where</th>
          <th scope="col"><span class="visually-hidden">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.id) {
          <tr [class.current]="row.visible">
            <td>
              <div class="cell-flex">
                <span class="tab-icon">{{ row.icon }}</span>
                <input class="input title-input" [value]="row.title" [attr.aria-label]="'Title of ' + row.title" (change)="rename(row.id, $event)" />
              </div>
            </td>
            <td>
              <div class="cell-flex">
                <span class="channel-chip" [style.background]="row.color"></span>
                <select class="input" [attr.aria-label]="'Link of ' + row.title" [appSelectValue]="row.channel" (change)="layout.setChannel(row.id, $any($event.target).value)">
                  @for (c of channels; track c.id) {
                    <option [value]="c.id">{{ c.label }}</option>
                  }
                </select>
              </div>
            </td>
            <td class="where">{{ row.where }}</td>
            <td class="row-actions">
              <button type="button" class="tool-btn" title="Show" (click)="layout.activate(row.id)">◉</button>
              <button type="button" class="tool-btn" title="Float in a window" (click)="actions.float(row.id)">⧉</button>
              <button type="button" class="tool-btn" title="Close" (click)="layout.closePanel(row.id)">✕</button>
            </td>
          </tr>
        }
      </tbody>
    </table>
    <div class="links-summary">
      @for (g of groups(); track g.id) {
        <div class="link-group">
          <span class="channel-chip" [style.background]="g.color"></span>
          <strong>{{ g.label }}</strong>: {{ g.titles }}
        </div>
      }
    </div>
  `,
})
export class LinksPanel {
  protected readonly layout = inject(LayoutService);
  protected readonly actions = inject(PanelActions);
  protected readonly channels = CHANNELS;

  protected readonly rows = computed(() => {
    const l = this.layout.layout();
    const docked = new Set(stacksOf(l.root).map(s => s.id));
    return allStacks(l).flatMap(s =>
      s.panels.map(id => {
        const p = l.panels[id];
        const info = channelInfo(p.channel);
        const w = docked.has(s.id) ? undefined : windowOfNode(l, s.id);
        return {
          id,
          title: p.title,
          icon: this.layout.typeOf(p.type)?.icon ?? '?',
          channel: p.channel,
          color: info.color,
          visible: s.active === id,
          where: w ? 'Window' : 'Docked',
        };
      }),
    );
  });

  protected readonly groups = computed(() =>
    CHANNELS.filter(c => c.id !== 'none')
      .map(c => ({ ...c, titles: this.rows().filter(r => r.channel === c.id).map(r => r.title).join(', ') }))
      .filter(g => g.titles),
  );

  protected rename(id: string, event: Event): void {
    this.layout.renamePanel(id, (event.target as HTMLInputElement).value);
  }
}
