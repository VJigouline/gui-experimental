import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ToolMode, ViewName } from '../../core/bus/panel-bus';
import { PanelContext } from '../../core/panels/panel-context';
import { MenuService } from '../../ui/menu/menu.service';
import { FACE_LOOPS_LAYER, SceneDocument } from '../../scene/scene-document';
import { ThemeService } from '../../ui/theme.service';
import { RaytraceService, describeProgress } from '../../raytrace/raytrace.service';

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
      aria-label="3D view. Click to select; W, E, R for move, rotate, scale; F to fit; G to walk; L for face loops; Z to ray trace; Delete to remove."
      (keydown)="onKey($event)"
      (keyup)="onKeyUp($event)"
      (blur)="stopWalking()"></div>
    @if (error()) {
      <div class="panel-empty">{{ error() }}</div>
    }
    <div class="viewport-toolbar">
      <button type="button" class="tool-btn" title="View direction" (click)="openViews($event)">{{ viewLabel() }} ▾</button>
      <button type="button" class="tool-btn" title="Fit the selection, or everything (F)" (click)="fit()">⤢ Fit</button>
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
        title="Walk: WASD to move, Q/E down and up, drag to look, Shift to run, wheel for speed (G switches, Esc leaves)"
        (click)="setWalking(!walking())">
        🚶 Walk
      </button>
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
      } @else if (walking()) {
        Walk · WASD move · Q/E down, up · drag to look · Shift run · {{ walkSpeedLabel() }} · Esc leaves
      } @else {
        {{ mode() === 'select' ? 'Select' : modeLabel() }} · {{ selectionCount() }} selected
      }
    </div>
  `,
})
export class ViewportPanel {
  private readonly panel = inject(PanelContext);
  private readonly doc = inject(SceneDocument);
  private readonly menus = inject(MenuService);
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
  /** Walk mode: WASD moves the camera, dragging looks around. */
  protected readonly walking = this.panel.state('walk', false);
  /** Walking speed, as a multiple of the speed for the scene's size. */
  private readonly walkSpeed = this.panel.state('walkSpeed', 1);
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
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

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
    this.stopWalking();
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
    if (this.walking() && !this.pointerDown.onGizmo && e.button === 0) this.startLook(e);
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || e.button !== 0 || down.onGizmo) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
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
  };

  private readonly onDoubleClick = (e: MouseEvent) => {
    const id = this.pick(e);
    if (id) this.fit([id]);
  };

  private pick(e: MouseEvent): string | null {
    const canvas = this.renderer!.domElement;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.doc.scene.children, true);
    const hit = hits.find(h => isShown(h.object) && !(h.object as THREE.Light).isLight);
    return hit?.object.uuid ?? null;
  }

  protected onKey(e: KeyboardEvent): void {
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
    } else if (key === 'escape') {
      this.panel.publish('selection', { ids: [] }, true);
    } else {
      return;
    }
    e.preventDefault();
  }

  // ------------------------------------------------------------ walking

  private readonly walkKeys = new Set<string>();
  private walkFrame = 0;
  private walkLast = 0;

  /** Turns walk mode on or off. Orbiting is off while walking. */
  protected setWalking(on: boolean): void {
    if (!on) this.stopWalking();
    if (this.orbit) {
      this.orbit.enabled = !on;
      if (!on) this.orbit.update();
    }
    this.panel.setState({ walk: on });
    if (on) this.containerRef().nativeElement.focus({ preventScroll: true });
  }

  protected onKeyUp(e: KeyboardEvent): void {
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

  /** Moves the camera for the keys held: over the ground plane, and up or down. */
  private walkStep(dt: number): void {
    const k = this.walkKeys;
    const forward = this.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (forward.lengthSq() < 1e-8) forward.set(0, 1, 0).applyQuaternion(this.camera.quaternion).setY(0);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    if (k.has('KeyE') || k.has('PageUp')) move.y += 1;
    if (k.has('KeyQ') || k.has('PageDown')) move.y -= 1;
    if (move.lengthSq() === 0) return;
    const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
    move.normalize().multiplyScalar(this.baseWalkSpeed() * this.walkSpeed() * run * dt);
    this.camera.position.add(move);
    this.orbit?.target.add(move);
    this.requestRender();
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

  /** In walk mode, the wheel changes walking speed. */
  private readonly onWheel = (e: WheelEvent) => {
    if (!this.walking()) return;
    e.preventDefault();
    const speed = Math.min(Math.max(this.walkSpeed() * (e.deltaY < 0 ? 1.25 : 0.8), 0.05), 50);
    this.panel.setState({ walkSpeed: Math.round(speed * 1000) / 1000 });
  };
}

/** Keys that move the camera in walk mode, by `KeyboardEvent.code`, so they work on any keyboard layout. */
const WALK_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
  'ShiftLeft', 'ShiftRight',
]);

/** Whether an object and all its parents are visible. */
function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
