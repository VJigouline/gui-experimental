import { Injectable, signal } from '@angular/core';
import { IfcImportSettings } from '../../scene/ifc-settings';
import { StepImportSettings } from '../../scene/step-settings';

export type DialogRequest =
  | { kind: 'prompt'; title: string; label: string; value: string; ok: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; ok: string; resolve: (v: boolean) => void }
  | { kind: 'message'; title: string; message: string; resolve: () => void }
  | { kind: 'ifc-options'; files: string[]; settings: IfcImportSettings; settingsOnly: boolean; resolve: (v: IfcImportSettings | null) => void }
  | { kind: 'step-options'; files: string[]; settings: StepImportSettings; settingsOnly: boolean; resolve: (v: StepImportSettings | null) => void }
  | { kind: 'busy'; title: string; message: string }
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

  /**
   * Asks how to import IFC files, starting from `settings`. Resolves with the chosen settings,
   * or `null` if cancelled. With `settingsOnly`, it edits the settings without importing.
   */
  ifcOptions(files: string[], settings: IfcImportSettings, settingsOnly = false): Promise<IfcImportSettings | null> {
    return new Promise(resolve => this.current.set({ kind: 'ifc-options', files, settings, settingsOnly, resolve }));
  }

  /**
   * Asks how to import STEP files, starting from `settings`. Resolves with the chosen settings,
   * or `null` if cancelled. With `settingsOnly`, it edits the settings without importing.
   */
  stepOptions(files: string[], settings: StepImportSettings, settingsOnly = false): Promise<StepImportSettings | null> {
    return new Promise(resolve => this.current.set({ kind: 'step-options', files, settings, settingsOnly, resolve }));
  }

  /** Shows a message that can't be dismissed, until `close` or another dialog replaces it. */
  busy(title: string, message: string): void {
    this.current.set({ kind: 'busy', title, message });
  }

  open(kind: 'layout-json' | 'layouts' | 'help'): void {
    this.current.set({ kind });
  }

  close(): void {
    this.current.set(null);
  }
}
