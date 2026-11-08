import { Component, computed, inject, signal } from '@angular/core';
import { ToolMode, channelInfo } from '../../core/bus/panel-bus';
import { PanelContext } from '../../core/panels/panel-context';
import { MODEL_EXTENSIONS } from '../../scene/model-import';
import { ModelImportService } from '../../scene/model-import.service';
import { PrimitiveKind, SceneDocument } from '../../scene/scene-document';
import { SelectValue } from '../../ui/select-value';

const MODES: { mode: ToolMode; label: string; icon: string; key: string }[] = [
  { mode: 'select', label: 'Select', icon: '↖', key: 'Q' },
  { mode: 'translate', label: 'Move', icon: '✥', key: 'W' },
  { mode: 'rotate', label: 'Rotate', icon: '⟳', key: 'E' },
  { mode: 'scale', label: 'Scale', icon: '⤡', key: 'R' },
];

const PRIMITIVES: { kind: PrimitiveKind; label: string; icon: string }[] = [
  { kind: 'box', label: 'Box', icon: '▢' },
  { kind: 'sphere', label: 'Sphere', icon: '◯' },
  { kind: 'cylinder', label: 'Cylinder', icon: '⌭' },
  { kind: 'cone', label: 'Cone', icon: '△' },
  { kind: 'torus', label: 'Torus', icon: '◎' },
  { kind: 'knot', label: 'Knot', icon: '∞' },
  { kind: 'plane', label: 'Plane', icon: '▱' },
  { kind: 'group', label: 'Group', icon: '▣' },
  { kind: 'point-light', label: 'Light', icon: '☀' },
];

/**
 * Editing tools: the transform tool for 3D views on the channel, adding
 * shapes and models, and commands on the selection.
 */
@Component({
  imports: [SelectValue],
  selector: 'app-tools-panel',
  host: { class: 'tools-panel' },
  template: `
    <div class="panel-caption">
      <span class="channel-chip" [style.background]="channel().color"></span>
      Acting on {{ channel().label }} · {{ count() }} selected
    </div>

    <section class="tool-section">
      <h3>Transform</h3>
      <div class="button-row" role="radiogroup" aria-label="Transform tool">
        @for (m of modes; track m.mode) {
          <button
            type="button"
            class="tool-btn big"
            role="radio"
            [attr.aria-checked]="mode() === m.mode"
            [class.on]="mode() === m.mode"
            [title]="m.label + ' (' + m.key + ' in a 3D view)'"
            (click)="setTool({ mode: m.mode })">
            <span class="tool-icon">{{ m.icon }}</span>{{ m.label }}
          </button>
        }
      </div>
      <div class="button-row">
        <label class="check"><input type="checkbox" [checked]="space() === 'local'" (change)="setTool({ space: checked($event) ? 'local' : 'world' })" /> Local axes</label>
        <label class="check"><input type="checkbox" [checked]="snap() !== null" (change)="setTool({ snap: checked($event) ? 0.25 : null })" /> Snap</label>
        @if (snap() !== null) {
          <select class="input" aria-label="Snap step" [appSelectValue]="snap()" (change)="setTool({ snap: +value($event) })">
            @for (s of snaps; track s) {
              <option [value]="'' + s">{{ s }}</option>
            }
          </select>
        }
      </div>
    </section>

    <section class="tool-section">
      <h3>Add</h3>
      <div class="button-grid">
        @for (p of primitives; track p.kind) {
          <button type="button" class="tool-btn big" [title]="'Add a ' + p.label.toLowerCase()" (click)="add(p.kind)">
            <span class="tool-icon">{{ p.icon }}</span>{{ p.label }}
          </button>
        }
      </div>
      <label class="btn file-btn">
        Import model…
        <input type="file" [accept]="accept" multiple hidden (change)="importFiles($event)" />
      </label>
      @if (status()) {
        <p class="status-text">{{ status() }}</p>
      }
    </section>

    <section class="tool-section">
      <h3>Selection</h3>
      <div class="button-grid">
        <button type="button" class="tool-btn big" [disabled]="!count()" (click)="duplicate()">⧉ Duplicate</button>
        <button type="button" class="tool-btn big" [disabled]="!count()" (click)="remove()">🗑 Delete</button>
        <button type="button" class="tool-btn big" [disabled]="!count()" (click)="group()">▣ Group</button>
        <button type="button" class="tool-btn big" [disabled]="!canUngroup()" (click)="ungroup()">⬚ Ungroup</button>
        <button type="button" class="tool-btn big" [disabled]="!count()" (click)="fit()">⤢ Frame</button>
        <button type="button" class="tool-btn big" [disabled]="!count()" (click)="select([])">✕ Deselect</button>
      </div>
    </section>

    <section class="tool-section">
      <h3>Views on {{ channel().label }}</h3>
      <div class="button-grid">
        @for (v of views; track v.view) {
          <button type="button" class="tool-btn" (click)="panel.publish('viewport.command', { action: 'view', view: v.view })">{{ v.label }}</button>
        }
        <button type="button" class="tool-btn" (click)="panel.publish('viewport.command', { action: 'fit', ids: [] })">Fit all</button>
      </div>
    </section>
  `,
})
export class ToolsPanel {
  protected readonly panel = inject(PanelContext);
  private readonly doc = inject(SceneDocument);

