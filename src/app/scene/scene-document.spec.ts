import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { SceneDocument } from './scene-document';

describe('SceneDocument', () => {
  let doc: SceneDocument;
  const names = () => doc.tree().map(n => n.name);
  const id = (name: string) => doc.scene.getObjectByName(name)!.uuid;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SceneDocument] });
    doc = TestBed.inject(SceneDocument);
  });

  it('starts with lights and shapes', () => {
    expect(names()).toEqual(['Sky light', 'Sun', 'Assembly', 'Knot 1', 'Cone 1', 'Torus 1']);
    expect(doc.tree()[2].children.map(c => c.name)).toEqual(['Box 1', 'Cylinder 1', 'Sphere 1']);
    expect(doc.objectCount()).toBe(9);
  });

  it('adds objects, into a group when given, and bumps the revision', () => {
    const r = doc.revision();
    const box = doc.add('box', id('Assembly'));
    expect(doc.revision()).toBeGreaterThan(r);
    expect(doc.get(box)!.parent!.name).toBe('Assembly');
    expect(doc.get(box)!.name).toBe('Box 2');
  });

  it('removes objects, skipping those inside others removed', () => {
    doc.remove([id('Assembly'), id('Box 1'), 'missing']);
    expect(names()).not.toContain('Assembly');
    expect(doc.objectCount()).toBe(5);
  });

  it('duplicates with separate geometry and materials', () => {
    const [copy] = doc.duplicate([id('Box 1')]);
    const a = doc.scene.getObjectByName('Box 1') as THREE.Mesh;
    const b = doc.get(copy) as THREE.Mesh;
    expect(b.name).toBe('Box 2');
    expect(b.parent).toBe(a.parent);
    expect(b.geometry).not.toBe(a.geometry);
    expect(b.material).not.toBe(a.material);
    expect(b.position.x).toBeCloseTo(a.position.x + 0.5);
  });

  it('groups objects keeping their world positions, and ungroups them', () => {
    const knot = doc.scene.getObjectByName('Knot 1')!;
    const before = knot.getWorldPosition(new THREE.Vector3());
    const g = doc.group([id('Knot 1'), id('Cone 1')])!;
    expect(doc.get(g)!.children.map(c => c.name)).toEqual(['Knot 1', 'Cone 1']);
    doc.scene.updateMatrixWorld(true);
    expect(knot.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-9);

    const ids = doc.ungroup(g);
    expect(ids).toHaveLength(2);
    expect(doc.get(g)).toBeUndefined();
    doc.scene.updateMatrixWorld(true);
    expect(knot.parent).toBe(doc.scene);
    expect(knot.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-9);
  });

  it('reparents, refusing to put an object inside itself', () => {
    expect(doc.reparent(id('Torus 1'), id('Assembly'))).toBe(true);
    expect(doc.scene.getObjectByName('Torus 1')!.parent!.name).toBe('Assembly');
    expect(doc.reparent(id('Assembly'), id('Torus 1'))).toBe(false);
    expect(doc.reparent(id('Torus 1'), null)).toBe(true);
    expect(doc.scene.getObjectByName('Torus 1')!.parent).toBe(doc.scene);
  });

  it('sets transforms in degrees, and materials', () => {
    const box = id('Box 1');
    doc.setTransform(box, { position: [1, 2, 3], rotation: [90, 0, 0], scale: [2, 0, 1] });
    const o = doc.get(box) as THREE.Mesh;
    expect(o.position.toArray()).toEqual([1, 2, 3]);
    expect(o.rotation.x).toBeCloseTo(Math.PI / 2);
    expect(o.scale.y).toBeGreaterThan(0);

    doc.setMaterial([box], { color: '#ff0000', opacity: 0.5, wireframe: true });
    const m = o.material as THREE.MeshStandardMaterial;
    expect(m.color.getHexString()).toBe('ff0000');
    expect(m.transparent).toBe(true);
    expect(m.wireframe).toBe(true);

    doc.setMaterial([id('Sun')], { intensity: 5 });
    expect((doc.scene.getObjectByName('Sun') as THREE.Light).intensity).toBe(5);
  });

  it('measures bounds of objects or the whole scene', () => {
    const b = doc.bounds([id('Box 1')]);
    expect(b.getSize(new THREE.Vector3()).toArray().map(v => Math.round(v))).toEqual([1, 1, 1]);
    expect(doc.bounds().isEmpty()).toBe(false);
  });

  it('resets to the starting scene', () => {
    doc.add('torus');
    doc.reset();
    expect(names()).toEqual(['Sky light', 'Sun', 'Assembly', 'Knot 1', 'Cone 1', 'Torus 1']);
  });
});
