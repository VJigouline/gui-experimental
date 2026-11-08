import { Injectable, inject, signal } from '@angular/core';
import { DropTarget, DropZone } from '../core/layout/layout.model';
import { LayoutService } from '../core/layout/layout.service';
import { stackOfPanel } from '../core/layout/layout.ops';

/** What is being dragged: an open panel, or a new panel of a type. */
export type DragSubject = { kind: 'panel'; panelId: string } | { kind: 'new'; type: string };

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DragState {
  subject: DragSubject;
  label: string;
  /** Pointer position, relative to the workspace. */
  x: number;
  y: number;
  target: DropTarget | null;
  /** Where the panel would go, relative to the workspace. */
  indicator: Rect | null;
  /** Whether the indicator is a line between tabs rather than an area. */
  tabLine: boolean;
}

/** Pointer travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** Distance from the workspace's edge that docks along the whole edge. */
const ROOT_EDGE = 18;
/** Share of a stack's width or height, from each side, that splits it. */
const EDGE_SHARE = 0.28;

/**
 * Drags panels between stacks, windows and the workspace's edges, showing
 * where they will go.
 *
 * - Over a tab strip: between tabs.
 * - Over a panel: the middle adds a tab; the sides split it.
 * - Near the workspace's edge: along the whole edge.
 * - With Ctrl held: into a new floating window.
 */
@Injectable()
export class DockDrag {
  private readonly layoutService = inject(LayoutService);
  private workspace: HTMLElement | null = null;

  readonly state = signal<DragState | null>(null);

  setWorkspace(el: HTMLElement | null): void {
    this.workspace = el;
  }

  /** Starts watching a press on a tab, which becomes a drag once the pointer moves. */
  pressPanel(event: PointerEvent, panelId: string): void {
    const title = this.layoutService.layout().panels[panelId]?.title ?? panelId;
    this.press(event, { kind: 'panel', panelId }, title);
  }

  /** Starts watching a press on a panel type in a menu, to drag a new panel into place. */
  pressNew(event: PointerEvent, type: string, onDragStart?: () => void): void {
    const title = this.layoutService.typeOf(type)?.title ?? type;
    this.press(event, { kind: 'new', type }, title, onDragStart);
  }

