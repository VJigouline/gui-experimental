import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { DropTarget, LayoutConfig, PanelConfig, emptyLayout, newId } from './layout.model';
import * as ops from './layout.ops';
import { LayoutError, layoutToJson, parseLayout } from './layout.parse';
import { LAYOUT_PRESETS, PANEL_TYPES, PanelType } from '../panels/panel-type';

/** Keys in `localStorage`. */
export const STORAGE_KEYS = {
  current: 'gui-experimental.layout.current',
  saved: 'gui-experimental.layout.saved',
} as const;

/** A layout saved by name. */
export interface SavedLayout {
  name: string;
  saved: number;
  json: string;
}

const AUTOSAVE_DELAY = 400;

/**
 * Holds the workbench layout and changes it. Every change is saved to
 * `localStorage` shortly after, and restored on the next visit.
 */
@Injectable()
export class LayoutService {
  private readonly types = inject(PANEL_TYPES);
  readonly presets = inject(LAYOUT_PRESETS);

  private readonly state = signal<LayoutConfig>(emptyLayout());
  /** The current layout. */
  readonly layout = this.state.asReadonly();

  private readonly savedStore = signal<SavedLayout[]>(readSaved());
  /** Layouts saved by name, newest first. */
  readonly saved = this.savedStore.asReadonly();

  /** When the layout was last saved to storage, or `null`. */
  readonly autosavedAt = signal<number | null>(null);

  /** Bumped when a whole layout is loaded, so panels are made afresh. */
  readonly generation = signal(0);