  protected readonly modes = MODES;
  protected readonly primitives = PRIMITIVES;
  protected readonly snaps = [0.1, 0.25, 0.5, 1];
  protected readonly views = [
    { view: 'iso', label: 'Iso' },
    { view: 'top', label: 'Top' },
    { view: 'front', label: 'Front' },
    { view: 'right', label: 'Right' },
  ] as const;
  protected readonly accept = MODEL_EXTENSIONS.join(',');
  private readonly importer = inject(ModelImportService);
  protected readonly status = signal('');

  protected readonly channel = computed(() => channelInfo(this.panel.channel()));
  private readonly tool = this.panel.retained('tool.mode');
  private readonly selection = this.panel.retained('selection');
  protected readonly mode = computed(() => this.tool()?.mode ?? 'select');
  protected readonly space = computed(() => this.tool()?.space ?? 'world');
  protected readonly snap = computed(() => this.tool()?.snap ?? null);
  private readonly ids = computed(() => {
    this.doc.revision();
    return this.doc.objects(this.selection()?.ids).map(o => o.uuid);
  });
  protected readonly count = computed(() => this.ids().length);
  protected readonly canUngroup = computed(() => {
    this.doc.revision();
    const o = this.doc.objects(this.ids());
    return o.length === 1 && o[0].type === 'Group' && o[0].children.length > 0;
  });

  protected setTool(patch: Partial<{ mode: ToolMode; space: 'world' | 'local'; snap: number | null }>): void {
    this.panel.publish('tool.mode', { mode: this.mode(), space: this.space(), snap: this.snap(), ...patch }, true);
  }

  protected select(ids: string[]): void {
    this.panel.publish('selection', { ids }, true);
  }

  protected add(kind: PrimitiveKind): void {
    // Into the selected group, if one is selected.
    const sel = this.doc.objects(this.ids());
    const parent = sel.length === 1 && sel[0].type === 'Group' ? sel[0].uuid : undefined;
    this.select([this.doc.add(kind, parent)]);
  }

  protected duplicate(): void {
    this.select(this.doc.duplicate(this.ids()));
  }

  protected remove(): void {
    this.doc.remove(this.ids());
    this.select([]);
  }

  protected group(): void {
    const id = this.doc.group(this.ids());
    if (id) this.select([id]);
  }

  protected ungroup(): void {
    this.select(this.doc.ungroup(this.ids()[0]));
  }

  protected fit(): void {
    this.panel.publish('viewport.command', { action: 'fit', ids: this.ids() });
  }

  protected async importFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    // Selected and framed on this panel's link.
    await this.importer.importFiles(files, this.panel.channelKey());
    this.status.set(this.importer.status());
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
