import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ToolMode, ViewName } from '../../core/bus/panel-bus';
import { PanelContext } from '../../core/panels/panel-context';
import { MenuService } from '../../ui/menu/menu.service';
import { DialogService } from '../../ui/dialog/dialog.service';
import { WALK_FAST, WALK_SPEED, clampWalk, defaultWalkSettings } from './walk-settings';
import { FACE_LOOPS_LAYER, SceneDocument } from '../../scene/scene-document';
import { ThemeService } from '../../ui/theme.service';
import { RaytraceService, describeProgress } from '../../raytrace/raytrace.service';
import {
  Dimension, EditableShape, Handle, constrainedPoint, dimensionLines, editableShape, formatLength, pickHandle,
} from '../../scene/primitive-edit';

interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

const VIEWS: Record<ViewName, { label: string; dir: [number, number, number] }> = {
  iso: { label: 'Isometric', dir: [1, 0.8, 1] },
  top: { label: 'Top', dir: [0, 1, 0.0001] },
  bottom: { label: 'Bottom', dir: [0, -1, 0.0001] },
  front: { label: 'Front', dir: [0, 0, 1] },
  back: { label: 'Back', dir: [0, 0, -1] },
  left: { label: 'Left', dir: [-1, 0, 0] },
  right: { label: 'Right', dir: [1, 0, 0] },
};

export const BACKGROUNDS = [
  { label: 'Follow theme', value: 'theme' },
  { label: 'Slate', value: '#1b2230' },
  { label: 'Charcoal', value: '#111111' },
  { label: 'Grey', value: '#5b6270' },
  { label: 'Light', value: '#e8ecf2' },
  { label: 'White', value: '#ffffff' },
];

/**
 * A 3D view of the shared scene. Each view has its own camera, grid and
 * shading, saved with the layout, and follows the selection and transform
 * tool on its channel.
 */
@Component({
  selector: 'app-viewport-panel',
  host: { class: 'viewport-panel' },
  template: `
    <div
      class="viewport-canvas"
      #container
      tabindex="0"
      aria-label="3D view. Click to select; W, E, R for move, rotate, scale; F to fit; B to zoom to a box; G to walk; L for face loops; Z to ray trace; Delete to remove."
      [class.zoom-box]="zoomBox()"
      (keydown)="onKey($event)"
      (keyup)="onKeyUp($event)"
      (blur)="stopWalking()"></div>
    @if (zoomRect(); as r) {
      <div class="zoom-rect" [style.left.px]="r.x" [style.top.px]="r.y" [style.width.px]="r.w" [style.height.px]="r.h"></div>
    }
    @if (dimDraw().length) {
      <svg class="dimension-lines" aria-hidden="true" [style.color]="dimColour()" [style.--dim-halo]="dimHalo()">
        @for (d of dimDraw(); track $index) {
          @for (l of d.lines; track $index) {
            <line [attr.x1]="l[0]" [attr.y1]="l[1]" [attr.x2]="l[2]" [attr.y2]="l[3]" />
          }
          @for (a of d.arrows; track $index) {
            <polygon [attr.points]="a" />
          }
          <text [attr.x]="d.tx" [attr.y]="d.ty" [attr.transform]="d.rotate">{{ d.label }}</text>
        }
      </svg>
    }
    @if (error()) {
      <div class="panel-empty">{{ error() }}</div>
    }
    <div class="viewport-toolbar">
      <button type="button" class="tool-btn" title="View direction" (click)="openViews($event)">{{ viewLabel() }} ▾</button>
      <button type="button" class="tool-btn" title="Fit the selection, or everything (F)" (click)="fit()">⤢ Fit</button>
      <button
        type="button"
        class="tool-btn"
        [class.on]="zoomBox()"
        [attr.aria-pressed]="zoomBox()"
        [disabled]="walking()"
        title="Zoom box: drag a rectangle to zoom to it, or click to zoom in there (B; Esc cancels)"
        (click)="setZoomBox(!zoomBox())">
        ⊕ Zoom
      </button>
      <span class="tool-sep"></span>
      <button type="button" class="tool-btn" [class.on]="grid()" title="Grid" (click)="toggle('grid')">#</button>
      <button type="button" class="tool-btn" [class.on]="axes()" title="Axes" (click)="toggle('axes')">⊹</button>
      <button type="button" class="tool-btn" [class.on]="wireframe()" title="Wireframe" (click)="toggle('wireframe')">◇</button>
      <button
        type="button"
        class="tool-btn"
        [class.on]="loops() && hasLoops()"
        [attr.aria-pressed]="loops()"
        [disabled]="!hasLoops()"
        [title]="hasLoops() ? 'Face loops: the edges of solid faces and surfaces (L)' : 'Face loops: none in the scene. STEP models have them.'"
        (click)="toggle('loops')">
        ⬚
      </button>
      <button type="button" class="tool-btn" title="Background" (click)="openBackgrounds($event)">◐</button>
      <span class="tool-sep"></span>
      <button
        type="button"
        class="tool-btn"
        [class.on]="walking()"
        [attr.aria-pressed]="walking()"
        title="Walk: WASD to move, Q/E down and up, drag to look, middle-drag to walk sideways and up or down, wheel to walk forward and back, Shift to go fast, Ctrl+wheel for speed (G switches, Esc leaves)"
        (click)="setWalking(!walking())">
        🚶 Walk
      </button>
      <button type="button" class="tool-btn" title="Walk settings: normal speed, and how much faster Shift goes with the keys and the mouse" (click)="openWalkSettings()">⚙</button>
      @if (raytraceAvailable) {
        <span class="tool-sep"></span>
        <button
          type="button"
          class="tool-btn"
          [class.on]="tracing()"
          [attr.aria-pressed]="tracing()"
          title="Ray trace this view (Z switches)"
          (click)="toggleRaytrace()">
          ☀ Ray trace
        </button>
      }
    </div>
    <div class="viewport-info">
      @if (tracing()) {
        Ray traced · {{ traceStatus() }}
      } @else if (editInfo(); as info) {
        {{ info }} · Ctrl keeps the centre · Esc cancels
      } @else if (zoomBox()) {
        Zoom box · drag a rectangle to zoom to it, or click to zoom in · Esc cancels
      } @else if (walking()) {
        Walk · WASD move · Q/E down, up · drag to look · middle-drag sideways, up · wheel forward, back · Shift fast ({{ fastKeys() }}× keys, {{ fastMouse() }}× mouse) · Ctrl+wheel {{ walkSpeedLabel() }} · Esc leaves
      } @else {
        {{ mode() === 'select' ? 'Select' : modeLabel() }} · {{ selectionCount() }} selected{{ canSize() ? ' · drag a face, edge or corner to size' : '' }}
      }
    </div>
  `,
})
export class ViewportPanel {
  private readonly panel = inject(PanelContext);
  private readonly doc = inject(SceneDocument);
  private readonly menus = inject(MenuService);
  private readonly dialogs = inject(DialogService);
  private readonly theme = inject(ThemeService);
  /** Ray tracing, when the workbench provides it. */
  private readonly raytrace = inject(RaytraceService, { optional: true });
  private readonly containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');