  readonly panelCount = computed(() => Object.keys(this.layout().panels).length);

  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.restore();
    effect(() => {
      const layout = this.layout();
      untracked(() => this.scheduleAutosave(layout));
    });
  }

  // ------------------------------------------------------------ panel types

  typeOf(type: string): PanelType | undefined {
    return this.types.find(t => t.type === type);
  }

  get panelTypes(): readonly PanelType[] {
    return this.types;
  }

  parseOptions() {
    return {
      isKnownType: (type: string) => !!this.typeOf(type),
      defaultTitle: (type: string) => this.typeOf(type)?.title ?? type,
      defaultChannel: 'A',
    };
  }

  // ------------------------------------------------------------ panels

  /**
   * Adds a panel of a type, at a target or in the largest docked stack. For a
   * type that allows one panel, shows the open one instead. Returns its id.
   */
  addPanel(type: string, target?: DropTarget, init: Partial<PanelConfig> = {}): string | null {
    const t = this.typeOf(type);
    if (!t) return null;
    if (!t.multiple) {
      const open = Object.entries(this.layout().panels).find(([, p]) => p.type === type);
      if (open) {
        if (target) this.movePanel(open[0], target);
        this.activate(open[0]);
        return open[0];
      }
    }
    const id = newId(type);
    const panel: PanelConfig = {
      type,
      title: init.title ?? this.uniqueTitle(t.title),
      channel: init.channel ?? 'A',
      state: init.state ?? t.defaultState?.() ?? {},
    };
    if (!target && t.float) {
      // Near the top right, cascaded from other windows.
      const n = this.layout().floating.length;
      const x = Math.max(16, window.innerWidth - t.float.width - 40 - 28 * (n % 6));
      const y = 24 + 28 * (n % 6);
      // Kept within the page, below the menu and toolbar.
      const height = Math.max(200, Math.min(t.float.height, window.innerHeight - y - 140));
      target = { kind: 'float', x, y, width: t.float.width, height };
    }
    this.state.update(l => ops.addPanel(l, id, panel, target));
    return id;
  }

  private uniqueTitle(title: string): string {
    const titles = new Set(Object.values(this.layout().panels).map(p => p.title));
    if (!titles.has(title)) return title;
    for (let i = 2; ; i++) if (!titles.has(`${title} ${i}`)) return `${title} ${i}`;
  }

  closePanel(panelId: string): void {
    this.state.update(l => ops.removePanel(l, panelId));
  }

  movePanel(panelId: string, target: DropTarget): void {
    this.state.update(l => ops.movePanel(l, panelId, target));
  }

  activate(panelId: string): void {
    this.state.update(l => {
      let next = ops.activatePanel(l, panelId);
      const s = ops.stackOfPanel(next, panelId);
      const w = s && ops.windowOfNode(next, s.id);
      if (w) next = ops.raiseWindow(next, w.id);
      if (next.maximized && s && next.maximized !== s.id) next = ops.setMaximized(next, null);
      return next;
    });
  }

  renamePanel(panelId: string, title: string): void {
    const t = title.trim();
    if (t) this.state.update(l => ops.updatePanel(l, panelId, { title: t }));
  }

  setChannel(panelId: string, channel: string): void {
    this.state.update(l => ops.updatePanel(l, panelId, { channel }));
  }

  patchPanelState(panelId: string, patch: Record<string, unknown>): void {
    this.state.update(l => ops.patchPanelState(l, panelId, patch));
  }

  // ------------------------------------------------------------ splits, stacks and windows

  resizeSplit(splitId: string, index: number, delta: number): void {
    this.state.update(l => ops.resizeSplit(l, splitId, index, delta));
  }

  equalizeSplit(splitId: string): void {
    this.state.update(l => ops.setSplitSizes(l, splitId));
  }

  moveWindow(windowId: string, patch: { x?: number; y?: number; width?: number; height?: number }): void {
    this.state.update(l => ops.updateWindow(l, windowId, patch));
  }

  raiseWindow(windowId: string): void {
    this.state.update(l => ops.raiseWindow(l, windowId));
  }

  dockWindow(windowId: string): void {
    this.state.update(l => ops.dockWindow(l, windowId));
  }

  dockAllWindows(): void {
    this.state.update(l => l.floating.reduce((acc, w) => ops.dockWindow(acc, w.id), l));
  }

  closeWindow(windowId: string): void {
    this.state.update(l => {
      const w = l.floating.find(f => f.id === windowId);
      if (!w) return l;
      return ops.stacksOf(w.root).flatMap(s => s.panels).reduce((acc, p) => ops.removePanel(acc, p), l);
    });
  }

  floatStack(stackId: string, x: number, y: number, width: number, height: number): void {
    this.state.update(l => ops.floatStack(l, stackId, x, y, width, height));
  }

  floatPanel(panelId: string, x: number, y: number, width?: number, height?: number): void {
    this.movePanel(panelId, { kind: 'float', x, y, width, height });
  }

  toggleMaximized(stackId: string): void {
    this.state.update(l => ops.setMaximized(l, l.maximized === stackId ? null : stackId));
  }

  // ------------------------------------------------------------ whole layouts

  /** Shows a layout, replacing the current one and all its panels. */
  load(layout: LayoutConfig): void {
    this.state.set(ops.withFreshIds(layout));
    this.generation.update(g => g + 1);
  }

  /**
   * Reads and shows a layout from JSON.
   * @throws LayoutError
   */
  loadJson(json: string | unknown): void {
    this.load(parseLayout(json, this.parseOptions()));
  }

  /** The current layout as JSON. */
  toJson(keepIds = false): string {
    return layoutToJson(this.layout(), keepIds);
  }

  applyPreset(presetId: string): void {
    const preset = this.presets.find(p => p.id === presetId);
    if (preset) this.loadJson({ ...(preset.layout as object), name: preset.name });
  }

  resetToDefault(): void {
    if (this.presets.length) this.applyPreset(this.presets[0].id);
    else this.load(emptyLayout());
  }

  /** Saves the current layout under a name, replacing one of the same name. */
  saveAs(name: string): void {
    const n = name.trim();
    if (!n) return;
    this.state.update(l => ({ ...l, name: n }));
    const entry: SavedLayout = { name: n, saved: Date.now(), json: this.toJson() };
    this.writeSaved([entry, ...this.saved().filter(s => s.name !== n)]);
  }

  /** @throws LayoutError if the saved layout no longer reads, for example after a panel type was removed. */
  loadSaved(name: string): void {
    const s = this.saved().find(x => x.name === name);
    if (s) this.loadJson(s.json);
  }

  deleteSaved(name: string): void {
    this.writeSaved(this.saved().filter(s => s.name !== name));
  }

  renameSaved(name: string, to: string): void {
    const t = to.trim();
    if (!t || t === name) return;
    const list = this.saved()
      .filter(s => s.name !== t)
      .map(s => (s.name === name ? { ...s, name: t, json: renameJson(s.json, t) } : s));
    this.writeSaved(list);
  }

  private writeSaved(list: SavedLayout[]): void {
    this.savedStore.set(list);
    try {
      localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(list));
    } catch {
      // Storage may be full or blocked; the list stays for this visit.
    }
  }

  // ------------------------------------------------------------ autosave

  private restore(): void {
    let json: string | null = null;
    try {
      json = localStorage.getItem(STORAGE_KEYS.current);
    } catch {
      json = null;
    }
    if (json) {
      try {
        this.loadJson(json);
        return;
      } catch (e) {
        console.warn('The saved layout could not be restored; using the default.', e instanceof LayoutError ? e.message : e);
      }
    }
    this.resetToDefault();
  }

  private scheduleAutosave(layout: LayoutConfig): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.autosave(layout), AUTOSAVE_DELAY);
  }

  /** Saves the layout now, rather than after the usual short delay. */
  flushAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosave(this.layout());
  }

  private autosave(layout: LayoutConfig): void {
    try {
      localStorage.setItem(STORAGE_KEYS.current, layoutToJson(layout));
      this.autosavedAt.set(Date.now());
    } catch {
      // Not saved; the layout still works for this visit.
    }
  }
}

function readSaved(): SavedLayout[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEYS.saved) ?? '[]');
    return Array.isArray(list)
      ? list.filter((s): s is SavedLayout => typeof s?.name === 'string' && typeof s?.json === 'string')
      : [];
  } catch {
    return [];
  }
}

function renameJson(json: string, name: string): string {
  try {
    return JSON.stringify({ ...JSON.parse(json), name }, null, 2);
  } catch {
    return json;
  }
}
