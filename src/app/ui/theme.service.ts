import { Injectable, signal } from '@angular/core';

const KEY = 'app-theme';

/** Dark or light theme, set by a class on the document element and kept in `localStorage`. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal(true);

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      stored = null;
    }
    this.apply(stored !== 'light');
  }

  toggle(): void {
    this.apply(!this.dark());
  }

  private apply(dark: boolean): void {
    this.dark.set(dark);
    const root = document.documentElement;
    root.classList.toggle('theme-dark', dark);
    root.classList.toggle('theme-light', !dark);
    try {
      localStorage.setItem(KEY, dark ? 'dark' : 'light');
    } catch {
      // Not kept; the theme still applies now.
    }
  }
}
