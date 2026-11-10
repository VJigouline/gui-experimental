import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { SceneDocument } from './scene-document';
import { OPERAND_LAYER, canBeOperand, isSolid, solidOperation, solidResult } from './solids';

describe('solid operations', () => {
  let doc: SceneDocument;
  const byName = (name: string) => doc.scene.getObjectByName(name)!;
  const resultBox = (id: string) => {
    const r = solidResult(doc.get(id)!)!;
    r.updateWorldMatrix(true, false);
    return new THREE.Box3().setFromObject(r);
  };
  /** Where a ray from +X along y = 0.5, z = 0 first meets the solid's result. */
  const hitX = (id: string, y = 0.5, z = 0) => {
    const r = solidResult(doc.get(id)!)!;
    r.updateWorldMatrix(true, false);
    const ray = new THREE.Raycaster(new THREE.Vector3(5, y, z), new THREE.Vector3(-1, 0, 0));
    r.material = Array.isArray(r.material) ? r.material : [r.material];
    return ray.intersectObject(r)[0]?.point.x ?? null;
  };
  const near = (a: THREE.Vector3, b: [number, number, number]) => a.toArray().forEach((v, i) => expect(v).toBeCloseTo(b[i], 3));

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SceneDocument] });
    doc = TestBed.inject(SceneDocument);
    doc.newScene();
  });

  /** A box and a sphere overlapping by half: box 0..1 on X, sphere centred at x = 1. */
  function boxAndSphere(): [string, string] {
    const box = doc.add('box');
    const sphere = doc.add('sphere');
    doc.setTransform(box, { position: [0.5, 0.5, 0] });
    doc.setTransform(sphere, { position: [1, 0.5, 0] });
    return [box, sphere];
  }

  it('takes closed primitives and solids, not planes, groups or lights', () => {
    const ok = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'knot'] as const;
    for (const k of ok) expect(canBeOperand(doc.get(doc.add(k))!)).toBe(true);
    for (const k of ['plane', 'group', 'point-light'] as const) expect(canBeOperand(doc.get(doc.add(k))!)).toBe(false);
  });

  it('unites, subtracts and intersects', () => {
    const [box, sphere] = boxAndSphere();
    const id = doc.combine([box, sphere], 'union')!;
    const solid = doc.get(id)!;
    expect(isSolid(solid)).toBe(true);
    expect(solid.name).toBe('Union 1');
    // The union reaches from the box's left face to the sphere's right side.
    let b = resultBox(id);
    near(b.min, [0, 0, -0.5]);
    near(b.max, [1.5, 1, 0.5]);

    expect(hitX(id)).toBeCloseTo(1.5, 2);

    doc.setOperation(id, 'subtract');
    expect(solid.name).toBe('Difference 1');
    // The box's corners are left; through the middle, the sphere has cut it back to x = 0.5.
    near(resultBox(id).min, [0, 0, -0.5]);
    expect(hitX(id)).toBeCloseTo(0.5, 2);
    expect(hitX(id, 0.02, 0.48)).toBeCloseTo(1, 3);

    doc.setOperation(id, 'intersect');
    b = resultBox(id);
    expect(b.min.x).toBeCloseTo(0.5, 2);
    expect(b.max.x).toBeCloseTo(1, 3);
    expect(hitX(id)).toBeCloseTo(1, 3);
    expect(solidOperation(solid)).toBe('intersect');
  });

  it('keeps operands out of view and the solid in the tree', () => {
    const [box, sphere] = boxAndSphere();
    const id = doc.combine([box, sphere], 'subtract')!;
    const boxMesh = doc.get(box)!;
    expect(boxMesh.layers.mask).toBe(1 << OPERAND_LAYER);
    expect(solidResult(doc.get(id)!)!.layers.isEnabled(0)).toBe(true);
    const node = doc.tree().find(n => n.id === id)!;
    expect(node.kind).toBe('Solid');
    // The result isn't an object of its own.
    expect(node.children.map(c => c.id)).toEqual([box, sphere]);
    expect(doc.objectCount()).toBe(2 + 3);
  });

  it('follows its operands as they change', () => {
    const [box, sphere] = boxAndSphere();
    const id = doc.combine([box, sphere], 'union')!;
    const before = solidResult(doc.get(id)!)!.geometry;
    // Move the sphere further out, in the solid's coordinates.
    const s = doc.get(sphere)!;
    doc.setTransform(sphere, { position: [s.position.x + 1, s.position.y, s.position.z] });
    expect(solidResult(doc.get(id)!)!.geometry).not.toBe(before);
    expect(resultBox(id).max.x).toBeCloseTo(2.5, 3);
    // Sized, as by dragging.
    doc.setShape(box, { width: 3 });
    expect(resultBox(id).min.x).toBeCloseTo(-1, 3);
    // Hidden operands are left out.
    doc.setVisible([sphere], false);
    expect(resultBox(id).max.x).toBeCloseTo(2, 3);
  });

  it('nests solids into a tree', () => {
    const [box, sphere] = boxAndSphere();
    const cut = doc.combine([box, sphere], 'subtract')!;
    const cyl = doc.add('cylinder');
    doc.setTransform(cyl, { position: [0.25, 1.5, 0] });
    const top = doc.combine([cut, cyl], 'union')!;
    expect(doc.get(cut)!.parent).toBe(doc.get(top));
    // The inner result is an operand now: out of view; the outer one is drawn.
    expect(solidResult(doc.get(cut)!)!.layers.isEnabled(0)).toBe(false);
    const b = resultBox(top);
    expect(b.max.y).toBeCloseTo(2, 3);
    expect(hitX(top)).toBeCloseTo(0.5, 2);
    expect(hitX(top, 1.5)).toBeCloseTo(0.7, 2);
  });

  it('orders operands, and subtracts from the first', () => {
    const [box, sphere] = boxAndSphere();
    const id = doc.combine([box, sphere], 'subtract')!;
    expect(doc.moveInOrder(sphere, -1)).toBe(true);
    expect(doc.get(id)!.children.filter(c => !c.userData['helper']).map(c => c.uuid)).toEqual([sphere, box]);
    // Now the sphere, less the box: its right half.
    expect(resultBox(id).min.x).toBeCloseTo(1, 2);
    expect(resultBox(id).max.x).toBeCloseTo(1.5, 3);
  });

  it('gives the operands back when ungrouped, where they were', () => {
    const [box, sphere] = boxAndSphere();
    const id = doc.combine([box, sphere], 'union')!;
    const ids = doc.ungroup(id);
    expect(ids.sort()).toEqual([box, sphere].sort());
    expect(doc.get(id)).toBeUndefined();
    const b = doc.get(box)!;
    expect(b.parent).toBe(doc.scene);
    expect(b.layers.isEnabled(0)).toBe(true);
    near(b.getWorldPosition(new THREE.Vector3()), [0.5, 0.5, 0]);
    expect(doc.scene.children.some(c => c.userData['solidResult'])).toBe(false);
  });

  it('refuses what cannot be an operand', () => {
    const box = doc.add('box');
    const plane = doc.add('plane');
    expect(doc.combine([box, plane], 'union')).toBeNull();
    const sphere = doc.add('sphere');
    const id = doc.combine([box, sphere], 'union')!;
    expect(doc.reparent(plane, id)).toBe(false);
    // Added into a solid: shapes join it; a light goes beside it.
    const cone = doc.add('cone', id);
    expect(doc.get(cone)!.parent!.uuid).toBe(id);
    const light = doc.add('point-light', id);
    expect(doc.get(light)!.parent).toBe(doc.scene);
  });

  it('duplicates a solid with its own result', () => {
    const [box, sphere] = boxAndSphere();
    const id = doc.combine([box, sphere], 'subtract')!;
    const [copy] = doc.duplicate([id]);
    const a = solidResult(doc.get(id)!)!;
    const c = solidResult(doc.get(copy)!)!;
    expect(c).not.toBe(a);
    expect(doc.get(copy)!.children.filter(x => x.userData['solidResult'])).toHaveLength(1);
    // The copy's result is made from the copy's operands.
    const copyBox = doc.get(copy)!.children.find(x => x.name === byName(doc.get(box)!.name).name && x !== doc.get(box))!;
    doc.setShape(copyBox.uuid, { height: 3 });
    expect(new THREE.Box3().setFromObject(c).max.y - new THREE.Box3().setFromObject(c).min.y).toBeCloseTo(3, 3);
    expect(resultBox(id).max.y - resultBox(id).min.y).toBeCloseTo(1, 3);
  });
});
