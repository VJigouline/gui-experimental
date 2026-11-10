import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { raytrace } from 'meercad-raytracer';
import { SceneDocument } from '../scene/scene-document';
import { ENVIRONMENTS, builtInEnvironment } from './environments';
import { RaytraceService, SETTINGS_KEY } from './raytrace.service';

/** The radiance an equirectangular data texture holds towards a direction, as three.js samples it. */
function sample(t: THREE.DataTexture, d: THREE.Vector3): number[] {
  const { width, height, data } = t.image as { width: number; height: number; data: Float32Array };
  const u = Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5;
  const v = Math.asin(Math.min(Math.max(d.y, -1), 1)) / Math.PI + 0.5;
  const x = Math.min(width - 1, Math.floor(u * width));
  const y = Math.min(height - 1, Math.floor(v * height));
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}
const luma = (c: ArrayLike<number>) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('ray tracing environments', () => {
  it('makes each built-in one as an equirectangular HDR image the tracer can read', () => {
    for (const e of ENVIRONMENTS.filter(x => x.kind !== 'none' && x.kind !== 'file')) {
      const t = builtInEnvironment(e.kind)!;
      expect(t.mapping).toBe(THREE.EquirectangularReflectionMapping);
      expect(t.type).toBe(THREE.FloatType);
      expect((t.image as { data: Float32Array }).data).toBeInstanceOf(Float32Array);
      expect(builtInEnvironment(e.kind)).toBe(t);
    }
    expect(builtInEnvironment('none')).toBeNull();
    expect(builtInEnvironment('file')).toBeNull();
  });

  it('has the sky above and the ground below, and the sun far brighter than the sky', () => {
    const sky = builtInEnvironment('sky')!;
    const up = sample(sky, new THREE.Vector3(0, 1, 0));
    const down = sample(sky, new THREE.Vector3(0, -1, 0));
    expect(up[2]).toBeGreaterThan(up[0]);
    expect(luma(up)).toBeGreaterThan(luma(down));
    const a = THREE.MathUtils.degToRad(60);
    const e = THREE.MathUtils.degToRad(42);
    const sun = sample(sky, new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)));
    expect(luma(sun)).toBeGreaterThan(20 * luma(up));
  });

  describe('in the ray tracer', () => {
    let rt: RaytraceService;
    let doc: SceneDocument;
    beforeEach(() => {
      localStorage.clear();
      TestBed.configureTestingModule({ providers: [RaytraceService, SceneDocument] });
      rt = TestBed.inject(RaytraceService);
      doc = TestBed.inject(SceneDocument);
    });
    const traced = () => (rt as unknown as { tracedScene(): THREE.Scene }).tracedScene();

    it('traces a scene with the environment around it, leaving the document’s scene alone', () => {
      expect(rt.settings().environment).toBe('studio');
      const scene = traced();
      expect(scene).not.toBe(doc.scene);
      expect(scene.environment).toBe(builtInEnvironment('studio'));
      expect(scene.environmentIntensity).toBe(0.5);
      expect(scene.background).toBeNull();
      expect(doc.scene.environment).toBeNull();
      // The same objects.
      expect(scene.children).toBe(doc.scene.children);

      rt.updateSettings({ environment: 'sky', environmentIntensity: 2, environmentRotation: 90, environmentBackground: true });
      const sky = traced();
      expect(sky.background).toBe(builtInEnvironment('sky'));
      expect(sky.backgroundIntensity).toBe(2);
      expect(sky.environmentRotation.y).toBeCloseTo(Math.PI / 2);

      rt.updateSettings({ environment: 'none' });
      expect(traced()).toBe(doc.scene);
      // A file isn't loaded: nothing around.
      rt.updateSettings({ environment: 'file' });
      expect(traced()).toBe(doc.scene);
    });

    it('doesn’t come back to a file on the next visit', () => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ environment: 'file' }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [RaytraceService, SceneDocument] });
      expect(TestBed.inject(RaytraceService).settings().environment).toBe('studio');
    });

    it('shows in reflections: a mirror ball is bright with an environment, dark without', () => {
      doc.newScene();
      doc.scene.children.filter(c => (c as THREE.Light).isLight).forEach(l => (l.visible = false));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0, color: 0xffffff }));
      doc.addObject(ball);
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const centre = (scene: THREE.Scene) => {
        const img = raytrace(scene, camera, 8, 8, { samples: 1, maxBounces: 2 });
        return luma([img.data[(4 * 8 + 4) * 4], img.data[(4 * 8 + 4) * 4 + 1], img.data[(4 * 8 + 4) * 4 + 2]]);
      };
      rt.updateSettings({ environment: 'none' });
      const dark = centre(traced());
      rt.updateSettings({ environment: 'studio', environmentIntensity: 1 });
      const lit = centre(traced());
      expect(lit).toBeGreaterThan(dark + 20);
    });
  });
});
