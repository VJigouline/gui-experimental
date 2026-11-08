import { Component, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { MenuItem, MenuService } from './menu.service';

/** Draws the open popup menu, with one level of submenus. */
@Component({
  selector: 'app-menu-host',
  host: { '(document:keydown.escape)': 'menu.close()' },
  template: `
    @if (menu.open(); as open) {
      <div class="menu-backdrop" (pointerdown)="menu.close()" (contextmenu)="$event.preventDefault(); menu.close()"></div>
      <div class="menu-popup" #popup role="menu" [style.left.px]="pos().x" [style.top.px]="pos().y" (keydown)="onKey($event)">
        @for (entry of open.entries; track $index) {
          @if (entry === 'separator') {
            <div class="menu-separator" role="separator"></div>
          } @else {
            <button
              type="button"
              class="menu-item"
              role="menuitem"
              [class.has-children]="!!entry.children"
              [class.open]="submenu() === entry"
              [disabled]="entry.disabled"
              [attr.aria-checked]="entry.checked ?? null"
              [title]="entry.hint ?? ''"
              (pointerenter)="hover(entry, $event)"
              (pointerdown)="press(entry, $event)"
              (click)="choose(entry, $event)">
              <span class="menu-check">{{ entry.checked ? '✓' : '' }}</span>
              @if (entry.swatch) {
                <span class="menu-swatch" [style.background]="entry.swatch"></span>
              } @else {
                <span class="menu-icon">{{ entry.icon ?? '' }}</span>
              }
              <span class="menu-label">{{ entry.label }}</span>
              <span class="menu-shortcut">{{ entry.children ? '▸' : (entry.shortcut ?? '') }}</span>
            </button>
          }
        }
      </div>
      @if (submenu(); as sub) {
        <div class="menu-popup" role="menu" [style.left.px]="subPos().x" [style.top.px]="subPos().y">
          @for (entry of sub.children; track $index) {
            @if (entry === 'separator') {
              <div class="menu-separator" role="separator"></div>
            } @else {
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                [disabled]="entry.disabled"
                [attr.aria-checked]="entry.checked ?? null"
                [title]="entry.hint ?? ''"
                (pointerdown)="press(entry, $event)"
                (click)="choose(entry, $event)">
                <span class="menu-check">{{ entry.checked ? '✓' : '' }}</span>
                @if (entry.swatch) {
                  <span class="menu-swatch" [style.background]="entry.swatch"></span>
                } @else {
                  <span class="menu-icon">{{ entry.icon ?? '' }}</span>
                }
                <span class="menu-label">{{ entry.label }}</span>
                <span class="menu-shortcut">{{ entry.shortcut ?? '' }}</span>
              </button>
            }
          }
        </div>
      }
    }
  `,
})
export class MenuHost {
  protected readonly menu = inject(MenuService);
  private readonly popup = viewChild<ElementRef<HTMLElement>>('popup');

  protected readonly submenu = signal<MenuItem | null>(null);
  private readonly subAnchor = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  /** The menu's position after keeping it on screen. */
  protected readonly pos = signal({ x: 0, y: 0 });
  protected readonly subPos = computed(() => {
    const a = this.subAnchor();
    const w = 240;
    return { x: a.x + w > window.innerWidth ? Math.max(0, this.pos().x - w + 4) : a.x, y: a.y };
  });

  constructor() {
    afterRenderEffect(() => {
      const open = this.menu.open();
      if (!open) {
        this.submenu.set(null);
        return;
      }
      const el = this.popup()?.nativeElement;
      const w = el?.offsetWidth ?? 220;
      const h = el?.offsetHeight ?? 200;
      const x = Math.max(0, Math.min(open.x, window.innerWidth - w - 4));
      const y = open.y + h > window.innerHeight - 4 ? Math.max(0, window.innerHeight - h - 4) : open.y;
      if (x !== this.pos().x || y !== this.pos().y) this.pos.set({ x, y });
    });
  }

  protected hover(entry: MenuItem, event: PointerEvent): void {
    if (entry.children) {
      const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.subAnchor.set({ x: r.right - 2, y: r.top - 4 });
      this.submenu.set(entry);
    } else {
      this.submenu.set(null);
    }
  }

  protected press(entry: MenuItem, event: PointerEvent): void {
    entry.press?.(event, () => this.menu.close());
  }

  protected choose(entry: MenuItem, event: MouseEvent): void {
    if (entry.disabled) return;
    if (entry.children) {
      this.hover(entry, event as PointerEvent);
      return;
    }
    this.menu.close();
    entry.action?.();
  }

  protected onKey(event: KeyboardEvent): void {
    const items = [...(this.popup()?.nativeElement.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    event.preventDefault();
  }
}
