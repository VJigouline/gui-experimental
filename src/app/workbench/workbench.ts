import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PanelBus } from '../core/bus/panel-bus';
import { LayoutService } from '../core/layout/layout.service';
import { LayoutError } from '../core/layout/layout.parse';
import { PanelHost } from '../core/panels/panel-host.service';
import { DockDrag } from '../dock/dock-drag.service';
import { DockWorkspace } from '../dock/dock-workspace';
import { PanelActions } from '../dock/panel-actions';
import { MODEL_EXTENSIONS, importModel } from '../scene/model-import';
import { SceneDocument } from '../scene/scene-document';
import { DialogHost } from '../ui/dialog/dialog-host';
import { DialogService } from '../ui/dialog/dialog.service';
import { downloadText, readTextFile } from '../ui/files';
import { MenuHost } from '../ui/menu/menu-host';
import { MenuEntry, MenuService } from '../ui/menu/menu.service';
import { ThemeService } from '../ui/theme.service';

/** The application's page: menu bar, toolbar, the panel workspace and a status bar. */
@Component({
  selector: 'app-workbench',
  imports: [DockWorkspace, MenuHost, DialogHost, DatePipe],
  host: { class: 'workbench' },
  template: `
    <header class="menubar" role="menubar">
      <div class="app-name">GUI Experimental</div>
      @for (m of menuNames; track m) {
        <button type="button" class="menu-btn" role="menuitem" aria-haspopup="menu" (click)="openMenu(m, $event)">{{ m }}</button>
      }
      <span class="spacer"></span>
      <button type="button" class="menu-btn" (click)="theme.toggle()" [attr.aria-pressed]="theme.dark()" title="Toggle theme">
        {{ theme.dark() ? '☾ Dark' : '☀ Light' }}
      </button>
    </header>

    <div class="toolbar" role="toolbar" aria-label="Toolbar">
      <button type="button" class="tool-btn" title="Start a new scene" (click)="newScene()">New scene</button>
      <label class="tool-btn" title="Import a glTF, STL or OBJ model">
        Import…<input #modelInput type="file" [accept]="modelAccept" multiple hidden (change)="importModels($event)" />
      </label>
      <span class="tool-sep"></span>
      @for (t of quickTypes(); track t.type) {
        <button
          type="button"
          class="tool-btn"
          [title]="'Add ' + t.title + ' — click, or drag into place'"
          (pointerdown)="drag.pressNew($event, t.type)"
          (click)="layout.addPanel(t.type)">
          <span class="tool-icon">{{ t.icon }}</span>{{ t.title }}
        </button>
      }
      <span class="tool-sep"></span>
      <label class="toolbar-label" for="preset">Layout</label>
      <select id="preset" class="input" [value]="''" (change)="applyPreset($event)">
        <option value="" disabled>{{ layout.layout().name ?? 'Custom' }}</option>
        @for (p of layout.presets; track p.id) {
          <option [value]="p.id">{{ p.name }}</option>
        }
      </select>
      <button type="button" class="tool-btn" title="Save the layout under a name" (click)="saveLayoutAs()">Save layout…</button>
      <button type="button" class="tool-btn" title="Edit the layout as JSON" (click)="dialogs.open('layout-json')">&#123; &#125; Configuration</button>
    </div>

    <app-dock-workspace />

    <footer class="statusbar" role="contentinfo">
      <span>{{ status() }}</span>
      <span class="spacer"></span>
      <span>{{ doc.objectCount() }} objects</span>
      <span>{{ layout.panelCount() }} panels{{ windowCount() ? ', ' + windowCount() + ' in windows' : '' }}</span>
      <span>{{ bus.log().length }} messages</span>
      <span [title]="'Layouts are kept in this browser'">
        @if (layout.autosavedAt(); as t) {
          Layout saved {{ t | date: 'HH:mm:ss' }}
        } @else {
          Layout not saved yet
        }
      </span>
    </footer>

    <app-menu-host />
    <app-dialog-host />
  `,
})
export class Workbench {
  protected readonly layout = inject(LayoutService);
  protected readonly bus = inject(PanelBus);
  protected readonly doc = inject(SceneDocument);
  protected readonly drag = inject(DockDrag);
  protected readonly dialogs = inject(DialogService);
  protected readonly theme = inject(ThemeService);
  private readonly menus = inject(MenuService);
  private readonly actions = inject(PanelActions);
  private readonly modelInput = viewChild.required<ElementRef<HTMLInputElement>>('modelInput');

  // Make the panel host now, so it follows the layout from the start.
  private readonly host = inject(PanelHost);

  protected readonly menuNames = ['File', 'Panels', 'Layout', 'Help'] as const;
  protected readonly modelAccept = MODEL_EXTENSIONS.join(',');
  protected readonly status = signal('Ready');
  protected readonly windowCount = computed(() => this.layout.layout().floating.length);
  protected readonly quickTypes = computed(() =>
    this.layout.panelTypes.filter(t => ['viewport', 'scene-tree', 'properties', 'tools'].includes(t.type)),
  );

