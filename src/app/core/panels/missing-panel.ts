import { Component, inject } from '@angular/core';
import { PanelContext } from './panel-context';

/** Shown for a panel whose type is not registered. */
@Component({
  selector: 'app-missing-panel',
  template: `<div class="panel-empty">No panel type "{{ panel.type }}" is registered.</div>`,
})
export class MissingPanel {
  protected readonly panel = inject(PanelContext);
}
