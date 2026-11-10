import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { ProductNode, assemblyOf, assemblyPath, isAssembly, productTree } from './assemblies';
import { SceneDocument, kindOf } from './scene-document';

describe('assemblies', () => {
  let doc: SceneDocument;
  const byName = (n: string) => doc.scene.getObjectByName(n)!;
  const names = (nodes: ProductNode[]): unknown[] => nodes.map(n => (n.children.length ? { [n.name]: names(n.children) } : n.name));
  const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(4));

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SceneDocument] });
    doc = TestBed.inject(SceneDocument);
  });

  it('shows the starting scene as a product structure, without lights', () => {
    const tree = productTree(doc.scene);
    expect(names(tree)).toEqual([{ Assembly: ['Box 1', 'Cylinder 1', 'Sphere 1'] }, 'Knot 1', 'Cone 1', 'Torus 1']);
    expect(tree[0].kind).toBe('assembly');
    expect(tree[0].parts).toBe(3);
    expect(kindOf(byName('Assembly'))).toBe('Assembly');
  });

  it('makes an assembly of items, keeping where they are', () => {
    const knot = byName('Knot 1');
    const cone = byName('Cone 1');
    const before = [world(knot), world(cone)];
    const id = doc.makeAssembly([knot.uuid, cone.uuid])!;
    const a = doc.get(id)!;
    expect(isAssembly(a)).toBe(true);
    expect(a.name).toBe('Assembly 1');
    expect(a.parent).toBe(doc.scene);
    expect([world(knot), world(cone)]).toEqual(before);
    expect(assemblyOf(knot)).toBe(a);
    // Its origin is at the middle of their base.
    const box = new THREE.Box3().setFromObject(a);
    expect(a.position.y).toBeCloseTo(box.min.y, 4);
  });

  it('makes a subassembly inside the assembly that holds the items', () => {
    const box = byName('Box 1');
    const cyl = byName('Cylinder 1');
    const id = doc.makeAssembly([box.uuid, cyl.uuid])!;
    const sub = doc.get(id)!;
    expect(sub.name).toBe('Subassembly 1');
    expect(sub.parent).toBe(byName('Assembly'));
    expect(assemblyPath(box).map(a => a.name)).toEqual(['Assembly', 'Subassembly 1']);
    const tree = productTree(doc.scene);
    expect(names(tree)[0]).toEqual({ Assembly: ['Sphere 1', { 'Subassembly 1': ['Box 1', 'Cylinder 1'] }] });
    expect(tree[0].parts).toBe(3);
  });

  it('takes items from different places into the assembly that holds them all', () => {
    const box = byName('Box 1');
    const knot = byName('Knot 1');
    const id = doc.makeAssembly([box.uuid, knot.uuid])!;
    expect(doc.get(id)!.parent).toBe(doc.scene);
    expect(doc.get(id)!.name).toBe('Assembly 1');
  });

  it('leaves out lights and items inside others selected with them', () => {
    const sun = byName('Sun');
    const assembly = byName('Assembly');
    const id = doc.makeAssembly([sun.uuid, assembly.uuid, byName('Box 1').uuid])!;
    expect(doc.get(id)!.children.filter(c => !c.userData['helper'])).toEqual([assembly]);
    expect(sun.parent).toBe(doc.scene);
    expect(doc.makeAssembly([sun.uuid])).toBeNull();
  });

  it('keeps a part number and description, and dissolves', () => {
    const a = byName('Assembly');
    doc.setAssemblyInfo(a.uuid, { partNumber: ' A-100 ', description: 'Base unit' });
    expect(a.userData['assembly']).toEqual({ partNumber: 'A-100', description: 'Base unit' });
    expect(productTree(doc.scene)[0].partNumber).toBe('A-100');
    doc.setAssemblyInfo(a.uuid, { description: '' });
    expect(a.userData['assembly']).toEqual({ partNumber: 'A-100' });
    const items = doc.ungroup(a.uuid);
    expect(items).toHaveLength(3);
    expect(byName('Box 1').parent).toBe(doc.scene);
  });

  it('reads STEP products with products in them as assemblies, through their instances', () => {
    const product = (name: string) => {
      const g = new THREE.Group();
      g.name = name;
      g.userData['step'] = { kind: 'product', productId: `${name}-PN` };
      return g;
    };
    const instance = (child: THREE.Object3D) => {
      const g = new THREE.Group();
      g.userData['step'] = { kind: 'instance' };
      g.add(child);
      return g;
    };
    const top = product('Car');
    const wheel = product('Wheel');
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.userData['step'] = { kind: 'shape' };
    wheel.add(mesh);
    top.add(instance(wheel), instance(product('Body')));
    doc.addObject(top);
    const node = productTree(doc.scene).find(n => n.name === 'Car')!;
    expect(node.kind).toBe('assembly');
    expect(node.partNumber).toBe('Car-PN');
    expect(node.children.map(c => [c.name, c.kind])).toEqual([
      ['Wheel', 'part'],
      ['Body', 'part'],
    ]);
    expect(isAssembly(wheel)).toBe(false);
    expect(assemblyOf(wheel)).toBe(top);
  });
});
