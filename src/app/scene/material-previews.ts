import { Injectable, signal } from '@angular/core';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { libraryEntry, makeLibraryMaterial } from './material-library';

/** The size of preview images, in pixels. */
const SIZE = 160;

/**
 * Preview images of library materials: each on a sphere over a checkered floor, lit by a room,
 * so glass, metal and textures show. They are drawn a few at a time with one small renderer,
 * which is let go when the queue is empty, and kept as image URLs.
 */
@Injectable({ providedIn: 'root' })
export class MaterialPreviews {
  /** Image URLs by library id, as they are made. */
  readonly images = signal<Record<string, string>>({});
  /** Set if previews can't be drawn, for example without WebGL. */
  readonly failed = signal(false);

  private readonly queue: string[] = [];
  private stage?: Stage;
  private frame = 0;
  private idle: ReturnType<typeof setTimeout> | undefined;

  /** Asks for previews of library entries, drawn in the order asked. */
  request(ids: readonly string[]): void {
    const done = this.images();
    for (const id of ids) if (!done[id] && !this.queue.includes(id)) this.queue.push(id);
    if (this.queue.length && !this.frame && !this.failed()) this.frame = requestAnimationFrame(() => this.pump());
  }

  private pump(): void {
    this.frame = 0;
    clearTimeout(this.idle);
    try {
      this.stage ??= new Stage();
    } catch (e) {
      console.warn('Material previews need WebGL.', e);
      this.failed.set(true);
      this.queue.length = 0;
      return;
    }
    const made: Record<string, string> = {};
    // A few each frame, so the page keeps drawing.
    for (let n = 0; n < 4 && this.queue.length; n++) {
      const id = this.queue.shift()!;
      const entry = libraryEntry(id);
      if (entry) made[id] = this.stage.draw(makeLibraryMaterial(entry));
    }
    this.images.update(all => ({ ...all, ...made }));
    if (this.queue.length) this.frame = requestAnimationFrame(() => this.pump());
    else {
      // Let the WebGL context go once nothing is waiting; browsers allow only a few.
      this.idle = setTimeout(() => {
        this.stage?.dispose();
        this.stage = undefined;
      }, 2000);
    }
  }
}

/** The scene previews are drawn in. */
class Stage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private readonly ball: THREE.Mesh;
  private readonly env: THREE.Texture;
  private readonly floorTexture: THREE.DataTexture;

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(SIZE, SIZE, false);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.background = new THREE.Color('#2a2f38');
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(2, 3, 2);
    this.scene.add(sun);
    // A checkered floor: something for glass to bend and metal to reflect.
    this.floorTexture = checker();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: this.floorTexture, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1;
    this.scene.add(floor);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshBasicMaterial());
    // Turned so wood grain and brushing run across the view.
    this.ball.rotation.set(0.3, -0.6, 0);
    this.scene.add(this.ball);
    this.camera.position.set(0, 0.9, 4.2);
    this.camera.lookAt(0, -0.1, 0);
  }

  /** A JPEG data URL of the ball in a material, which is disposed of after. */
  draw(material: THREE.Material): string {
    this.ball.material = material;
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.9);
    material.dispose();
    return url;
  }

  dispose(): void {
    this.env.dispose();
    this.floorTexture.dispose();
    this.ball.geometry.dispose();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== this.ball) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

function checker(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      const v = on ? 200 : 70;
      data.set([v, v, v, 255], (y * n + x) * 4);
    }
  }
  const t = new THREE.DataTexture(data, n, n);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
