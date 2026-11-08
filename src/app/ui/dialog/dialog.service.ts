import { Injectable, signal } from '@angular/core';

export type DialogRequest =
  | { kind: 'prompt'; title: string; label: string; value: string; ok: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; ok: string; resolve: (v: boolean) => void }
  | { kind: 'message'; title: string; message: string; resolve: () => void }
  | { kind: 'layout-json' }
  | { kind: 'layouts' }
  | { kind: 'help' };

/** Opens one modal dialog at a time. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly current = signal<DialogRequest | null>(null);

  prompt(title: string, label: string, value = '', ok = 'OK'): Promise<string | null> {
    return new Promise(resolve => this.current.set({ kind: 'prompt', title, label, value, ok, resolve }));
  }

  confirm(title: string, message: string, ok = 'OK'): Promise<boolean> {
    return new Promise(resolve => this.current.set({ kind: 'confirm', title, message, ok, resolve }));
  }

  message(title: string, message: string): Promise<void> {
    return new Promise(resolve => this.current.set({ kind: 'message', title, message, resolve }));
  }

  open(kind: 'layout-json' | 'layouts' | 'help'): void {
    this.current.set({ kind });
  }

  close(): void {
    this.current.set(null);
  }
}
