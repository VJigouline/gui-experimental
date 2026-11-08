import { Component, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { LayoutService } from '../../core/layout/layout.service';
import { LayoutError } from '../../core/layout/layout.parse';
import { IfcImportSettings, defaultIfcSettings } from '../../scene/ifc-settings';
import { downloadText, readTextFile } from '../files';
import { DialogRequest, DialogService } from './dialog.service';

/** Draws the open dialog as a modal `<dialog>`. */
@Component({
  selector: 'app-dialog-host',
  imports: [DatePipe],
  template: `
    <dialog #dialog class="dialog" [class.wide]="wide()" (cancel)="cancel($event)" (close)="onClosed()">
      @switch (request()?.kind) {
        @case ('prompt') {
          @let r = asPrompt();
          <form method="dialog" (submit)="submitPrompt($event)">
            <h2>{{ r.title }}</h2>
            <label class="field stacked">
              <span>{{ r.label }}</span>
              <input class="input" name="value" [value]="r.value" autofocus (input)="promptValue.set($any($event.target).value)" />
            </label>
            <div class="dialog-buttons">
              <button type="button" class="btn" (click)="close()">Cancel</button>
              <button type="submit" class="btn primary" [disabled]="!promptValue().trim()">{{ r.ok }}</button>
            </div>
          </form>
        }
        @case ('confirm') {
          @let r = asConfirm();
          <h2>{{ r.title }}</h2>
          <p>{{ r.message }}</p>
          <div class="dialog-buttons">
            <button type="button" class="btn" (click)="close()">Cancel</button>
            <button type="button" class="btn primary" autofocus (click)="resolveConfirm(true)">{{ r.ok }}</button>
          </div>
        }
        @case ('ifc-options') {
          @let r = asIfc();
          @let o = ifc();
          <form class="ifc-dialog" (submit)="submitIfc($event)">
            <h2>{{ r.settingsOnly ? 'IFC import settings' : 'Import IFC' }}</h2>
            @if (!r.settingsOnly) {
              <p class="hint">{{ r.files.join(', ') }}</p>
            }
            <div class="props">
              <fieldset>
                <legend>Geometry</legend>
                <label class="field" title="Subtract openings and voiding features from the walls and slabs they void.">
                  <span>Openings</span>
                  <span class="check"><input type="checkbox" [checked]="o.openings" (change)="setIfc({ openings: checked($event) })" /> Cut out of elements</span>
                </label>
                <label class="field" title="Segments for a full circle; arcs use their share.">
                  <span>Circles</span>
                  <span class="range"><input type="range" min="8" max="96" step="4" [value]="o.circleSegments" (input)="setIfc({ circleSegments: num($event) })" /><output>{{ o.circleSegments }} segments</output></span>
                </label>
                <label class="field" title="Faces meeting at less than this angle are shaded smoothly; sharper edges stay sharp.">
                  <span>Smoothing</span>
                  <span class="range"><input type="range" min="0" max="90" step="5" [value]="o.creaseAngle" (input)="setIfc({ creaseAngle: num($event) })" /><output>{{ o.creaseAngle }}°</output></span>
                </label>
              </fieldset>
              <fieldset>
                <legend>Content</legend>
                <label class="field" title="Include IfcSpace volumes, the rooms.">
                  <span>Spaces</span>
                  <span class="check"><input type="checkbox" [checked]="o.spaces" (change)="setIfc({ spaces: checked($event) })" /> Room volumes</span>
                </label>
                <label class="field" title="Include IfcOpeningElement volumes as objects of their own.">
                  <span>Openings</span>
                  <span class="check"><input type="checkbox" [checked]="o.openingElements" (change)="setIfc({ openingElements: checked($event) })" /> Opening volumes</span>
                </label>
                <label class="field" title="Read property and quantity sets, shown in Properties.">
                  <span>Properties</span>
                  <span class="check"><input type="checkbox" [checked]="o.properties" (change)="setIfc({ properties: checked($event) })" /> Property and quantity sets</span>
                </label>
              </fieldset>
            </div>
            <label class="check ask">
              <input type="checkbox" [checked]="o.ask" (change)="setIfc({ ask: checked($event) })" />
              Ask before each IFC import (File › IFC import settings… changes these later)
            </label>
            <div class="dialog-buttons">
              <button type="button" class="btn" (click)="ifc.set({ ...defaults(), ask: ifc().ask })">Defaults</button>
              <span class="spacer"></span>
              <button type="button" class="btn" (click)="close()">Cancel</button>
              <button type="submit" class="btn primary" autofocus>{{ r.settingsOnly ? 'Save' : 'Import' }}</button>
            </div>
          </form>
        }
        @case ('busy') {
          @let r = asBusy();
          <div class="busy" role="status" aria-live="polite">
            <h2>{{ r.title }}</h2>
            <p>{{ r.message }}</p>
            <progress></progress>
          </div>
        }
        @case ('message') {
          @let r = asMessage();
          <h2>{{ r.title }}</h2>
          <p class="pre">{{ r.message }}</p>
          <div class="dialog-buttons">
            <button type="button" class="btn primary" autofocus (click)="close()">OK</button>
          </div>
        }
        @case ('layout-json') {
          <h2>Layout configuration</h2>
          <p class="hint">
            The layout as JSON. Edit it and apply, or download it to keep. Panels can be written in place,
            as in <code>&#123; "type": "stack", "panels": [&#123; "type": "viewport" &#125;] &#125;</code>; see the README for the format.
          </p>
          <textarea
            class="input code"
            spellcheck="false"
            aria-label="Layout JSON"
            [value]="json()"
            (input)="json.set($any($event.target).value); jsonError.set('')"></textarea>
          @if (jsonError()) {
            <p class="error" role="alert">{{ jsonError() }}</p>
          }
          <div class="dialog-buttons">
            <button type="button" class="btn" (click)="json.set(layout.toJson()); jsonError.set('')">Revert to current</button>
            <button type="button" class="btn" (click)="formatJson()">Format</button>
            <button type="button" class="btn" (click)="downloadJson()">Download…</button>
            <label class="btn">Open file…<input type="file" accept=".json,application/json" hidden (change)="openJsonFile($event)" /></label>
            <span class="spacer"></span>
            <button type="button" class="btn" (click)="close()">Close</button>
            <button type="button" class="btn primary" (click)="applyJson()">Apply</button>
          </div>
        }
        @case ('layouts') {
          <h2>Saved layouts</h2>
          <form class="save-row" (submit)="$event.preventDefault(); saveCurrent()">
            <input class="input" placeholder="Name for the current layout" aria-label="Layout name" [value]="saveName()" (input)="saveName.set($any($event.target).value)" />
            <button type="submit" class="btn primary" [disabled]="!saveName().trim()">{{ exists() ? 'Replace' : 'Save current' }}</button>
          </form>
          @if (layout.saved().length) {
            <table class="links-table">
              <tbody>
                @for (s of layout.saved(); track s.name) {
                  <tr>
                    <td>
                      <strong>{{ s.name }}</strong>
                      <div class="hint">{{ s.saved | date: 'medium' }}</div>
                    </td>
                    <td class="row-actions">
                      <button type="button" class="btn" (click)="loadSaved(s.name)">Load</button>
                      <button type="button" class="btn" (click)="renameSaved(s.name)">Rename…</button>
                      <button type="button" class="btn" (click)="exportSaved(s.name, s.json)">Download</button>
                      <button type="button" class="btn danger" (click)="layout.deleteSaved(s.name)">Delete</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="hint">No saved layouts yet. The current layout is always kept for your next visit.</p>
          }
          @if (jsonError()) {
            <p class="error" role="alert">{{ jsonError() }}</p>
          }
          <div class="dialog-buttons">
            <button type="button" class="btn" (click)="close()">Close</button>
          </div>
        }
        @case ('help') {
          <h2>Using the workbench</h2>
          <div class="help">
            <h3>Arranging panels</h3>
            <ul>
              <li>Drag a tab onto another panel: the middle adds it as a tab, the sides split the panel.</li>
              <li>Drag a tab to the workspace's outer edge to put it along the whole edge.</li>
              <li>Hold <kbd>Ctrl</kbd> while dropping, or use ⧉, to float a panel in a window. Drag a window by its title; double-click the title to dock it.</li>
              <li>Drag the gutters between panels to resize them; double-click a gutter to share the space equally.</li>
              <li>Double-click a tab, or use 🗖, to maximize its stack. Middle-click a tab to close it.</li>
              <li>Add panels from the Panels menu or a stack's ＋ button. Items there can be dragged into place.</li>
            </ul>
            <h3>Linking panels</h3>
            <ul>
              <li>Each panel is on a link channel, shown by the dot on its tab. Panels on the same link share a selection, transform tool and view commands.</li>
              <li>Change a panel's link from its tab menu (right-click), or for all panels in Panels &amp; Links.</li>
              <li>Messages lists what panels send each other.</li>
            </ul>
            <h3>In a 3D view</h3>
            <ul>
              <li>Drag to orbit, right-drag to pan, scroll to zoom. Click to select; <kbd>Shift</kbd>+click to add.</li>
              <li><kbd>Q</kbd> select, <kbd>W</kbd> move, <kbd>E</kbd> rotate, <kbd>R</kbd> scale, <kbd>F</kbd> fit, <kbd>Delete</kbd> remove, <kbd>Esc</kbd> deselect.</li>
              <li><kbd>G</kbd>, or 🚶 Walk, walks through the scene: <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrows move, <kbd>Q</kbd>/<kbd>E</kbd> go down and up, drag to look, hold <kbd>Shift</kbd> to run, and the wheel sets the speed. <kbd>Esc</kbd> or <kbd>G</kbd> goes back to orbiting.</li>
              <li><kbd>Z</kbd> switches to the ray traced image and back.</li>
            </ul>
            <h3>Saving layouts</h3>
            <ul>
              <li>The layout is saved in this browser as you change it, and restored next time.</li>
              <li>Layout › Save layout as… keeps named layouts; Layout › Configuration… edits the layout as JSON, and downloads or opens it as a file.</li>
            </ul>
          </div>
          <div class="dialog-buttons">
            <button type="button" class="btn primary" autofocus (click)="close()">Close</button>
          </div>
        }
      }
    </dialog>
  `,
})
export class DialogHost {
  private readonly dialogs = inject(DialogService);
  protected readonly layout = inject(LayoutService);
  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly request = this.dialogs.current;
  protected readonly wide = computed(() => ['layout-json', 'layouts', 'help'].includes(this.request()?.kind ?? ''));
  protected readonly promptValue = signal('');
  /** The IFC settings being edited. */
  protected readonly ifc = signal<IfcImportSettings>(defaultIfcSettings());
  protected readonly defaults = defaultIfcSettings;
  protected readonly json = signal('');
  protected readonly jsonError = signal('');
  protected readonly saveName = signal('');
  protected readonly exists = computed(() => this.layout.saved().some(s => s.name === this.saveName().trim()));

  private settled = false;
  private shown: DialogRequest | null = null;

  constructor() {
    afterRenderEffect(() => {
      const r = this.request();
      const d = this.dialogRef().nativeElement;
      if (r === this.shown) return;
      this.shown = r;
      if (r) {
        this.settled = false;
        this.jsonError.set('');
        if (r.kind === 'prompt') this.promptValue.set(r.value);
        if (r.kind === 'ifc-options') this.ifc.set({ ...r.settings });
        if (r.kind === 'layout-json') this.json.set(this.layout.toJson());
        if (r.kind === 'layouts') this.saveName.set(this.layout.layout().name ?? '');
        if (!d.open) d.showModal();
      } else if (d.open) {
        d.close();
      }
    });
  }

  protected asPrompt() {
    return this.request() as Extract<DialogRequest, { kind: 'prompt' }>;
  }
  protected asConfirm() {
    return this.request() as Extract<DialogRequest, { kind: 'confirm' }>;
  }
  protected asIfc() {
    return this.request() as Extract<DialogRequest, { kind: 'ifc-options' }>;
  }
  protected asBusy() {
    return this.request() as Extract<DialogRequest, { kind: 'busy' }>;
  }
  protected asMessage() {
    return this.request() as Extract<DialogRequest, { kind: 'message' }>;
  }

  /** Closes the dialog, answering a prompt or confirm with "no". */
  protected close(): void {
    this.settle();
    this.dialogs.close();
  }

  protected cancel(event: Event): void {
    event.preventDefault();
    // A busy dialog stays until the work is done.
    if (this.request()?.kind !== 'busy') this.close();
  }

  protected onClosed(): void {
    if (this.request()) this.close();
  }

  private settle(answer?: string | boolean | IfcImportSettings): void {
    if (this.settled) return;
    this.settled = true;
    const r = this.request();
    if (r?.kind === 'ifc-options') r.resolve(typeof answer === 'object' ? answer : null);
    else if (r?.kind === 'prompt') r.resolve(typeof answer === 'string' ? answer : null);
    else if (r?.kind === 'confirm') r.resolve(answer === true);
    else if (r?.kind === 'message') r.resolve();
  }

  protected submitPrompt(event: Event): void {
    event.preventDefault();
    const v = this.promptValue().trim();
    if (!v) return;
    this.settle(v);
    this.dialogs.close();
  }

  protected setIfc(patch: Partial<IfcImportSettings>): void {
    this.ifc.update(s => ({ ...s, ...patch }));
  }

  protected submitIfc(event: Event): void {
    event.preventDefault();
    this.settle(this.ifc());
    this.dialogs.close();
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected num(event: Event): number {
    return +(event.target as HTMLInputElement).value;
  }

  protected resolveConfirm(v: boolean): void {
    this.settle(v);
    this.dialogs.close();
  }

  // ------------------------------------------------------------ layout JSON

  protected applyJson(): void {
    try {
      this.layout.loadJson(this.json());
      this.close();
    } catch (e) {
      this.jsonError.set(e instanceof LayoutError ? e.message : String(e));
    }
  }

  protected formatJson(): void {
    try {
      this.json.set(JSON.stringify(JSON.parse(this.json()), null, 2));
    } catch (e) {
      this.jsonError.set(`Not valid JSON: ${(e as Error).message}`);
    }
  }

  protected downloadJson(): void {
    downloadText(this.json(), `${slug(this.layout.layout().name ?? 'layout')}.layout.json`);
  }

  protected async openJsonFile(event: Event): Promise<void> {
    const text = await readTextFile(event);
    if (text !== null) {
      this.json.set(text);
      this.jsonError.set('');
    }
  }

  // ------------------------------------------------------------ saved layouts

  protected saveCurrent(): void {
    this.layout.saveAs(this.saveName());
  }

  protected loadSaved(name: string): void {
    try {
      this.layout.loadSaved(name);
      this.close();
    } catch (e) {
      this.jsonError.set(`"${name}" could not be loaded: ${e instanceof LayoutError ? e.message : String(e)}`);
    }
  }

  protected async renameSaved(name: string): Promise<void> {
    // The prompt replaces this dialog; reopen the list afterwards.
    const to = await this.dialogs.prompt('Rename layout', 'Name', name, 'Rename');
    if (to) this.layout.renameSaved(name, to);
    this.dialogs.open('layouts');
  }

  protected exportSaved(name: string, json: string): void {
    downloadText(json, `${slug(name)}.layout.json`);
  }
}

function slug(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'layout';
}
