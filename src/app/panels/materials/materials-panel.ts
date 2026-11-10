import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import * as THREE from 'three';
import { channelInfo } from '../../core/bus/panel-bus';
import { PanelContext } from '../../core/panels/panel-context';
import {
  LIBRARY_CATEGORIES,
  LIBRARY_MIME,
  LibraryCategory,
  LibraryMaterial,
  MATERIAL_LIBRARY,
  libraryDrag,
  libraryIdOf,
  makeLibraryMaterial,
} from '../../scene/material-library';
import { MaterialPreviews } from '../../scene/material-previews';
import { SceneDocument, materialsOf } from '../../scene/scene-document';

/**
 * The material library: common materials in groups, with preview images. Click one to give it to
 * the selection on the panel's link, or drag it onto an object in a 3D view.
 */
@Component({
  selector: 'app-materials-panel',
  host: { class: 'materials-panel' },
  template: `
    <div class="panel-caption">
      <span class="channel-chip" [style.background]="channel().color"></span>
      For the selection on {{ channel().label }}
    </div>
    <div class="library-toolbar">
      <input class="input" type="search" placeholder="Search materials" aria-label="Search materials" [value]="search()" (input)="setSearch($event)" />
    </div>
    <div class="library-categories" role="group" aria-label="Kinds of material">
      <button type="button" class="chip" [class.on]="category() === 'all'" [attr.aria-pressed]="category() === 'all'" (click)="setCategory('all')">All</button>
      @for (c of categories; track c.id) {
        <button type="button" class="chip" [class.on]="category() === c.id" [attr.aria-pressed]="category() === c.id" (click)="setCategory(c.id)">
          {{ c.icon }} {{ c.label }}
        </button>
      }
    </div>
    <div class="library-list">
      @for (g of groups(); track g.category.id) {
        @if (category() === 'all') {
          <h4 class="library-group">{{ g.category.icon }} {{ g.category.label }}</h4>
        }
        <div class="library-tiles" role="list">
          @for (m of g.items; track m.id) {
            <button
              type="button"
              role="listitem"
              class="library-tile"
              [class.current]="current().has(m.id)"
              draggable="true"
              [title]="m.name + ': ' + m.about + '. Click to give it to the selection, or drag it onto an object in a 3D view.'"
              (dragstart)="onDragStart($event, m)"
              (dragend)="onDragEnd()"
              (click)="assign(m)">
              @if (previews()[m.id]; as src) {
                <img [src]="src" alt="" draggable="false" />
              } @else {
                <span class="library-swatch" [style.background]="swatch(m)"></span>
              }
              <span class="library-name">{{ m.name }}</span>
            </button>
          }
        </div>
      } @empty {
        <div class="panel-empty small">No materials match.</div>
      }
    </div>
    <p class="status-text library-status">{{ status() }}</p>
  `,
})
export class MaterialsPanel {
  private readonly panel = inject(PanelContext);
  private readonly doc = inject(SceneDocument);
  private readonly previewer = inject(MaterialPreviews);

  protected readonly categories = LIBRARY_CATEGORIES;
  protected readonly channel = computed(() => channelInfo(this.panel.channel()));
  protected readonly category = this.panel.state<string>('category', 'all');
  protected readonly search = signal('');
  protected readonly previews = this.previewer.images;
  protected readonly status = signal('Select objects, then click a material; or drag one onto an object in a 3D view.');
  private readonly selection = this.panel.retained('selection');

  /** The materials shown, in their groups. */
  protected readonly groups = computed<{ category: LibraryCategory; items: LibraryMaterial[] }[]>(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.category();
    return LIBRARY_CATEGORIES.filter(c => cat === 'all' || c.id === cat)
      .map(c => ({
        category: c,
        items: MATERIAL_LIBRARY.filter(
          m => m.category === c.id && (!q || m.name.toLowerCase().includes(q) || m.about.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)),
        ),
      }))
      .filter(g => g.items.length);
  });

  /** Library materials the selected objects have now. */
  protected readonly current = computed(() => {
    this.doc.revision();
    const ids = new Set<string>();
    for (const o of this.doc.objects(this.selection()?.ids)) {
      o.traverse(c => materialsOf(c).forEach(m => {
        const id = libraryIdOf(m);
        if (id) ids.add(id);
      }));
    }
    return ids;
  });

  constructor() {
    // Previews of what is shown first, then of the rest.
    effect(() => {
      const shown = this.groups().flatMap(g => g.items.map(m => m.id));
      untracked(() => this.previewer.request([...shown, ...MATERIAL_LIBRARY.map(m => m.id)]));
    });
  }

  protected setCategory(id: string): void {
    this.panel.setState({ category: id });
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** Gives a material to the selected objects; lights are left alone. */
  protected assign(entry: LibraryMaterial): void {
    const objects = this.doc.objects(this.selection()?.ids).filter(o => !(o as THREE.Light).isLight);
    if (!objects.length) {
      this.status.set(`Select one or more objects on ${this.channel().label} first, or drag ${entry.name} onto an object in a 3D view.`);
      return;
    }
    const meshes = this.doc.assignMaterial(
      objects.map(o => o.uuid),
      makeLibraryMaterial(entry),
    );
    const who = objects.length === 1 ? objects[0].name : `${objects.length} objects`;
    this.status.set(meshes ? `${entry.name} given to ${who}${meshes > objects.length ? ` (${meshes} parts)` : ''}.` : `${who} has nothing to give a material to.`);
  }

  protected onDragStart(event: DragEvent, entry: LibraryMaterial): void {
    event.dataTransfer?.setData(LIBRARY_MIME, entry.id);
    event.dataTransfer?.setData('text/plain', entry.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    libraryDrag.id = entry.id;
  }

  protected onDragEnd(): void {
    libraryDrag.id = null;
  }

  /** A colour to show until the preview is ready. */
  protected swatch(m: LibraryMaterial): string {
    return (m.settings['color'] as string | undefined) ?? m.texture?.colors[0] ?? '#888888';
  }
}
