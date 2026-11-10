import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { SceneDocument } from './scene-document';
import { constrainedPoint, dimensionLines, dimensionsOf, editableShape, formatLength, pickHandle, withDimension } from './primitive-edit';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TOL = v(0.05, 0.05, 0.05);
const shapeOf = (geometry: THREE.BufferGeometry) => editableShape(new THREE.Mesh(geometry))!;

describe('primitive editing', () => {
  it('recognises the base primitives only', () => {
    expect(shapeOf(new THREE.BoxGeometry(1, 2, 3)).kind).toBe('box');
    expect(shapeOf(new THREE.ConeGeometry(0.5, 1)).kind).toBe('cone');
    expect(shapeOf(new THREE.CylinderGeometry(0.5, 0.5, 1)).kind).toBe('cylinder');
    expect(shapeOf(new THREE.TorusGeometry(0.45, 0.18)).kind).toBe('torus');
    expect(editableShape(new THREE.Mesh(new THREE.TorusKnotGeometry()))).toBeNull();
    expect(editableShape(new THREE.Group())).toBeNull();
  });

  it('drags a box face, keeping the opposite face in place', () => {
    const box = shapeOf(new THREE.BoxGeometry(1, 1, 1));
    const h = pickHandle(box, v(0.5, 0.1, 0.2), v(1, 0, 0), TOL)!;
    expect(h.feature).toBe('face');
    expect(h.dims).toEqual(['width']);
    expect(h.constraint.kind).toBe('line');
    const r = h.apply(v(0.8, 0.1, 0.2), {});
    expect(r.params['width']).toBeCloseTo(1.3);
    expect(r.params['height']).toBe(1);
    // The +X face moved 0.3 and the -X face stayed at -0.5.
    expect(r.shift.x).toBeCloseTo(0.15);
    expect(-r.params['width'] / 2 + r.shift.x).toBeCloseTo(-0.5);
  });

  it('keeps the centre with symmetric, and snaps', () => {
    const box = shapeOf(new THREE.BoxGeometry(1, 1, 1));
    const h = pickHandle(box, v(0, -0.5, 0), v(0, -1, 0), TOL)!;
    const r = h.apply(v(0, -0.7, 0), { symmetric: true });
    expect(r.params['height']).toBeCloseTo(1.4);
    expect(r.shift.y).toBe(0);
    expect(h.apply(v(0, -0.62, 0), { snap: 0.25 }).params['height']).toBeCloseTo(1);
    expect(h.apply(v(0, -0.65, 0), { snap: 0.25 }).params['height']).toBeCloseTo(1.25);
  });

  it('holds box edges and corners near them', () => {
    const box = shapeOf(new THREE.BoxGeometry(1, 1, 1));
    const edge = pickHandle(box, v(0.5, 0.49, 0), v(1, 0, 0), TOL)!;
    expect(edge.feature).toBe('edge');
    expect(edge.dims).toEqual(['width', 'height']);
    expect(edge.constraint.kind).toBe('plane');
    const corner = pickHandle(box, v(0.49, 0.49, 0.5), v(0, 0, 1), TOL)!;
    expect(corner.feature).toBe('corner');
    expect(corner.dims).toEqual(['width', 'height', 'depth']);
    const r = corner.apply(v(0.6, 0.7, 0.8), {});
    expect([r.params['width'], r.params['height'], r.params['depth']].map(x => +x.toFixed(3))).toEqual([1.11, 1.21, 1.3]);
  });

  it('never drags a size to nothing', () => {
    const box = shapeOf(new THREE.BoxGeometry(1, 1, 1));
    const h = pickHandle(box, v(0.5, 0, 0), v(1, 0, 0), TOL)!;
    expect(h.apply(v(-3, 0, 0), {}).params['width']).toBeGreaterThan(0);
  });

  it('sizes cylinders by side, cap and rim', () => {
    const cyl = shapeOf(new THREE.CylinderGeometry(0.5, 0.5, 1));
    const side = pickHandle(cyl, v(0.5, 0, 0), v(1, 0, 0), TOL)!;
    expect(side.dims).toEqual(['diameter']);
    const r = side.apply(v(0.7, 0, 0), {});
    expect(r.params['radiusTop']).toBeCloseTo(0.7);
    expect(r.params['radiusBottom']).toBeCloseTo(0.7);
    expect(r.shift.length()).toBe(0);
    const cap = pickHandle(cyl, v(0.1, 0.5, 0), v(0, 1, 0), TOL)!;
    expect(cap.dims).toEqual(['height']);
    expect(cap.apply(v(0.1, 0.9, 0), {}).params['height']).toBeCloseTo(1.4);
    const rim = pickHandle(cyl, v(0, 0.5, 0.49), v(0, 1, 0), TOL)!;
    expect(rim.feature).toBe('edge');
    expect(rim.dims).toEqual(['diameter', 'height']);
  });

  it('sizes a cone by its base and apex', () => {
    const cone = shapeOf(new THREE.ConeGeometry(0.5, 1));
    const apex = pickHandle(cone, v(0.01, 0.49, 0), v(0.9, 0.44, 0).normalize(), TOL)!;
    expect(apex.dims).toEqual(['height']);
    const r = apex.apply(v(0.01, 0.99, 0), {});
    expect(r.params['height']).toBeCloseTo(1.5);
    expect(r.shift.y).toBeCloseTo(0.25);
    // Halfway up the side, the radius there is 0.25; pulling it out 0.1 makes the base 0.2 wider.
    const side = pickHandle(cone, v(0.25, 0, 0), v(0.9, 0.44, 0).normalize(), TOL)!;
    expect(side.dims).toEqual(['diameter']);
    expect(side.apply(v(0.35, 0, 0), {}).params['radius']).toBeCloseTo(0.7);
  });

  it('sizes a sphere about its centre', () => {
    const sphere = shapeOf(new THREE.SphereGeometry(0.5));
    const h = pickHandle(sphere, v(0, 0.3, 0.4), v(0, 0.6, 0.8), TOL)!;
    const r = h.apply(v(0, 0.6, 0.8), {});
    expect(r.params['radius']).toBeCloseTo(1);
    expect(r.shift.length()).toBe(0);
  });

  it('sizes a torus by its outer and inner diameters and thickness', () => {
    const torus = shapeOf(new THREE.TorusGeometry(1, 0.2));
    const outer = pickHandle(torus, v(1.2, 0, 0), v(1, 0, 0), TOL)!;
    expect(outer.dims).toEqual(['outer']);
    let r = outer.apply(v(1.4, 0, 0), {});
    // Inner radius 0.8 stays; outer goes from 1.2 to 1.4.
    expect(r.params['radius'] - r.params['tube']).toBeCloseTo(0.8);
    expect(r.params['radius'] + r.params['tube']).toBeCloseTo(1.4);
    const inner = pickHandle(torus, v(0, -0.8, 0), v(0, 1, 0), TOL)!;
    expect(inner.dims).toEqual(['inner']);
    r = inner.apply(v(0, -0.6, 0), {});
    expect(r.params['radius'] - r.params['tube']).toBeCloseTo(0.6);
    expect(r.params['radius'] + r.params['tube']).toBeCloseTo(1.2);
    const top = pickHandle(torus, v(1, 0, 0.2), v(0, 0, 1), TOL)!;
    expect(top.dims).toEqual(['thickness']);
    r = top.apply(v(1, 0, 0.3), {});
    expect(r.params['tube']).toBeCloseTo(0.25);
    expect(r.shift.z).toBeCloseTo(0.05);
  });

  it('holds a plane only at its edges', () => {
    const plane = shapeOf(new THREE.PlaneGeometry(2, 2));
    expect(pickHandle(plane, v(0, 0, 0), v(0, 0, 1), TOL)).toBeNull();
    expect(pickHandle(plane, v(1, 0.2, 0), v(0, 0, 1), TOL)!.dims).toEqual(['width']);
    expect(pickHandle(plane, v(-0.98, 0.99, 0), v(0, 0, 1), TOL)!.feature).toBe('corner');
  });

  it('follows the pointer ray along a line or over a plane', () => {
    const box = shapeOf(new THREE.BoxGeometry(1, 1, 1));
    const face = pickHandle(box, v(0.5, 0, 0), v(1, 0, 0), TOL)!;
    // A ray looking down at x = 0.9 from above.
    const down = new THREE.Ray(v(0.9, 5, 0), v(0, -1, 0));
    expect(constrainedPoint(face, down, v(0, -1, 0))!.x).toBeCloseTo(0.9);
    const edge = pickHandle(box, v(0.5, 0.5, 0), v(1, 0, 0), TOL)!;
    const front = new THREE.Ray(v(0.8, 0.9, 5), v(0, 0, -1));
    const p = constrainedPoint(edge, front, v(0, 0, -1))!;
    expect(p.x).toBeCloseTo(0.8);
    expect(p.y).toBeCloseTo(0.9);
    expect(p.z).toBeCloseTo(0);
  });

  it('places dimension lines along the measured axis', () => {
    const box = shapeOf(new THREE.BoxGeometry(1, 2, 3));
    const [width] = dimensionLines(box, ['width'], v(1, 0, 0), v(0, 1, 0));
    expect(width).toHaveLength(4);
    for (const d of width) {
      expect(d.b.clone().sub(d.a).dot(d.axis)).toBeCloseTo(1);
      expect(d.side.dot(d.axis)).toBeCloseTo(0);
    }
    const [dia] = dimensionLines(shapeOf(new THREE.SphereGeometry(0.5)), ['diameter'], v(1, 0, 0), v(0, 1, 0));
    expect(dia[0].a.distanceTo(dia[0].b)).toBeCloseTo(1);
    expect(dia[0].prefix).toBe('Ø');
  });

  it('lists and sets dimensions for the properties panel', () => {
    const torus = shapeOf(new THREE.TorusGeometry(1, 0.2));
    expect(dimensionsOf(torus).map(d => +d.value.toFixed(3))).toEqual([2.4, 1.6, 0.4]);
    const p = withDimension(torus, 'outer', 3)!;
    expect(p['radius'] + p['tube']).toBeCloseTo(1.5);
    expect(p['radius'] - p['tube']).toBeCloseTo(0.8);
    expect(withDimension(torus, 'inner', 5)).toBeNull();
    expect(withDimension(shapeOf(new THREE.BoxGeometry()), 'width', -1)).toBeNull();
    expect(formatLength(1.23456)).toBe('1.235');
    expect(formatLength(2)).toBe('2');
  });

  it('changes a shape in the scene, keeping its segments and moving it as asked', () => {
    TestBed.configureTestingModule({ providers: [SceneDocument] });
    const doc = TestBed.inject(SceneDocument);
    const cyl = doc.scene.getObjectByName('Cylinder 1') as THREE.Mesh;
    const segments = (cyl.geometry as THREE.CylinderGeometry).parameters.radialSegments;
    const before = doc.revision();
    doc.setShape(cyl.uuid, { height: 2 }, v(0, 1, 0));
    const geo = cyl.geometry as THREE.CylinderGeometry;
    expect(geo.parameters.height).toBe(2);
    expect(geo.parameters.radialSegments).toBe(segments);
    expect(cyl.position.y).toBe(1);
    expect(doc.revision()).toBeGreaterThan(before);
    // Duplicates keep the new sizes.
    const [copy] = doc.duplicate([cyl.uuid]);
    expect((doc.get(copy) as THREE.Mesh).geometry.type).toBe('CylinderGeometry');
    expect(editableShape(doc.get(copy)!)!.params['height']).toBe(2);
  });
});
