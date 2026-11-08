import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { RaytracingRenderer, type RaytracingProgress } from 'meercad-raytracer';
import * as THREE from 'three';
import { SceneDocument } from '../scene/scene-document';
import { DialogService } from '../ui/dialog/dialog.service';

/** Where the ray traced image is shown. */
export type RaytraceMode = 'off' | 'view' | 'window';

/** Tone mapping or colour space value meaning "as the 3D view". */
export const SAME_AS_VIEW = 'view';

export interface RaytraceSettings {
  /** Samples per pixel to stop at. */
  samples: number;
  /** Reflection, refraction and bounce depth. */
  maxBounces: number;
  /** Image resolution as a fraction of the screen's pixels. */
  resolution: number;
  /** Block size of the quick first preview, 1 for none. */
  previewBlock: number;
  /** Worker threads tracing in parallel. */
  workers: number;
  shadows: 'all' | 'castShadow' | 'none';
  globalIllumination: boolean;
  /** A three.js tone mapping constant, or SAME_AS_VIEW. */
  toneMapping: number | typeof SAME_AS_VIEW;
  exposure: number;
  /** 'srgb', 'srgb-linear' or SAME_AS_VIEW. */
  colorSpace: string;
  /** The 3D view's background behind the image, or `backgroundColour`. */
  background: 'view' | 'colour';
  /** CSS hex colour. */
  backgroundColour: string;
  /** In the separate window, keep the view's proportions instead of stretching to the window. */
  keepProportions: boolean;
}

export const MAX_WORKERS = Math.max(1, typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4);

export function defaultRaytraceSettings(): RaytraceSettings {
  return {
    samples: 64,
    maxBounces: 4,
    resolution: 1,
    previewBlock: 4,
    workers: Math.max(1, Math.min(8, MAX_WORKERS - 1)),
    shadows: 'all',
    globalIllumination: false,
    toneMapping: SAME_AS_VIEW,
    exposure: 1,
    colorSpace: SAME_AS_VIEW,
    background: 'view',
    backgroundColour: '#ffffff',
    keepProportions: true,
  };
}

/** What a 3D view gives the ray tracer, so it can trace from the view's camera. */
export interface RaytraceView {
  id: string;
  title: () => string;
  /** Where the image is drawn over the view. */
  container: HTMLElement;
  camera: THREE.Camera;
  webgl: THREE.WebGLRenderer;
  /** The view's background colour as a CSS colour. */
  background: () => string;
  /** Size of the view in CSS pixels. */
  size: () => { width: number; height: number };
  /** Asks the view to draw again, which ray traces again too. */
  requestRender: () => void;
}

export const SETTINGS_KEY = 'gui-experimental.raytrace.settings';
const STATUS_HEIGHT = 24;
const IDLE: RaytracingProgress = { samples: 0, maxSamples: 0, done: true, stopped: false, elapsed: 0 };

/**
 * Ray tracing for the workbench, as in SceneEditor: one RaytracingRenderer and its workers,
 * drawing into a canvas over one 3D view, or into a separate browser window that follows that
 * view's camera.
 *
 * Over a view, the image's canvas lies over the WebGL canvas with pointer events off, so
 * orbiting, picking and the transform gizmo keep working underneath. Every redraw of the view
 * restarts the ray trace, so moving the camera or editing the scene updates the image.
 */
@Injectable()
export class RaytraceService {
  private readonly doc = inject(SceneDocument);
  private readonly dialogs = inject(DialogService);

  readonly mode = signal<RaytraceMode>('off');
  /** The 3D view traced, by panel id. */
  readonly target = signal<string | null>(null);
  readonly settings = signal<RaytraceSettings>(readSettings());
  readonly progress = signal<RaytracingProgress>(IDLE);

  private readonly viewsStore = signal<ReadonlyMap<string, RaytraceView>>(new Map());
  /** The 3D views open, in the order they opened. */
  readonly views = computed(() => [...this.viewsStore().values()]);
  readonly active = computed(() => this.mode() !== 'off');

