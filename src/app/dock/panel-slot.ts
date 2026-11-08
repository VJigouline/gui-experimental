import { Directive, ElementRef, effect, inject, input, untracked } from '@angular/core';
import { PanelHost } from '../core/panels/panel-host.service';

/** Shows a panel's element inside this element. */
@Directive({ selector: '[appPanelSlot]' })
export class PanelSlot {
  readonly panelId = input.required<string>({ alias: 'appPanelSlot' });
  private readonly host = inject(PanelHost);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    effect(onCleanup => {
      const id = this.panelId();
      untracked(() => this.host.attach(id, this.el));
      onCleanup(() => this.host.detach(id, this.el));
    });
  }
}
