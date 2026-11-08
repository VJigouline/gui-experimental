import { Injectable, signal } from '@angular/core';

export interface MenuItem {
  label: string;
  /** A symbol before the label. */
  icon?: string;
  /** A colour swatch before the label, such as a channel's colour. */
  swatch?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  action?: () => void;
  children?: MenuEntry[];
  /**
   * Called on a press, so the item can be dragged as well as clicked. The
   * menu closes when the drag starts.
   */
  press?: (event: PointerEvent, closeMenu: () => void) => void;
  hint?: string;
}

export type MenuEntry = MenuItem | 'separator';

export interface OpenMenu {
  entries: MenuEntry[];
  x: number;
  y: number;
  /** The element that opened it, which a second click closes it on. */
  anchor: HTMLElement | null;
  /** For menus in the menu bar, so hovering moves between them. */
  group?: string;
}

/** Shows one popup menu at a time. */
@Injectable({ providedIn: 'root' })
export class MenuService {
  readonly open = signal<OpenMenu | null>(null);

  /** Opens a menu below an element, or at a point. A second call for the same element closes it. */
  show(entries: MenuEntry[], at: HTMLElement | { x: number; y: number }, group?: string): void {
    if (at instanceof HTMLElement) {
      if (this.open()?.anchor === at) {
        this.close();
        return;
      }
      const r = at.getBoundingClientRect();
      this.open.set({ entries, x: r.left, y: r.bottom + 2, anchor: at, group });
    } else {
      this.open.set({ entries, x: at.x, y: at.y, anchor: null, group });
    }
  }

  close(): void {
    this.open.set(null);
  }
}