  private renderer: RaytracingRenderer | null = null;
  private rendererWorkers = 0;
  private overlay: HTMLCanvasElement | null = null;
  private popup: Window | null = null;
  private popupCanvas: HTMLCanvasElement | null = null;
  private popupStatus: HTMLElement | null = null;

  constructor() {
    const close = () => this.closePopup();
    window.addEventListener('beforeunload', close);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('beforeunload', close);
      this.closePopup();
      this.renderer?.dispose();
      this.renderer = null;
    });
  }

  // ------------------------------------------------------------ views

  /** Called by a 3D view when it can be traced. */
  register(view: RaytraceView): void {
    this.viewsStore.update(m => new Map(m).set(view.id, view));
  }

  /** Called by a 3D view as it closes. Tracing it stops. */
  unregister(id: string): void {
    if (!this.viewsStore().has(id)) return;
    this.viewsStore.update(m => {
      const n = new Map(m);
      n.delete(id);
      return n;
    });
    if (this.target() === id) {
      this.setMode('off');
      this.target.set(null);
    }
  }

  /** Whether a view shows the ray traced image over itself. */
  isTracingOver(id: string): boolean {
    return this.mode() === 'view' && this.target() === id;
  }

  /** The view traced, or the first one open. */
  private targetView(): RaytraceView | undefined {
    const views = this.viewsStore();
    const id = this.target();
    return (id && views.get(id)) || undefined;
  }

  // ------------------------------------------------------------ mode

  /**
   * Shows the ray traced image over a view, in a separate window, or turns it off. Without
   * a view, the current target or the first view is used. Opening the window must happen in
   * response to a click, or the browser may block it.
   */
  setMode(mode: RaytraceMode, viewId?: string): void {
    const id = viewId ?? this.target() ?? this.views()[0]?.id ?? null;
    const view = id ? this.viewsStore().get(id) : undefined;
    if (mode !== 'off' && !view) {
      void this.dialogs.message('No 3D view', 'Open a 3D view to ray trace it.');
      return;
    }
    const previous = this.targetView();
    if (mode === this.mode() && id === this.target()) {
      if (mode === 'window') this.popup?.focus();
      return;
    }

    if (mode !== 'window') this.closePopup();
    this.showOverlay(false);

    if (mode === 'off') {
      this.renderer?.stop();
      this.mode.set('off');
      this.progress.set(IDLE);
      previous?.requestRender();
      return;
    }
    if (mode === 'window' && !this.openPopup(view!)) {
      void this.dialogs.message('Window blocked', 'The browser blocked the ray tracing window. Allow pop-up windows for this site, then try again.');
      return;
    }

    this.mode.set(mode);
    this.target.set(id);
    // Shown until the renderer's first report.
    this.progress.set({ samples: 0, maxSamples: this.settings().samples, done: false, stopped: false, elapsed: 0 });
    const renderer = this.ensureRenderer();
    if (mode === 'view') {
      const canvas = this.overlayFor(view!);
      renderer.setCanvas(canvas);
      this.showOverlay(true);
      this.applyPixelRatio(window.devicePixelRatio);
      const { width, height } = view!.size();
      if (width && height) renderer.setSize(width, height);
    } else {
      renderer.setCanvas(this.popupCanvas!);
      this.applyPixelRatio(this.popup!.devicePixelRatio);
      this.fitPopup();
    }
    if (previous && previous !== view) previous.requestRender();
    view!.requestRender();
  }

  /** Z in a view: ray trace over it, or back to the WebGL view if it is already. */
  toggleView(viewId: string): void {
    this.setMode(this.isTracingOver(viewId) ? 'off' : 'view', viewId);
  }

  /** Traces another view, keeping the mode. */
  setTarget(viewId: string): void {
    if (this.mode() === 'off') this.target.set(viewId);
    else this.setMode(this.mode(), viewId);
  }

  // ------------------------------------------------------------ settings

  updateSettings(patch: Partial<RaytraceSettings>): void {
    this.settings.update(s => ({ ...s, ...patch }));
    writeSettings(this.settings());
    this.applySettings();
  }

  resetSettings(): void {
    this.settings.set(defaultRaytraceSettings());
    writeSettings(this.settings());
    this.applySettings();
  }

  private applySettings(): void {
    if (this.renderer && this.rendererWorkers !== this.settings().workers) {
      // A different number of workers needs a new renderer; it takes over the current canvas.
      const canvas = this.renderer.domElement;
      const size = this.renderer.getSize(new THREE.Vector2());
      this.renderer.dispose();
      this.renderer = null;
      this.ensureRenderer(canvas).setSize(size.x, size.y);
    }
    if (this.renderer) {
      this.applyPixelRatio(this.mode() === 'window' && this.popup ? this.popup.devicePixelRatio : window.devicePixelRatio);
    }
    this.targetView()?.requestRender();
  }

  // ------------------------------------------------------------ rendering

  /** Called by a view after it draws: restarts the ray trace if the view is traced. */
  render(viewId: string): void {
    if (this.mode() === 'off' || this.target() !== viewId || !this.renderer) return;
    const view = this.targetView();
    if (!view) return;
    const renderer = this.renderer;
    if (renderer.getSize(new THREE.Vector2()).x === 0) return;
    const s = this.settings();
    renderer.samples = s.samples;
    renderer.maxBounces = s.maxBounces;
    renderer.previewBlock = s.previewBlock;
    renderer.shadows = s.shadows;
    renderer.globalIllumination = s.globalIllumination;
    renderer.fitAspect = this.mode() === 'window' && s.keepProportions;
    const webgl = view.webgl;
    renderer.toneMapping = s.toneMapping === SAME_AS_VIEW ? webgl.toneMapping : s.toneMapping;
    renderer.toneMappingExposure = s.exposure;
    renderer.outputColorSpace = (s.colorSpace === SAME_AS_VIEW ? webgl.outputColorSpace : s.colorSpace) as THREE.ColorSpace;
    renderer.setClearColor(new THREE.Color(s.background === 'colour' ? s.backgroundColour : view.background()), 1);
    renderer.render(this.doc.scene, view.camera);
  }

  /** Called by a view when it changes size. */
  resized(viewId: string, width: number, height: number): void {
    if (this.isTracingOver(viewId) && this.renderer && width && height) this.renderer.setSize(width, height);
  }

  /** Starts the image again from the preview. */
  restart(): void {
    this.targetView()?.requestRender();
  }

  /** Stops tracing; the image keeps what has been drawn. */
  stop(): void {
    this.renderer?.stop();
  }

  /** The image as it is now, as a PNG, or `null` when there is none. */
  image(): Promise<Blob | null> {
    const canvas = this.renderer?.domElement;
    if (!canvas || !this.active()) return Promise.resolve(null);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  private ensureRenderer(canvas?: HTMLCanvasElement): RaytracingRenderer {
    if (this.renderer) return this.renderer;
    const workers = this.settings().workers;
    const renderer = new RaytracingRenderer({
      canvas,
      workerFactory: () => new Worker(new URL('./raytracer.worker', import.meta.url), { type: 'module' }),
      workers,
    });
    renderer.onProgress(progress => {
      this.updatePopupStatus(progress);
      this.progress.set(progress);
    });
    this.renderer = renderer;
    this.rendererWorkers = workers;
    return renderer;
  }

  private applyPixelRatio(devicePixelRatio: number): void {
    const ratio = this.settings().resolution * (devicePixelRatio || 1);
    if (this.renderer && this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
  }

  // ------------------------------------------------------------ over a view

  /** The canvas over a view, moved there from another view if need be. */
  private overlayFor(view: RaytraceView): HTMLCanvasElement {
    if (!this.overlay) {
      this.overlay = document.createElement('canvas');
      this.overlay.className = 'raytrace-overlay';
    }
    if (this.overlay.parentElement !== view.container) view.container.appendChild(this.overlay);
    return this.overlay;
  }

  private showOverlay(show: boolean): void {
    if (!this.overlay) return;
    this.overlay.style.display = show ? '' : 'none';
    if (!show) this.overlay.getContext('2d')?.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  // ------------------------------------------------------------ separate window

  /** Opens, or reuses, the separate window, styled like the workbench. */
  private openPopup(view: RaytraceView): boolean {
    if (this.popup && !this.popup.closed) {
      this.popup.focus();
      return true;
    }
    const { width: w, height: h } = view.size();
    const width = Math.max(360, Math.round(w || 640));
    const height = Math.max(260, Math.round(h || 480) + STATUS_HEIGHT);
    const popup = window.open('', 'gui-experimental-raytrace', `popup,width=${width},height=${height}`);
    if (!popup) return false;

    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const doc = popup.document;
    doc.title = 'Ray traced view';
    doc.body.innerHTML = '';
    Object.assign(doc.documentElement.style, { height: '100%' });
    Object.assign(doc.body.style, {
      margin: '0',
      height: '100%',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: v('--bg', '#0b1120'),
      color: v('--muted', '#94a0b4'),
      font: "12px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    });
    const canvas = doc.createElement('canvas');
    Object.assign(canvas.style, { display: 'block', flex: 'none' });
    const status = doc.createElement('div');
    Object.assign(status.style, {
      flex: 'none',
      height: `${STATUS_HEIGHT}px`,
      lineHeight: `${STATUS_HEIGHT}px`,
      padding: '0 10px',
      marginTop: 'auto',
      background: v('--surface-2', '#1b2538'),
      borderTop: `1px solid ${v('--border', '#2b3750')}`,
      boxSizing: 'border-box',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    });
    status.textContent = 'Starting…';
    doc.body.append(canvas, status);

    this.popup = popup;
    this.popupCanvas = canvas;
    this.popupStatus = status;
    popup.addEventListener('keydown', event => {
      // Z in the window goes back to the WebGL view, as in the workbench.
      if ((event.key === 'z' || event.key === 'Z') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.setMode('off');
      }
    });
    popup.addEventListener('resize', () => {
      this.fitPopup();
      this.targetView()?.requestRender();
    });
    // The user closing the window turns ray tracing off.
    popup.addEventListener('pagehide', () => {
      if (this.popup !== popup) return;
      this.popup = null;
      this.popupCanvas = this.popupStatus = null;
      if (this.mode() === 'window') this.setMode('off');
    });
    return true;
  }

  private fitPopup(): void {
    if (!this.popup || !this.renderer || this.mode() !== 'window') return;
    this.renderer.setSize(this.popup.innerWidth, Math.max(1, this.popup.innerHeight - STATUS_HEIGHT));
  }

  private closePopup(): void {
    const popup = this.popup;
    this.popup = null;
    this.popupCanvas = this.popupStatus = null;
    if (popup && !popup.closed) popup.close();
  }

  private updatePopupStatus(progress: RaytracingProgress): void {
    if (!this.popupStatus || this.mode() !== 'window') return;
    const title = this.targetView()?.title() ?? '';
    this.popupStatus.textContent = `${title} · ${describeProgress(progress)}`;
    if (this.popup) this.popup.document.title = `${progress.samples}/${progress.maxSamples} · Ray traced ${title}`;
  }
}

/** One line of progress, such as "Tracing: 12 of 64 samples, 3.4 s", or why tracing failed. */
export function describeProgress(progress: RaytracingProgress): string {
  if (progress.error) return `Ray tracing failed: ${progress.error}`;
  const state = progress.done ? 'Done' : progress.stopped ? 'Stopped' : 'Tracing';
  return `${state}: ${progress.samples} of ${progress.maxSamples} samples, ${(progress.elapsed / 1000).toFixed(1)} s`;
}

function readSettings(): RaytraceSettings {
  const defaults = defaultRaytraceSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    const merged = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof RaytraceSettings)[]) {
      if (key in saved && (typeof saved[key] === typeof defaults[key] || key === 'toneMapping')) {
        (merged as Record<string, unknown>)[key] = saved[key];
      }
    }
    merged.workers = Math.min(Math.max(1, merged.workers), MAX_WORKERS);
    return merged;
  } catch {
    return defaults;
  }
}

function writeSettings(settings: RaytraceSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not kept; the settings still apply now.
  }
}
