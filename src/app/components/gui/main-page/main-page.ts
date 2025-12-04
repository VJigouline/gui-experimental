import { Component, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-main-page',
  imports: [],
  templateUrl: './main-page.html',
  styleUrls: ['./main-page.scss'],
})
export class MainPage implements AfterViewInit, OnDestroy {
  private leftResizer: HTMLElement | null = null;
  private rightResizer: HTMLElement | null = null;
  private onPointerMoveLeft: (e: PointerEvent) => void = () => {};
  private onPointerUpLeft: (e: PointerEvent) => void = () => {};
  private onPointerMoveRight: (e: PointerEvent) => void = () => {};
  private onPointerUpRight: (e: PointerEvent) => void = () => {};
  private startX = 0;
  private startLeftWidth = 250;
  private startRightWidth = 300;

  constructor(private host: ElementRef) {}

  ngAfterViewInit(): void {
    const root = this.host.nativeElement as HTMLElement;
    this.leftResizer = root.querySelector('.resizer-left');
    this.rightResizer = root.querySelector('.resizer-right');

    if (this.leftResizer) {
      this.leftResizer.addEventListener('pointerdown', this.startLeftDrag);
    }
    if (this.rightResizer) {
      this.rightResizer.addEventListener('pointerdown', this.startRightDrag);
    }
  }

  ngOnDestroy(): void {
    if (this.leftResizer) {
      this.leftResizer.removeEventListener('pointerdown', this.startLeftDrag);
    }
    if (this.rightResizer) {
      this.rightResizer.removeEventListener('pointerdown', this.startRightDrag);
    }
    document.removeEventListener('pointermove', this.onPointerMoveLeft as any);
    document.removeEventListener('pointerup', this.onPointerUpLeft as any);
    document.removeEventListener('pointermove', this.onPointerMoveRight as any);
    document.removeEventListener('pointerup', this.onPointerUpRight as any);
  }

  private startLeftDrag = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    this.startX = e.clientX;
    const rootStyle = getComputedStyle(document.documentElement);
    this.startLeftWidth = parseInt(rootStyle.getPropertyValue('--sidebar-width')) || 250;

    this.onPointerMoveLeft = (ev: PointerEvent) => {
      const delta = ev.clientX - this.startX;
      const newW = Math.max(100, this.startLeftWidth + delta);
      document.documentElement.style.setProperty('--sidebar-width', `${newW}px`);
    };

    this.onPointerUpLeft = (ev: PointerEvent) => {
      try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
      document.removeEventListener('pointermove', this.onPointerMoveLeft as any);
      document.removeEventListener('pointerup', this.onPointerUpLeft as any);
    };

    document.addEventListener('pointermove', this.onPointerMoveLeft as any);
    document.addEventListener('pointerup', this.onPointerUpLeft as any);
  };

  private startRightDrag = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    this.startX = e.clientX;
    const rootStyle = getComputedStyle(document.documentElement);
    this.startRightWidth = parseInt(rootStyle.getPropertyValue('--right-sidebar-width')) || 300;

    this.onPointerMoveRight = (ev: PointerEvent) => {
      const delta = this.startX - ev.clientX; // reverse direction
      const newW = Math.max(100, this.startRightWidth + delta);
      document.documentElement.style.setProperty('--right-sidebar-width', `${newW}px`);
    };

    this.onPointerUpRight = (ev: PointerEvent) => {
      try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
      document.removeEventListener('pointermove', this.onPointerMoveRight as any);
      document.removeEventListener('pointerup', this.onPointerUpRight as any);
    };

    document.addEventListener('pointermove', this.onPointerMoveRight as any);
    document.addEventListener('pointerup', this.onPointerUpRight as any);
  };
}
