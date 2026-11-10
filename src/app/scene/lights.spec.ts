import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { LIGHT_KINDS, SceneDocument, isLightTarget } from './scene-document';

describe('lights', () => {
  let doc: SceneDocument;
  const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(4));

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SceneDocument] });
    doc = TestBed.inject(SceneDocument);
    doc.newScene();
  });

  it('adds each kind of light three.js has', () => {
    const types = LIGHT_KINDS.map(k => doc.get(doc.add(k))!.type);
    expect(types).toEqual(['AmbientLight', 'HemisphereLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'RectAreaLight']);
    // Named for their kind, listed as lights, and their targets aren't objects of their own.
    expect(doc.tree().map(n => n.name)).toContain('Spot light 1');
    expect(doc.tree().every(n => n.kind === 'Light')).toBe(true);
    expect(doc.objectCount()).toBe(2 + LIGHT_KINDS.length);
  });

  it('aims directional and spot lights at the origin, with targets that move with them', () => {
    for (const kind of ['directional-light', 'spot-light'] as const) {
      const light = doc.get(doc.add(kind)) as THREE.SpotLight;
      light.updateMatrixWorld(true);
      expect(isLightTarget(light.target)).toBe(true);
      expect(light.target.parent).toBe(light);
      expect(world(light.target)).toEqual([0, 0, 0]);
      // Moved, it keeps shining the same way.
      doc.setTransform(light.uuid, { position: [light.position.x + 1, light.position.y, light.position.z] });
      light.updateMatrixWorld(true);
      expect(world(light.target)).toEqual([1, 0, 0]);
    }
  });

  it('changes what each kind has, within limits', () => {
    const spot = doc.add('spot-light');
    doc.setLight([spot], { color: '#ff0000', intensity: 3, distance: 10, decay: 1, angle: 20, penumbra: 0.5, castShadow: true });
    const s = doc.get(spot) as THREE.SpotLight;
    expect(s.color.getHexString()).toBe('ff0000');
    expect(s.intensity).toBe(3);
    expect(s.distance).toBe(10);
    expect(s.decay).toBe(1);
    expect(THREE.MathUtils.radToDeg(s.angle)).toBeCloseTo(20);
    expect(s.penumbra).toBe(0.5);
    expect(s.castShadow).toBe(true);
    doc.setLight([spot], { angle: 400, penumbra: 7, intensity: -2 });
    expect(THREE.MathUtils.radToDeg(s.angle)).toBeCloseTo(90);
    expect(s.penumbra).toBe(1);
    expect(s.intensity).toBe(0);

    const hemi = doc.get(doc.add('hemisphere-light')) as THREE.HemisphereLight;
    doc.setLight([hemi.uuid], { groundColor: '#00ff00' });
    expect(hemi.groundColor.getHexString()).toBe('00ff00');

    const panel = doc.get(doc.add('rect-area-light')) as THREE.RectAreaLight;
    doc.setLight([panel.uuid], { width: 2, height: 0.5 });
    expect([panel.width, panel.height]).toEqual([2, 0.5]);
  });

  it('aims a light at a point in the world', () => {
    const sun = doc.get(doc.add('directional-light')) as THREE.DirectionalLight;
    doc.setLight([sun.uuid], { target: [1, 2, 3] });
    sun.updateMatrixWorld(true);
    expect(world(sun.target)).toEqual([1, 2, 3]);
    // Not at itself.
    doc.setLight([sun.uuid], { target: world(sun) as [number, number, number] });
    expect(world(sun.target)).toEqual([1, 2, 3]);
  });

  it('fits a directional light shadow to the scene', () => {
    doc.reset();
    const sun = doc.scene.getObjectByName('Sun') as THREE.DirectionalLight;
    doc.setLight([sun.uuid], { castShadow: true });
    const cam = sun.shadow.camera;
    expect(cam.right).toBeGreaterThan(2);
    expect(sun.shadow.mapSize.x).toBe(2048);
  });

  it('copies lights with their own targets', () => {
    const spot = doc.get(doc.add('spot-light')) as THREE.SpotLight;
    const [copyId] = doc.duplicate([spot.uuid]);
    const copy = doc.get(copyId) as THREE.SpotLight;
    expect(copy.target).not.toBe(spot.target);
    expect(copy.target.parent).toBe(copy);
    expect(copy.children.filter(isLightTarget)).toHaveLength(1);
  });

  it('gives new shapes shadows', () => {
    const box = doc.get(doc.add('box'))!;
    expect(box.castShadow && box.receiveShadow).toBe(true);
  });
});