  protected readonly error = signal<string | null>(null);
  protected readonly grid = this.panel.state('grid', true);
  protected readonly axes = this.panel.state('axes', false);
  protected readonly wireframe = this.panel.state('wireframe', false);
  /** Show the boundary loops of B-rep faces and surfaces, where the scene has them. */
  protected readonly loops = this.panel.state('loops', true);
  protected readonly hasLoops = computed(() => this.doc.faceLoops().length > 0);
  /** Zoom box: the next left drag draws a rectangle that the view zooms to. Not kept. */
  protected readonly zoomBox = signal(false);
  /** The rectangle being drawn, in pixels in the view. */
  protected readonly zoomRect = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  /** Walk mode: WASD moves the camera, dragging looks around. */
  protected readonly walking = this.panel.state('walk', false);
  /** Walking speed, as a multiple of the speed for the scene's size. */
  private readonly walkSpeedState = this.panel.state('walkSpeed', 1);
  private readonly walkSpeed = computed(() => clampWalk(this.walkSpeedState(), WALK_SPEED, 1));
  /** Shift multiplies the keys' walking speed by this. */
  private readonly fastKeysState = this.panel.state('walkFastKeys', defaultWalkSettings().fastKeys);
  private readonly fastKeys = computed(() => clampWalk(this.fastKeysState(), WALK_FAST, defaultWalkSettings().fastKeys));
  /** Shift multiplies the mouse's walking speed (middle-drag and wheel) by this. */
  private readonly fastMouseState = this.panel.state('walkFastMouse', defaultWalkSettings().fastMouse);
  private readonly fastMouse = computed(() => clampWalk(this.fastMouseState(), WALK_FAST, defaultWalkSettings().fastMouse));
  protected readonly walkSpeedLabel = computed(() => {
    this.doc.revision();
    const v = this.baseWalkSpeed() * this.walkSpeed();
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} m/s`;
  });
  protected readonly background = this.panel.state('background', BACKGROUNDS[0].value);
  protected readonly view = this.panel.state<ViewName | 'custom'>('view', 'iso');

  private readonly selection = this.panel.retained('selection');
  private readonly tool = this.panel.retained('tool.mode');
  protected readonly selectionCount = computed(() => {
    this.doc.revision();
    return this.doc.objects(this.selection()?.ids).length;
  });
  /** Whether a selected object is a shape that can be sized by dragging. */
  protected readonly canSize = computed(() => {
    this.doc.revision();
    return this.doc.objects(this.selection()?.ids).some(o => !!editableShape(o));
  });
  protected readonly mode = computed<ToolMode>(() => this.tool()?.mode ?? 'select');
  protected readonly modeLabel = computed(() => ({ select: 'Select', translate: 'Move', rotate: 'Rotate', scale: 'Scale' })[this.mode()]);
  /** Whether the ray traced image is shown over this view. */
  protected readonly tracing = computed(() => !!this.raytrace?.isTracingOver(this.panel.id));
  protected readonly traceStatus = computed(() => (this.tracing() && this.raytrace ? describeProgress(this.raytrace.progress()) : ''));
  protected readonly viewLabel = computed(() => {
    const v = this.view();
    return v === 'custom' ? 'Free' : VIEWS[v].label;
  });

  private renderer?: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
  private orbit?: OrbitControls;
  private gizmo?: TransformControls;
  /** Helpers drawn in this view only: grid, axes, selection boxes and the gizmo. */
  private readonly overlay = new THREE.Scene();
  private readonly gridHelper = new THREE.GridHelper(20, 20, 0x8090a8, 0x4a5568);
  private readonly axesHelper = new THREE.AxesHelper(1.5);
  private readonly boxes = new Map<string, THREE.Box3Helper>();
  private readonly wireMaterial = new THREE.MeshBasicMaterial({ color: 0x9fb4d8, wireframe: true });
  private frame = 0;
  private fitOnFirstSize = false;
  private pointerDown: { x: number; y: number; onGizmo: boolean } | null = null;

  constructor() {
    for (const h of [this.gridHelper, this.axesHelper]) {
      h.userData['helper'] = true;
      this.overlay.add(h);
    }
    (this.gridHelper.material as THREE.Material).transparent = true;
    (this.gridHelper.material as THREE.Material).opacity = 0.55;
    this.restoreCamera();

    afterNextRender(() => this.init());
    inject(DestroyRef).onDestroy(() => this.dispose());

    // Redraw when the scene, the selection, the tool or the view's options change.
    effect(() => {
      this.doc.revision();
      this.selection();
      this.grid();
      this.axes();
      this.wireframe();
      this.loops();
      this.background();
      this.theme.dark();
      untracked(() => this.requestRender());
    });
    effect(() => {
      const tool = this.tool();
      const ids = this.selection()?.ids;
      this.doc.revision();
      untracked(() => this.updateGizmo(tool?.mode ?? 'select', ids, tool));
    });

    this.panel.on('viewport.command', cmd => {
      if (cmd.action === 'fit') this.fit(cmd.ids);
      else if (cmd.action === 'view') this.setView(cmd.view);
    }, true);
  }

  // ------------------------------------------------------------ setup

  private init(): void {
    const container = this.containerRef().nativeElement;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      this.error.set('This view needs WebGL, which the browser could not provide.');
      console.warn(e);
      return;
    }
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    const target = (this.panel.snapshot()['camera'] as CameraState | undefined)?.target;
    if (target) this.orbit.target.fromArray(target);
    this.orbit.update();
    this.orbit.addEventListener('change', () => this.requestRender());
    this.orbit.addEventListener('start', () => {
      if (this.view() !== 'custom') this.panel.setState({ view: 'custom' });
    });
    this.orbit.addEventListener('end', () => this.saveCamera());
    this.orbit.enabled = !this.walking();

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    const helper = this.gizmo.getHelper();
    helper.userData['helper'] = true;
    this.overlay.add(helper);
    this.gizmo.addEventListener('change', () => this.requestRender());
    this.gizmo.addEventListener('dragging-changed', e => {
      if (this.orbit) this.orbit.enabled = !e.value;
      if (!e.value) this.doc.touch();
    });
    this.gizmo.addEventListener('objectChange', () => this.doc.touch());

    const canvas = this.renderer.domElement;
    // Before the orbit and gizmo controls see it: a press on a selected shape's face, edge or corner sizes it.
    container.addEventListener('pointerdown', this.onEditPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onHover);
    canvas.addEventListener('pointerleave', this.onHoverLeave);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('mousedown', this.onMouseDown);

    this.resizeObserver.observe(container);
    this.updateGizmo(this.mode(), this.selection()?.ids, this.tool());

    this.raytrace?.register({
      id: this.panel.id,
      title: () => this.panel.title(),
      container,
      camera: this.camera,
      webgl: this.renderer,
      background: () => this.backgroundColour(),
      size: () => ({ width: container.clientWidth, height: container.clientHeight }),
      requestRender: () => this.requestRender(),
    });
  }

  private readonly resizeObserver = new ResizeObserver(() => {
    const el = this.containerRef().nativeElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!this.renderer || w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.raytrace?.resized(this.panel.id, w, h);
    if (this.fitOnFirstSize) {
      // A view without a saved camera frames the scene from its view direction.
      this.fitOnFirstSize = false;
      this.fit([]);
    }
    this.render();
  });

  private dispose(): void {
    this.edit?.cancel();
    this.containerRef().nativeElement.removeEventListener('pointerdown', this.onEditPointerDown, { capture: true });
    this.stopWalking();
    clearTimeout(this.wheelSave);
    this.raytrace?.unregister(this.panel.id);
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.gizmo?.detach();
    this.gizmo?.dispose();
    this.orbit?.dispose();
    this.boxes.forEach(b => b.dispose());
    this.gridHelper.dispose();
    this.axesHelper.dispose();
    this.wireMaterial.dispose();
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
  }

  // ------------------------------------------------------------ drawing

  private requestRender(): void {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
    }
  }

  private render(): void {
    const r = this.renderer;
    if (!r || r.domElement.width === 0) return;
    this.gridHelper.visible = this.grid();
    this.axesHelper.visible = this.axes();
    this.updateBoxes();

    r.setClearColor(this.backgroundColour());
    r.clear();
    // With the ray traced image over the view, WebGL only clears; the image covers it.
    if (!this.tracing()) {
      const scene = this.doc.scene;
      // Face loops are on their own layer, so each view shows them or not.
      if (this.loops()) this.camera.layers.enable(FACE_LOOPS_LAYER);
      else this.camera.layers.disable(FACE_LOOPS_LAYER);
      scene.overrideMaterial = this.wireframe() ? this.wireMaterial : null;
      r.render(scene, this.camera);
      scene.overrideMaterial = null;
      r.render(this.overlay, this.camera);
    }
    this.drawDimensions();
    // Ray traces again from the camera as it is now, when this view is traced.
    this.raytrace?.render(this.panel.id);
  }

  /** The view's background as a CSS colour. */
  private backgroundColour(): string {
    const bg = this.background();
    return bg === 'theme' ? getComputedStyle(this.containerRef().nativeElement).getPropertyValue('--viewport-bg').trim() || '#1b2230' : bg;
  }

  protected readonly raytraceAvailable = !!this.raytrace;

  protected toggleRaytrace(): void {
    this.raytrace?.toggleView(this.panel.id);
  }

  private updateBoxes(): void {
    const selected = new Set(this.doc.objects(this.selection()?.ids).map(o => o.uuid));
    for (const [id, helper] of this.boxes) {
      if (!selected.has(id)) {
        helper.removeFromParent();
        helper.dispose();
        this.boxes.delete(id);
      }
    }
    for (const id of selected) {
      const o = this.doc.get(id)!;
      let helper = this.boxes.get(id);
      if (!helper) {
        helper = new THREE.Box3Helper(new THREE.Box3(), 0xffd400);
        helper.userData['helper'] = true;
        this.boxes.set(id, helper);
        this.overlay.add(helper);
      }
      helper.box.setFromObject(o);
      if (helper.box.isEmpty()) {
        // A light or empty group: a small box round its position.
        const p = o.getWorldPosition(new THREE.Vector3());
        helper.box.setFromCenterAndSize(p, new THREE.Vector3(0.3, 0.3, 0.3));
      }
    }
  }

  private updateGizmo(mode: ToolMode, ids: string[] | undefined, tool?: { space: 'world' | 'local'; snap: number | null }): void {
    const g = this.gizmo;
    if (!g) return;
    const objects = this.doc.objects(ids);
    if (mode === 'select' || objects.length !== 1) {
      if (g.object) g.detach();
    } else {
      if (g.object !== objects[0]) g.attach(objects[0]);
      g.setMode(mode);
      g.setSpace(tool?.space ?? 'world');
      const snap = tool?.snap ?? null;
      g.setTranslationSnap(snap);
      g.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
      g.setScaleSnap(snap ? 0.1 : null);
    }
    this.requestRender();
  }

  // ------------------------------------------------------------ camera

  private restoreCamera(): void {
    const c = this.panel.snapshot()['camera'] as CameraState | undefined;
    if (c?.position) {
      this.camera.position.fromArray(c.position);
      this.camera.lookAt(new THREE.Vector3().fromArray(c.target ?? [0, 0, 0]));
    } else {
      const v = this.view();
      const dir = VIEWS[v === 'custom' ? 'iso' : v].dir;
      this.camera.position.set(...dir).normalize().multiplyScalar(9);
      this.camera.lookAt(0, 0, 0);
      this.fitOnFirstSize = true;
    }
  }

  private saveCamera(): void {
    if (!this.orbit) return;
    const round = (v: THREE.Vector3) => v.toArray().map(x => Math.round(x * 1000) / 1000) as [number, number, number];
    this.panel.setState({ camera: { position: round(this.camera.position), target: round(this.orbit.target) } });
  }

  /** Frames objects, or the selection, or everything. */
  fit(ids?: string[]): void {
    const chosen = ids ?? this.selection()?.ids;
    let box = this.doc.bounds(chosen);
    if (box.isEmpty()) box = this.doc.bounds();
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Small parts, such as a screw in metres, fill the view too.
    const radius = Math.max(sphere.radius, 1e-4);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const distance = (radius / Math.sin(fit / 2)) * 1.1;
    const target = this.orbit?.target ?? new THREE.Vector3();
    const dir = this.camera.position.clone().sub(target).normalize();
    if (dir.lengthSq() === 0) dir.set(1, 0.8, 1).normalize();
    this.orbit?.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
    this.camera.near = Math.max(distance / 1000, 1e-6);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.orbit?.update();
    this.saveCamera();
    this.requestRender();
  }

  setView(view: ViewName): void {
    const target = this.orbit?.target ?? new THREE.Vector3();
    const distance = Math.max(this.camera.position.distanceTo(target), 0.5);
    const dir = new THREE.Vector3(...VIEWS[view].dir).normalize();
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.camera.lookAt(target);
    this.orbit?.update();
    this.panel.setState({ view });
    this.saveCamera();
    this.requestRender();
  }

  protected openViews(event: MouseEvent): void {
    this.menus.show(
      (Object.keys(VIEWS) as ViewName[]).map(v => ({
        label: VIEWS[v].label,
        checked: this.view() === v,
        action: () => this.setView(v),
      })),
      event.currentTarget as HTMLElement,
    );
  }

  protected openBackgrounds(event: MouseEvent): void {
    this.menus.show(
      BACKGROUNDS.map(b => ({
        label: b.label,
        swatch: b.value === 'theme' ? 'var(--viewport-bg)' : b.value,
        checked: this.background() === b.value,
        action: () => this.panel.setState({ background: b.value }),
      })),
      event.currentTarget as HTMLElement,
    );
  }

  protected toggle(key: 'grid' | 'axes' | 'wireframe' | 'loops'): void {
    const current = { grid: this.grid, axes: this.axes, wireframe: this.wireframe, loops: this.loops }[key]();
    this.panel.setState({ [key]: !current });
  }

  // ------------------------------------------------------------ input

  private readonly onPointerDown = (e: PointerEvent) => {
    this.containerRef().nativeElement.focus({ preventScroll: true });
    this.pointerDown = { x: e.clientX, y: e.clientY, onGizmo: !!this.gizmo?.object && this.gizmo.axis !== null };
    if (this.zoomBox() && !this.pointerDown.onGizmo && e.button === 0) {
      // Not a selection click: the rectangle has the pointer until it is let go.
      this.pointerDown = null;
      this.startZoomBox(e);
      return;
    }
    if (this.walking() && !this.pointerDown.onGizmo && e.button === 0) this.startLook(e);
    if (this.walking() && e.button === 1) {
      // Not the browser's autoscroll: the middle button walks sideways and up or down.
      e.preventDefault();
      this.startSideWalk(e);
    }
  };

  /** Stops the middle button's autoscroll while walking. */
  private readonly onMouseDown = (e: MouseEvent) => {
    if (this.walking() && e.button === 1) e.preventDefault();
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || e.button !== 0 || down.onGizmo) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    this.selectAt(e);
  };

  /** A click selects what is under it; with Shift or Ctrl, adds it or takes it away. */
  private selectAt(e: MouseEvent): void {
    const id = this.pick(e);
    const current = this.selection()?.ids ?? [];
    let ids: string[];
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      ids = id ? (current.includes(id) ? current.filter(x => x !== id) : [...current, id]) : current;
    } else {
      ids = id ? [id] : [];
    }
    if (ids.length !== current.length || ids.some((x, i) => x !== current[i])) {
      this.panel.publish('selection', { ids }, true);
    }
  }

  private readonly onDoubleClick = (e: MouseEvent) => {
    const id = this.pick(e);
    if (id) this.fit([id]);
  };

  private pick(e: MouseEvent): string | null {
    return this.firstHit(this.rayAt(e))?.object.uuid ?? null;
  }

  /** A ray from the camera through the pointer. */
  private rayAt(e: MouseEvent): THREE.Raycaster {
    const canvas = this.renderer!.domElement;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  /** The first visible thing a ray hits, not counting lights. */
  private firstHit(ray: THREE.Raycaster): THREE.Intersection | undefined {
    return ray.intersectObjects(this.doc.scene.children, true).find(h => isShown(h.object) && !(h.object as THREE.Light).isLight);
  }

  protected onKey(e: KeyboardEvent): void {
    if (this.edit) {
      // While sizing a shape: Esc puts it back, Ctrl switches to keeping the centre.
      if (e.key === 'Escape') this.edit.cancel();
      else if (e.key === 'Control' || e.key === 'Meta') this.edit.update(true);
      e.preventDefault();
      return;
    }
    const modes: Record<string, ToolMode> = { q: 'select', w: 'translate', e: 'rotate', r: 'scale' };
    const key = e.key.toLowerCase();
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (this.walking() && plain && WALK_KEYS.has(e.code)) {
      // While walking, WASD, Q/E and the arrows move the camera instead of choosing tools.
      this.walkKeys.add(e.code);
      this.startWalkLoop();
    } else if (this.walking() && key === 'escape') {
      this.setWalking(false);
    } else if (key === 'g' && plain && !e.repeat) {
      this.setWalking(!this.walking());
    } else if (modes[key] && plain) {
      const t = this.tool();
      this.panel.publish('tool.mode', { mode: modes[key], space: t?.space ?? 'world', snap: t?.snap ?? null }, true);
    } else if (key === 'f') {
      this.fit();
    } else if (key === 'l' && plain && !e.repeat) {
      this.toggle('loops');
    } else if (key === 'delete' || key === 'backspace') {
      const ids = this.selection()?.ids ?? [];
      if (!ids.length) return;
      this.doc.remove(ids);
      this.panel.publish('selection', { ids: [] }, true);
    } else if (key === 'z' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && this.raytrace) {
      this.raytrace.toggleView(this.panel.id);
    } else if (key === 'b' && plain && !e.repeat && !this.walking()) {
      this.setZoomBox(!this.zoomBox());
    } else if (key === 'escape' && this.zoomBox()) {
      this.setZoomBox(false);
    } else if (key === 'escape') {
      this.panel.publish('selection', { ids: [] }, true);
    } else {
      return;
    }
    e.preventDefault();
  }

  // ------------------------------------------------------------ sizing shapes

  /** The shape being sized, while the button is down. */
  private edit: EditState | null = null;
  /** The dimension lines drawn over the view while a shape is sized, in pixels. */
  protected readonly dimDraw = signal<DimensionDraw[]>([]);
  protected readonly dimColour = signal('#ffd400');
  protected readonly dimHalo = signal('#1b2230');
  /** The dimensions being changed, for the status line. */
  protected readonly editInfo = signal<string | null>(null);

  /**
   * The selected box, sphere, cylinder, cone, torus or plane under the pointer, and the face, edge
   * or corner of it there, if nothing else is in front.
   */
  private editTarget(e: MouseEvent): { mesh: THREE.Mesh; shape: EditableShape; handle: Handle } | null {
    if (!this.renderer || this.walking() || this.zoomBox()) return null;
    const selected = this.doc.objects(this.selection()?.ids).filter(o => isShown(o) && !!editableShape(o));
    if (!selected.length) return null;
    const ray = this.rayAt(e);
    const hit = ray.intersectObjects(selected, false)[0];
    if (!hit?.face) return null;
    const first = this.firstHit(ray);
    if (first && first.object !== hit.object && first.distance < hit.distance) return null;
    const mesh = hit.object as THREE.Mesh;
    const shape = editableShape(mesh)!;
    const local = mesh.worldToLocal(hit.point.clone());
    const handle = pickHandle(shape, local, hit.face.normal, this.localTolerance(mesh, hit.point, 8));
    return handle ? { mesh, shape, handle } : null;
  }

  /** How far `pixels` is at a point, along each of an object's local axes. */
  private localTolerance(o: THREE.Object3D, at: THREE.Vector3, pixels: number): THREE.Vector3 {
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const depth = Math.max(at.clone().sub(this.camera.position).dot(forward), this.camera.near);
    const height = this.renderer?.domElement.clientHeight || 1;
    const world = (pixels * 2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / height;
    const scale = worldScale(o);
    return new THREE.Vector3(world / scale.x, world / scale.y, world / scale.z);
  }

  /** Presses on a selected shape size it, before orbiting or the gizmo can take the press. */
  private readonly onEditPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== this.renderer?.domElement || this.edit) return;
    if (this.gizmo?.object && this.gizmo.axis !== null) return;
    const target = this.editTarget(e);
    if (!target) return;
    e.stopPropagation();
    this.containerRef().nativeElement.focus({ preventScroll: true });
    this.startEdit(e, target.mesh, target.shape, target.handle);
  };

  /** Shows what a press would hold, with the cursor. */
  private readonly onHover = (e: PointerEvent) => {
    const canvas = this.renderer?.domElement;
    if (!canvas || this.edit || e.buttons) return;
    let cursor = '';
    if (!(this.gizmo?.object && this.gizmo.axis !== null)) {
      const t = this.editTarget(e);
      if (t) cursor = this.cursorFor(t.mesh, t.handle);
    }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  };

  private readonly onHoverLeave = () => {
    if (this.renderer && !this.edit) this.renderer.domElement.style.cursor = '';
  };

  /**
   * A resize cursor along the line a face moves on, or out from the centre or axis for a round
   * size; a move cursor for edges and corners.
   */
  private cursorFor(mesh: THREE.Mesh, handle: Handle): string {
    const c = handle.constraint;
    let a: { x: number; y: number };
    let b: { x: number; y: number };
    if (c.kind === 'line') {
      a = this.toScreen(handle.grab, mesh);
      b = this.toScreen(handle.grab.clone().add(c.dir.clone().multiplyScalar(0.01 * (handle.grab.length() || 1))), mesh);
    } else if (c.kind === 'radial' && handle.dims.length === 1) {
      const foot = c.axis ? c.axis.clone().multiplyScalar(handle.grab.dot(c.axis)) : new THREE.Vector3();
      a = this.toScreen(foot, mesh);
      b = this.toScreen(handle.grab, mesh);
    } else {
      return 'move';
    }
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-3) return 'move';
    const angle = ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 180) % 180;
    if (angle < 22.5 || angle >= 157.5) return 'ew-resize';
    if (angle < 67.5) return 'nwse-resize';
    if (angle < 112.5) return 'ns-resize';
    return 'nesw-resize';
  }

  /** A point in an object's local coordinates, in pixels in the view; `behind` if behind the camera. */
  private toScreen(local: THREE.Vector3, o: THREE.Object3D): { x: number; y: number; behind: boolean } {
    const canvas = this.renderer!.domElement;
    const p = local.clone().applyMatrix4(o.matrixWorld).project(this.camera);
    return { x: ((p.x + 1) / 2) * canvas.clientWidth, y: ((1 - p.y) / 2) * canvas.clientHeight, behind: p.z > 1 };
  }

  /**
   * Sizes a shape as the pointer moves: the point held follows the pointer, along its line or over
   * its plane. A press without a drag is a click, and selects as usual.
   */
  private startEdit(e: PointerEvent, mesh: THREE.Mesh, shape: EditableShape, handle: Handle): void {
    const canvas = this.renderer!.domElement;
    canvas.setPointerCapture?.(e.pointerId);
    mesh.updateMatrixWorld();
    const inverse = mesh.matrixWorld.clone().invert();
    const startPosition = mesh.position.clone();
    const scale = worldScale(mesh);
    const snap = this.tool()?.snap ?? null;
    const view = this.camera.getWorldDirection(new THREE.Vector3()).transformDirection(inverse);
    const rect = canvas.getBoundingClientRect();
    let moved = false;
    let last: PointerEvent = e;
    let symmetric = e.ctrlKey || e.metaKey;
    // Sizes change by how far the pointer moves from where it was pressed, under the same constraint.
    const from = constrainedPoint(handle, this.rayAt(e).ray.clone().applyMatrix4(inverse), view) ?? handle.grab;

    const apply = () => {
      const ray = this.rayAt(last).ray.clone().applyMatrix4(inverse);
      const p = constrainedPoint(handle, ray, view);
      if (!p) return;
      const r = handle.apply(p, { symmetric, snap, scale, from });
      const position = startPosition.clone().add(r.shift.multiply(mesh.scale).applyQuaternion(mesh.quaternion));
      this.doc.setShape(mesh.uuid, r.params, position);
    };
    const move = (ev: PointerEvent) => {
      last = ev;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) <= 3) return;
      moved = true;
      symmetric = ev.ctrlKey || ev.metaKey;
      apply();
    };
    const finish = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      this.edit = null;
      this.editInfo.set(null);
      this.requestRender();
    };
    const up = (ev: PointerEvent) => {
      finish();
      if (!moved) this.selectAt(ev);
    };
    const cancel = () => {
      finish();
      if (moved) this.doc.setShape(mesh.uuid, shape.params, startPosition);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);

    this.edit = {
      mesh,
      handle,
      grab: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      chosen: [],
      cancel,
      update: ctrl => {
        symmetric = ctrl;
        if (moved) apply();
      },
    };
    this.requestRender();
  }

  /**
   * Engineering dimension lines for what is being changed: extension lines from the shape, a line
   * with arrows between them, and the size, in scene units, over its middle. Each dimension goes
   * where it is furthest out from the shape on screen, chosen when the drag begins.
   */
  private drawDimensions(): void {
    const ed = this.edit;
    const shape = ed && editableShape(ed.mesh);
    if (!ed || !shape || !this.renderer) {
      if (this.dimDraw().length) this.dimDraw.set([]);
      return;
    }
    const mesh = ed.mesh;
    mesh.updateMatrixWorld();
    const inverse = mesh.matrixWorld.clone().invert();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).transformDirection(inverse);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).transformDirection(inverse);
    const centre = this.toScreen(new THREE.Vector3(), mesh);
    const draws: DimensionDraw[] = [];
    dimensionLines(shape, ed.handle.dims, right, up).forEach((candidates, i) => {
      const laid = candidates.map(c => this.layOut(c, mesh, centre, ed.grab));
      let pick = ed.chosen[i];
      if (pick === undefined || !laid[pick]) {
        pick = -1;
        laid.forEach((d, j) => {
          if (d && (pick < 0 || d.score > laid[pick]!.score)) pick = j;
        });
        if (pick < 0) return;
        ed.chosen[i] = pick;
      }
      draws.push(laid[pick]!);
    });
    this.dimDraw.set(draws);
    const bg = this.backgroundColour();
    this.dimColour.set(isLight(bg) ? '#0b57d0' : '#ffd400');
    this.dimHalo.set(bg);
    this.editInfo.set(draws.length ? `${mesh.name}: ${draws.map(d => `${DIMENSION_NAMES[d.name]} ${d.label}`).join(', ')}` : `Sizing ${mesh.name}`);
  }

  /** A dimension in pixels: its lines, arrowheads and label, or null if seen end on. */
  private layOut(d: Dimension, mesh: THREE.Mesh, centre: { x: number; y: number }, grab: { x: number; y: number }): DimensionDraw | null {
    const hasSide = d.side.lengthSq() > 0;
    // The measured points, brought out level with each other on the side the line goes.
    const a2 = d.a.clone();
    const b2 = d.b.clone();
    if (hasSide) {
      const level = Math.max(d.a.dot(d.side), d.b.dot(d.side));
      a2.addScaledVector(d.side, level - d.a.dot(d.side));
      b2.addScaledVector(d.side, level - d.b.dot(d.side));
    }
    const A = this.toScreen(d.a, mesh);
    const B = this.toScreen(d.b, mesh);
    const A2 = this.toScreen(a2, mesh);
    const B2 = this.toScreen(b2, mesh);
    if (A.behind || B.behind || A2.behind || B2.behind) return null;
    const len = Math.hypot(B2.x - A2.x, B2.y - A2.y);
    if (len < 4) return null;
    const t = { x: (B2.x - A2.x) / len, y: (B2.y - A2.y) / len };
    // Which way the line is set off on screen: the side, square to the line.
    let n = { x: -t.y, y: t.x };
    if (hasSide) {
      const P = this.toScreen(a2.clone().addScaledVector(d.side, 0.05 * (d.a.distanceTo(d.b) || 1)), mesh);
      const sx = P.x - A2.x;
      const sy = P.y - A2.y;
      const dot = sx * n.x + sy * n.y;
      if (Math.abs(dot) > 1e-6) n = dot > 0 ? n : { x: -n.x, y: -n.y };
      else if ((A2.x - centre.x) * n.x + (A2.y - centre.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    } else if (n.y > 0) {
      n = { x: -n.x, y: -n.y };
    }
    const off = hasSide ? 26 : 0;
    const L1 = { x: A2.x + n.x * off, y: A2.y + n.y * off };
    const L2 = { x: B2.x + n.x * off, y: B2.y + n.y * off };
    const lines: number[][] = [];
    const arrows: string[] = [];
    if (hasSide) {
      // Extension lines from the shape, with a small gap, to a little past the dimension line.
      for (const [from, to] of [[A, L1], [B, L2]] as const) {
        const ex = to.x - from.x;
        const ey = to.y - from.y;
        const el = Math.hypot(ex, ey);
        if (el < 4) continue;
        lines.push([from.x + (ex / el) * 3, from.y + (ey / el) * 3, to.x + (ex / el) * 5, to.y + (ey / el) * 5]);
      }
    }
    const head = 9;
    const arrow = (tip: { x: number; y: number }, dx: number, dy: number) =>
      `${tip.x},${tip.y} ${tip.x + dx * head - dy * 3.5},${tip.y + dy * head + dx * 3.5} ${tip.x + dx * head + dy * 3.5},${tip.y + dy * head - dx * 3.5}`;
    if (len >= 2 * head + 8) {
      lines.push([L1.x, L1.y, L2.x, L2.y]);
      arrows.push(arrow(L1, t.x, t.y), arrow(L2, -t.x, -t.y));
    } else {
      // Too short for arrows inside: they point in from outside.
      const out = head + 10;
      lines.push([L1.x - t.x * out, L1.y - t.y * out, L2.x + t.x * out, L2.y + t.y * out]);
      arrows.push(arrow(L1, -t.x, -t.y), arrow(L2, t.x, t.y));
    }
    // The size in the scene: along the axis, in world units.
    const along = Math.abs(d.b.clone().sub(d.a).dot(d.axis));
    const wa = d.a.clone().applyMatrix4(mesh.matrixWorld);
    const wb = d.a.clone().addScaledVector(d.axis, along).applyMatrix4(mesh.matrixWorld);
    const value = wa.distanceTo(wb);
    let angle = (Math.atan2(t.y, t.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    // The label sits on the far side of the line from the shape, upright.
    const tx = (L1.x + L2.x) / 2 + n.x * 10;
    const ty = (L1.y + L2.y) / 2 + n.y * 10;
    const outward = (tx - centre.x) * n.x + (ty - centre.y) * n.y;
    return {
      name: d.name,
      lines: lines.map(l => l.map(v => Math.round(v * 10) / 10)),
      arrows,
      label: `${d.prefix}${formatLength(value)}`,
      tx: Math.round(tx * 10) / 10,
      ty: Math.round(ty * 10) / 10,
      rotate: `rotate(${Math.round(angle * 10) / 10} ${Math.round(tx * 10) / 10} ${Math.round(ty * 10) / 10})`,
      score: (hasSide ? outward : 0) - 0.25 * Math.hypot(tx - grab.x, ty - grab.y),
    };
  }

  // ------------------------------------------------------------ zoom box

  /** Arms or cancels the zoom box. Orbiting is off while it is armed, so dragging draws. */
  protected setZoomBox(on: boolean): void {
    this.zoomBox.set(on);
    this.zoomRect.set(null);
    if (this.orbit) this.orbit.enabled = !on && !this.walking();
    if (on) this.containerRef().nativeElement.focus({ preventScroll: true });
  }

  private startZoomBox(e: PointerEvent): void {
    const canvas = e.currentTarget as HTMLElement;
    canvas.setPointerCapture?.(e.pointerId);
    const origin = canvas.getBoundingClientRect();
    const x0 = e.clientX - origin.left;
    const y0 = e.clientY - origin.top;
    const move = (ev: PointerEvent) => {
      const x1 = ev.clientX - origin.left;
      const y1 = ev.clientY - origin.top;
      this.zoomRect.set({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
    };
    const end = (ev: PointerEvent) => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      const rect = this.zoomRect();
      this.setZoomBox(false);
      if (ev.type === 'pointercancel') return;
      if (rect && rect.w > 4 && rect.h > 4) {
        this.zoomTo(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w, rect.h, origin.width, origin.height);
      } else {
        // A click zooms in twice, about the point clicked.
        this.zoomTo(x0, y0, origin.width / 2, origin.height / 2, origin.width, origin.height);
      }
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /**
   * Zooms so that a w x h pixel rectangle centred at (x, y) fills the view, keeping the view
   * direction. The new centre is what is under the rectangle: the surface under its centre, or
   * else the nearest one elsewhere in it, or, with nothing there, a point as far as the orbit
   * centre.
   */
  private zoomTo(x: number, y: number, w: number, h: number, width: number, height: number): void {
    if (!width || !height) return;
    const ndc = (px: number, py: number) => new THREE.Vector2((px / width) * 2 - 1, -(py / height) * 2 + 1);
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const target = this.orbit?.target ?? new THREE.Vector3();
    let depth = this.depthAt(ndc(x, y), forward);
    if (depth === null) {
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const d = this.depthAt(ndc(x - w / 2 + (w * (i + 0.5)) / 5, y - h / 2 + (h * (j + 0.5)) / 5), forward);
          if (d !== null && (depth === null || d < depth)) depth = d;
        }
      }
    }
    depth ??= Math.max(target.clone().sub(this.camera.position).dot(forward), 1e-4);
    // The point at that depth under the box's centre becomes the new centre, and the camera
    // closes in by the box's share of the view.
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc(x, y), this.camera);
    const centre = ray.ray.at(depth / Math.max(ray.ray.direction.dot(forward), 1e-6), new THREE.Vector3());
    const share = Math.min(Math.max(w / width, h / height), 1);
    const distance = Math.max(depth * share, 1e-6);
    this.camera.position.copy(centre).addScaledVector(forward, -distance);
    this.orbit?.target.copy(centre);
    this.camera.near = Math.min(this.camera.near, Math.max(distance / 1000, 1e-6));
    this.camera.updateProjectionMatrix();
    this.orbit?.update();
    this.saveCamera();
    this.requestRender();
  }

  /** Distance along `forward` to the first visible surface at a point in the view, or null. */
  private depthAt(ndc: THREE.Vector2, forward: THREE.Vector3): number | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray
      .intersectObjects(this.doc.scene.children, true)
      .find(h => isShown(h.object) && (h.object as THREE.Mesh).isMesh);
    return hit ? hit.point.clone().sub(this.camera.position).dot(forward) : null;
  }

  // ------------------------------------------------------------ walking

  private readonly walkKeys = new Set<string>();
  private walkFrame = 0;
  private walkLast = 0;

  /** Opens the walk settings for this view. */
  protected async openWalkSettings(): Promise<void> {
    const s = await this.dialogs.walkOptions(
      { speed: this.walkSpeed(), fastKeys: this.fastKeys(), fastMouse: this.fastMouse() },
      this.baseWalkSpeed(),
    );
    if (!s) return;
    this.panel.setState({
      walkSpeed: Math.round(clampWalk(s.speed, WALK_SPEED, 1) * 1000) / 1000,
      walkFastKeys: clampWalk(s.fastKeys, WALK_FAST, defaultWalkSettings().fastKeys),
      walkFastMouse: clampWalk(s.fastMouse, WALK_FAST, defaultWalkSettings().fastMouse),
    });
    this.containerRef().nativeElement.focus({ preventScroll: true });
  }

  /** Turns walk mode on or off. Orbiting is off while walking. */
  protected setWalking(on: boolean): void {
    if (on && this.zoomBox()) this.setZoomBox(false);
    if (!on) this.stopWalking();
    if (this.orbit) {
      this.orbit.enabled = !on;
      if (!on) this.orbit.update();
    }
    this.panel.setState({ walk: on });
    if (on) this.containerRef().nativeElement.focus({ preventScroll: true });
  }

  protected onKeyUp(e: KeyboardEvent): void {
    if (this.edit && (e.key === 'Control' || e.key === 'Meta')) this.edit.update(false);
    if (this.walkKeys.delete(e.code) && this.walkKeys.size === 0) this.endWalkMove();
  }

  /** Stops moving, as when the view loses focus. */
  stopWalking(): void {
    const moving = this.walkKeys.size > 0;
    this.walkKeys.clear();
    cancelAnimationFrame(this.walkFrame);
    this.walkFrame = 0;
    if (moving) this.saveCamera();
  }

  private endWalkMove(): void {
    cancelAnimationFrame(this.walkFrame);
    this.walkFrame = 0;
    this.saveCamera();
  }

  /** Walking speed in scene units (metres) per second for the scene's size, before the speed setting. */
  private baseWalkSpeed(): number {
    const box = this.doc.bounds();
    if (box.isEmpty()) return 1.5;
    const size = box.getSize(new THREE.Vector3());
    // About a tenth of the scene's width a second, and at least a slow walk.
    return Math.max(Math.max(size.x, size.z) / 10, 0.5);
  }

  private startWalkLoop(): void {
    if (this.walkFrame) return;
    if (this.view() !== 'custom') this.panel.setState({ view: 'custom' });
    this.walkLast = performance.now();
    const step = (now: number) => {
      const dt = Math.min(Math.max((now - this.walkLast) / 1000, 0), 0.1);
      this.walkLast = now;
      this.walkStep(dt);
      this.walkFrame = this.walkKeys.size ? requestAnimationFrame(step) : 0;
    };
    this.walkFrame = requestAnimationFrame(step);
  }

  /** The level direction the camera faces, and its right, for walking. */
  private walkAxes(): { forward: THREE.Vector3; right: THREE.Vector3 } {
    const forward = this.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (forward.lengthSq() < 1e-8) forward.set(0, 1, 0).applyQuaternion(this.camera.quaternion).setY(0);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    return { forward, right };
  }

  /** Moves the camera, and the orbit centre with it, while walking. */
  private walkBy(move: THREE.Vector3): void {
    if (move.lengthSq() === 0) return;
    if (this.view() !== 'custom') this.panel.setState({ view: 'custom' });
    this.camera.position.add(move);
    this.orbit?.target.add(move);
    this.requestRender();
  }

  /** Moves the camera for the keys held: over the ground plane, and up or down. */
  private walkStep(dt: number): void {
    const k = this.walkKeys;
    const { forward, right } = this.walkAxes();
    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    if (k.has('KeyE') || k.has('PageUp')) move.y += 1;
    if (k.has('KeyQ') || k.has('PageDown')) move.y -= 1;
    if (move.lengthSq() === 0) return;
    const run = k.has('ShiftLeft') || k.has('ShiftRight') ? this.fastKeys() : 1;
    move.normalize().multiplyScalar(this.baseWalkSpeed() * this.walkSpeed() * run * dt);
    this.walkBy(move);
  }

  /**
   * Dragging with the middle button walks left and right, and up and down, against the way the
   * mouse moves, so the scene follows it. 400 pixels go as far as a second of walking; Shift runs.
   */
  private startSideWalk(e: PointerEvent): void {
    const canvas = e.currentTarget as HTMLElement;
    canvas.setPointerCapture?.(e.pointerId);
    let lastX = e.clientX;
    let lastY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!dx && !dy) return;
      moved = true;
      const step = (this.baseWalkSpeed() * this.walkSpeed() * (ev.shiftKey ? this.fastMouse() : 1)) / 400;
      const { right } = this.walkAxes();
      // The scene follows the mouse: dragging right walks left, dragging up walks down.
      this.walkBy(right.multiplyScalar(-dx * step).add(new THREE.Vector3(0, dy * step, 0)));
    };
    const end = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      if (moved) this.saveCamera();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /** Dragging turns the camera on the spot, keeping it level. */
  private startLook(e: PointerEvent): void {
    const canvas = e.currentTarget as HTMLElement;
    let lastX = e.clientX;
    let lastY = e.clientY;
    let moved = false;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!dx && !dy) return;
      moved = true;
      euler.setFromQuaternion(this.camera.quaternion);
      euler.y -= dx * 0.004;
      euler.x = Math.max(-1.55, Math.min(1.55, euler.x - dy * 0.004));
      euler.z = 0;
      this.camera.quaternion.setFromEuler(euler);
      // Keep the orbit centre ahead, so leaving walk mode orbits round what is in front.
      if (this.orbit) {
        const d = Math.max(this.camera.position.distanceTo(this.orbit.target), 0.5);
        this.orbit.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), d);
      }
      if (this.view() !== 'custom') this.panel.setState({ view: 'custom' });
      this.requestRender();
    };
    const end = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      if (moved) this.saveCamera();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /**
   * In walk mode, the wheel walks forward and back, a quarter of a second of walking a notch
   * (Shift runs at the mouse's fast speed). Ctrl+wheel changes the walking speed.
   */
  private readonly onWheel = (e: WheelEvent) => {
    if (!this.walking()) return;
    e.preventDefault();
    // With Shift, browsers on Windows and Linux turn the wheel sideways, into deltaX.
    const delta = e.deltaY || (e.shiftKey ? e.deltaX : 0);
    if (!delta) return;
    if (e.ctrlKey || e.metaKey) {
      const speed = clampWalk(this.walkSpeed() * (delta < 0 ? 1.25 : 0.8), WALK_SPEED, 1);
      this.panel.setState({ walkSpeed: Math.round(speed * 1000) / 1000 });
      return;
    }
    // Notches, from pixels, lines or pages; a touchpad's small steps move a little.
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 10 : e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 1 / 3 : 1 / 100;
    const notches = Math.max(-5, Math.min(5, -delta * unit));
    const distance = this.baseWalkSpeed() * this.walkSpeed() * (e.shiftKey ? this.fastMouse() : 1) * 0.25 * notches;
    this.walkBy(this.walkAxes().forward.multiplyScalar(distance));
    clearTimeout(this.wheelSave);
    this.wheelSave = setTimeout(() => this.saveCamera(), 300);
  };
  private wheelSave: ReturnType<typeof setTimeout> | undefined;
}

/** Keys that move the camera in walk mode, by `KeyboardEvent.code`, so they work on any keyboard layout. */
const WALK_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
  'ShiftLeft', 'ShiftRight',
]);

interface EditState {
  mesh: THREE.Mesh;
  handle: Handle;
  /** Where the press was, in pixels in the view. */
  grab: { x: number; y: number };
  /** Which of each dimension's places was chosen, once drawn. */
  chosen: number[];
  /** Puts the shape back as it was and stops. */
  cancel(): void;
  /** Ctrl went down or up: keep the centre, or the opposite side. */
  update(symmetric: boolean): void;
}

interface DimensionDraw {
  name: Dimension['name'];
  /** x1, y1, x2, y2 of each line. */
  lines: number[][];
  /** SVG polygon points of each arrowhead. */
  arrows: string[];
  label: string;
  tx: number;
  ty: number;
  rotate: string;
  /** How well placed: far out from the shape, and near the pointer. */
  score: number;
}

const DIMENSION_NAMES: Record<Dimension['name'], string> = {
  width: 'width',
  height: 'height',
  depth: 'depth',
  diameter: 'diameter',
  outer: 'outer diameter',
  inner: 'inner diameter',
  thickness: 'thickness',
};

/** An object's size in the world for each unit along its local axes. */
function worldScale(o: THREE.Object3D): THREE.Vector3 {
  o.updateMatrixWorld();
  const c = new THREE.Vector3();
  const s = [0, 1, 2].map(i => c.setFromMatrixColumn(o.matrixWorld, i).length() || 1);
  return new THREE.Vector3(s[0], s[1], s[2]);
}

/** Whether a CSS colour is light, so dark lines show on it. */
function isLight(colour: string): boolean {
  try {
    const c = new THREE.Color(colour);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.5;
  } catch {
    return false;
  }
}

/** Whether an object and all its parents are visible. */
function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