  protected openMenu(name: (typeof this.menuNames)[number], event: MouseEvent): void {
    const anchor = event.currentTarget as HTMLElement;
    const entries: Record<typeof name, () => MenuEntry[]> = {
      File: () => [
        { label: 'New scene', icon: '✚', action: () => this.newScene() },
        { label: 'Import model…', icon: '⇪', hint: MODEL_EXTENSIONS.join(', '), action: () => this.modelInput().nativeElement.click() },
        'separator',
        { label: 'Open layout file…', icon: '📂', action: () => this.openLayoutFile() },
        { label: 'Download layout…', icon: '⇩', action: () => this.downloadLayout() },
      ],
      Panels: () => [
        ...this.actions.addPanelEntries(),
        'separator',
        { label: 'Dock all windows', icon: '⇲', disabled: !this.windowCount(), action: () => this.layout.dockAllWindows() },
        {
          label: 'Restore maximized',
          icon: '🗗',
          disabled: !this.layout.layout().maximized,
          action: () => {
            const m = this.layout.layout().maximized;
            if (m) this.layout.toggleMaximized(m);
          },
        },
      ],
      Layout: () => [
        {
          label: 'Presets',
          icon: '▦',
          children: this.layout.presets.map(p => ({ label: p.name, hint: p.description, action: () => this.layout.applyPreset(p.id) })),
        },
        {
          label: 'Saved layouts',
          icon: '★',
          disabled: !this.layout.saved().length,
          children: this.layout.saved().map(s => ({ label: s.name, action: () => this.loadSaved(s.name) })),
        },
        'separator',
        { label: 'Save layout as…', icon: '💾', action: () => this.saveLayoutAs() },
        { label: 'Manage saved layouts…', icon: '☰', action: () => this.dialogs.open('layouts') },
        { label: 'Configuration (JSON)…', icon: '{}', action: () => this.dialogs.open('layout-json') },
        'separator',
        { label: 'Reset to default', icon: '↺', action: () => this.resetLayout() },
      ],
      Help: () => [{ label: 'Using the workbench…', icon: '?', action: () => this.dialogs.open('help') }],
    };
    this.menus.show(entries[name](), anchor, 'menubar');
  }

  // ------------------------------------------------------------ scene

  protected async newScene(): Promise<void> {
    if (await this.dialogs.confirm('New scene', 'Remove everything from the scene, keeping only the default lights? Changes to it are lost.', 'New scene')) {
      this.doc.newScene();
      this.status.set('New scene');
    }
  }

  protected async importModels(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    const ids: string[] = [];
    for (const f of files) {
      this.status.set(`Reading ${f.name}…`);
      try {
        ids.push(this.doc.addObject(await importModel(f)));
      } catch (e) {
        this.status.set('Import failed');
        await this.dialogs.message('Import failed', `${f.name}: ${(e as Error).message}`);
        return;
      }
    }
    if (ids.length) {
      this.status.set(`Imported ${files.map(f => f.name).join(', ')}`);
      this.bus.publish('selection', { ids }, { channel: 'A', retain: true });
      this.bus.publish('viewport.command', { action: 'fit', ids }, { channel: 'A' });
    }
  }

  // ------------------------------------------------------------ layouts

  protected applyPreset(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.layout.applyPreset(select.value);
    select.value = '';
    this.status.set(`Layout: ${this.layout.layout().name ?? ''}`);
  }

  protected async saveLayoutAs(): Promise<void> {
    const name = await this.dialogs.prompt('Save layout', 'Name', this.layout.layout().name ?? '', 'Save');
    if (!name) return;
    if (this.layout.saved().some(s => s.name === name.trim())) {
      if (!(await this.dialogs.confirm('Replace layout', `Replace the saved layout "${name.trim()}"?`, 'Replace'))) return;
    }
    this.layout.saveAs(name);
    this.status.set(`Layout saved as "${name.trim()}"`);
  }

  private async loadSaved(name: string): Promise<void> {
    try {
      this.layout.loadSaved(name);
      this.status.set(`Layout: ${name}`);
    } catch (e) {
      await this.dialogs.message('Layout not loaded', `"${name}" could not be loaded.\n${e instanceof LayoutError ? e.message : String(e)}`);
    }
  }

  private async resetLayout(): Promise<void> {
    if (await this.dialogs.confirm('Reset layout', 'Replace the layout with the default one?', 'Reset')) {
      this.layout.resetToDefault();
      this.status.set('Layout reset');
    }
  }

  private downloadLayout(): void {
    const name = this.layout.layout().name ?? 'layout';
    downloadText(this.layout.toJson(), `${name.replace(/[^\w.-]+/g, '-')}.layout.json`);
  }

  private openLayoutFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async e => {
      const text = await readTextFile(e);
      if (text === null) return;
      try {
        this.layout.loadJson(text);
        this.status.set('Layout opened');
      } catch (err) {
        await this.dialogs.message('Layout not opened', err instanceof LayoutError ? err.message : String(err));
      }
    });
    input.click();
  }
}
