import {
  ApplicationRef,
  ComponentRef,
  EnvironmentInjector,
  Injectable,
  Injector,
  createComponent,
  effect,
  inject,
  runInInjectionContext,
  untracked,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { LayoutService } from '../layout/layout.service';
import { PanelContext } from './panel-context';
import { MissingPanel } from './missing-panel';

interface HostedPanel {
  type: string;
  ref: ComponentRef<unknown>;
  context: PanelContext;
}

/**
 * Creates panel components and keeps them while their panel is in the layout.
 *
 * A panel's element is moved into whichever slot shows it, so it keeps its
 * state, a 3D view its WebGL context, when it is dragged to another stack or
 * window, or its tab is hidden. Hidden panels wait in an off-screen element.
 */
@Injectable()
export class PanelHost {
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly layoutService = inject(LayoutService);
  private readonly document = inject(DOCUMENT);
  private readonly hosted = new Map<string, HostedPanel>();
  private parking?: HTMLElement;
  private generation = this.layoutService.generation();

  constructor() {
    effect(() => {
      const layout = this.layoutService.layout();
      const generation = this.layoutService.generation();
      untracked(() => {
        if (generation !== this.generation) {
          this.generation = generation;
          this.destroyAll();
          return;
        }
        for (const [id, h] of this.hosted) {
          if (layout.panels[id]?.type !== h.type) this.destroy(id);
        }
      });
    });
  }

  /** The panel's element, made on first use. `null` if the panel is not in the layout. */
  element(panelId: string): HTMLElement | null {
    const panel = this.layoutService.layout().panels[panelId];
    if (!panel) return null;
    let h = this.hosted.get(panelId);
    if (h && h.type !== panel.type) {
      this.destroy(panelId);
      h = undefined;
    }
    if (!h) {
      h = this.create(panelId, panel.type);
      this.hosted.set(panelId, h);
    }
    return h.ref.location.nativeElement as HTMLElement;
  }

  /** Shows the panel in a container. */
  attach(panelId: string, container: HTMLElement): void {
    const el = this.element(panelId);
    if (el && el.parentElement !== container) container.appendChild(el);
  }

  /** Takes the panel out of a container, if it is still there. */
  detach(panelId: string, container: HTMLElement): void {
    const el = this.hosted.get(panelId)?.ref.location.nativeElement as HTMLElement | undefined;
    if (el && el.parentElement === container) this.park().appendChild(el);
  }

  /** The panel's component, if made. */
  instance<T>(panelId: string): T | undefined {
    return this.hosted.get(panelId)?.ref.instance as T | undefined;
  }

  get count(): number {
    return this.hosted.size;
  }

  private create(panelId: string, type: string): HostedPanel {
    const component = this.layoutService.typeOf(type)?.component ?? MissingPanel;
    const context = runInInjectionContext(this.injector, () => new PanelContext(panelId, type));
    const elementInjector = Injector.create({ providers: [{ provide: PanelContext, useValue: context }] });
    const ref = createComponent(component, { environmentInjector: this.injector, elementInjector });
    const el = ref.location.nativeElement as HTMLElement;
    el.classList.add('panel-content');
    el.dataset['panelId'] = panelId;
    this.park().appendChild(el);
    this.appRef.attachView(ref.hostView);
    return { type, ref, context };
  }

  private destroy(panelId: string): void {
    const h = this.hosted.get(panelId);
    if (!h) return;
    this.hosted.delete(panelId);
    this.appRef.detachView(h.ref.hostView);
    h.ref.destroy();
    h.context.dispose();
  }

  destroyAll(): void {
    for (const id of [...this.hosted.keys()]) this.destroy(id);
  }

  private park(): HTMLElement {
    if (!this.parking) {
      this.parking = this.document.createElement('div');
      this.parking.className = 'panel-parking';
      this.parking.setAttribute('aria-hidden', 'true');
      this.document.body.appendChild(this.parking);
    }
    return this.parking;
  }
}
