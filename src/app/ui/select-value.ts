import { Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

/**
 * Sets a `<select>`'s value after its options have rendered. Binding `[value]` on the select
 * itself sets it before `@for` options exist, so the browser shows the first option instead.
 */
@Directive({ selector: 'select[appSelectValue]' })
export class SelectValue {
  readonly value = input.required<unknown>({ alias: 'appSelectValue' });

  constructor() {
    const el = inject<ElementRef<HTMLSelectElement>>(ElementRef).nativeElement;
    afterRenderEffect(() => {
      const v = String(this.value() ?? '');
      if (el.value !== v) el.value = v;
    });
  }
}
