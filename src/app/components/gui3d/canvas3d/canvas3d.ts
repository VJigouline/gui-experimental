import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { Scene, PerspectiveCamera, WebGLRenderer, Color, BoxGeometry, MeshBasicMaterial, Mesh, AmbientLight, DirectionalLight } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Component({
  selector: 'app-canvas3d',
  imports: [],
  templateUrl: './canvas3d.html',
  styleUrls: ['./canvas3d.scss'],
})
export class Canvas3d implements AfterViewInit, OnDestroy {
  @ViewChild('canvasContainer', { static: true }) private containerRef!: ElementRef<HTMLDivElement>;

  private renderer?: WebGLRenderer;
  private scene?: Scene;
  private camera?: PerspectiveCamera;
  private controls?: OrbitControls;
  private rafId?: number;

  ngAfterViewInit(): void {
    const container = this.containerRef.nativeElement;

    // Renderer
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.setClearColor(new Color(0x000000));
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new Scene();

    // Camera
    this.camera = new PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 2000);
    this.camera.position.set(2, 2, 3);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Lights
    const ambient = new AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dir = new DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7.5);
    this.scene.add(dir);

    // Simple geometry
    const geo = new BoxGeometry(1, 1, 1);
    const mat = new MeshBasicMaterial({ color: 0x44aa88 });
    const mesh = new Mesh(geo, mat);
    this.scene.add(mesh);

    // Start loop
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      mesh.rotation.x += 0.005;
      mesh.rotation.y += 0.01;
      this.controls && this.controls.update();
      this.renderer && this.renderer.render(this.scene!, this.camera!);
    };
    loop();

    // Handle resize
    window.addEventListener('resize', this.onWindowResize);
  }

  private onWindowResize = () => {
    const container = this.containerRef.nativeElement;
    if (!this.camera || !this.renderer) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onWindowResize);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.controls && this.controls.dispose();
    this.renderer && this.renderer.dispose();
    // remove canvas
    if (this.containerRef && this.containerRef.nativeElement && this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.parentNode && canvas.parentNode.removeChild(canvas);
    }
  }
}