  private press(event: PointerEvent, subject: DragSubject, label: string, onDragStart?: () => void): void {
    if (event.button !== 0 || !this.workspace) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        onDragStart?.();
        document.body.classList.add('dock-dragging');
      }
      e.preventDefault();
      this.update(subject, label, e);
    };
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      document.body.classList.remove('dock-dragging');
      if (dragging) {
        this.update(subject, label, e);
        this.drop();
        // The click that ends a drag shouldn't also act on what is under it.
        const swallow = (c: MouseEvent) => c.stopPropagation();
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
    };
    const cancel = () => {
      dragging = false;
      this.state.set(null);
      end(new PointerEvent('pointerup'));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
  }

  private update(subject: DragSubject, label: string, e: PointerEvent): void {
    const ws = this.workspace!.getBoundingClientRect();
    const x = e.clientX - ws.left;
    const y = e.clientY - ws.top;
    const { target, indicator, tabLine } = this.hitTest(subject, e, ws);
    this.state.set({ subject, label, x, y, target, indicator, tabLine });
  }

  private hitTest(subject: DragSubject, e: PointerEvent, ws: DOMRect): Pick<DragState, 'target' | 'indicator' | 'tabLine'> {
    const none = { target: null, indicator: null, tabLine: false };
    const inside = e.clientX >= ws.left && e.clientX <= ws.right && e.clientY >= ws.top && e.clientY <= ws.bottom;
    if (!inside) return none;
    const rel = (r: DOMRect): Rect => ({ left: r.left - ws.left, top: r.top - ws.top, width: r.width, height: r.height });

    const floatTarget = () => {
      const width = 420;
      const height = 320;
      const fx = Math.min(Math.max(e.clientX - ws.left - 60, 0), Math.max(ws.width - width, 0));
      const fy = Math.min(Math.max(e.clientY - ws.top - 14, 0), Math.max(ws.height - height, 0));
      return {
        target: { kind: 'float', x: fx, y: fy, width, height } as DropTarget,
        indicator: { left: fx, top: fy, width, height },
        tabLine: false,
      };
    };
    if (e.ctrlKey) return floatTarget();

    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const stackEl = hit?.closest<HTMLElement>('[data-stack-id]');
    const inWindow = !!hit?.closest('[data-window-id]');

    // Along the workspace's edges, unless over a floating window.
    if (!inWindow) {
      const dl = e.clientX - ws.left;
      const dr = ws.right - e.clientX;
      const dt = e.clientY - ws.top;
      const db = ws.bottom - e.clientY;
      const m = Math.min(dl, dr, dt, db);
      if (m < ROOT_EDGE) {
        const zone = m === dl ? 'left' : m === dr ? 'right' : m === dt ? 'top' : 'bottom';
        const w = ws.width * 0.25;
        const h = ws.height * 0.25;
        const indicator =
          zone === 'left'
            ? { left: 0, top: 0, width: w, height: ws.height }
            : zone === 'right'
              ? { left: ws.width - w, top: 0, width: w, height: ws.height }
              : zone === 'top'
                ? { left: 0, top: 0, width: ws.width, height: h }
                : { left: 0, top: ws.height - h, width: ws.width, height: h };
        return { target: { kind: 'root', zone }, indicator, tabLine: false };
      }
    }

    if (!stackEl) return none;
    const stackId = stackEl.dataset['stackId']!;
    const layout = this.layoutService.layout();
    const own = subject.kind === 'panel' ? stackOfPanel(layout, subject.panelId) : undefined;
    const alone = own?.id === stackId && own.panels.length === 1;

    // Over the tab strip, or anywhere else in the header: between tabs.
    const header = hit?.closest<HTMLElement>('.stack-header');
    const strip = header && stackEl.contains(header) ? header.querySelector<HTMLElement>('[data-tab-strip]') : null;
    if (strip) {
      if (alone) return none;
      const tabs = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')].filter(
        t => subject.kind !== 'panel' || t.dataset['tabId'] !== subject.panelId,
      );
      let index = tabs.length;
      for (let i = 0; i < tabs.length; i++) {
        const r = tabs[i].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) {
          index = i;
          break;
        }
      }
      const sr = strip.getBoundingClientRect();
      const lineX =
        tabs.length === 0
          ? sr.left + 2
          : index < tabs.length
            ? tabs[index].getBoundingClientRect().left
            : tabs[tabs.length - 1].getBoundingClientRect().right;
      return {
        target: { kind: 'stack', stackId, zone: 'center', index },
        indicator: { left: lineX - ws.left - 1, top: sr.top - ws.top, width: 3, height: sr.height },
        tabLine: true,
      };
    }

    // Over the panel: centre or a side.
    const body = stackEl.querySelector<HTMLElement>('[data-stack-body]') ?? stackEl;
    const r = body.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const empty = stackEl.dataset['empty'] === 'true';
    let zone: DropZone = 'center';
    if (!empty) {
      const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
      const nearest = (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (d[b] < d[a] ? b : a));
      if (d[nearest] < EDGE_SHARE) zone = nearest;
    }
    if (alone) return none;
    if (own?.id === stackId && zone === 'center') return none;

    const area = rel(r);
    const indicator =
      zone === 'left'
        ? { ...area, width: area.width / 2 }
        : zone === 'right'
          ? { ...area, left: area.left + area.width / 2, width: area.width / 2 }
          : zone === 'top'
            ? { ...area, height: area.height / 2 }
            : zone === 'bottom'
              ? { ...area, top: area.top + area.height / 2, height: area.height / 2 }
              : area;
    return { target: { kind: 'stack', stackId, zone }, indicator, tabLine: false };
  }

  private drop(): void {
    const s = this.state();
    this.state.set(null);
    if (!s?.target) return;
    if (s.subject.kind === 'panel') this.layoutService.movePanel(s.subject.panelId, s.target);
    else this.layoutService.addPanel(s.subject.type, s.target);
  }
}
