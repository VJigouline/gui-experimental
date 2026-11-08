import { Injectable, computed, signal } from '@angular/core';
import * as THREE from 'three';

/** The kinds of object the editing tools can add. */
export type PrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'knot' | 'plane' | 'group' | 'point-light';

export interface SceneTreeNode {
  id: string;
  name: string;
  /** A label for the kind of object, such as `Mesh` or `Group`. */
  kind: string;
  visible: boolean;
  children: SceneTreeNode[];
}

export interface TransformPatch {
  position?: [number, number, number];
  /** Euler angles in degrees. */
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

const PALETTE = [0x4f86f7, 0xf59e0b, 0x22c55e, 0xef4444, 0xa855f7, 0x14b8a6, 0xeab308, 0xec4899];

/**
 * The 3D scene shared by all panels. Panels change it through these methods,
 * which bump `revision` so that views redraw and lists refresh. Code that
 * changes objects directly, such as a transform gizmo, calls `touch()`.
 */
@Injectable()
export class SceneDocument {
  readonly scene = new THREE.Scene();
  /** Bumped on every change to the scene. */
  readonly revision = signal(0);
  private colorIndex = 0;
  private readonly counters = new Map<string, number>();

  /** The scene's objects as a tree, for listing. */
  readonly tree = computed<SceneTreeNode[]>(() => {
    this.revision();
    const node = (o: THREE.Object3D): SceneTreeNode => ({
      id: o.uuid,
      name: o.name || o.type,
      kind: kindOf(o),
      visible: o.visible,
      children: o.children.filter(isDocumentObject).map(node),
    });
    return this.scene.children.filter(isDocumentObject).map(node);
  });

  readonly objectCount = computed(() => {
    this.revision();
    let n = -1;
    this.scene.traverse(o => {
      if (o === this.scene || isDocumentObject(o)) n++;
    });
    return n;
  });

  constructor() {
    this.scene.name = 'Scene';
    this.reset();
  }

  /** Marks the scene changed. */
  touch(): void {
    this.revision.update(r => r + 1);
  }

  get(id: string): THREE.Object3D | undefined {
    const o = this.scene.getObjectByProperty('uuid', id);
    return o && o !== this.scene ? o : undefined;
  }

  /** The objects for ids, skipping any no longer in the scene. */
  objects(ids: readonly string[] | undefined): THREE.Object3D[] {
    return (ids ?? []).map(id => this.get(id)).filter((o): o is THREE.Object3D => !!o);
  }

  // ------------------------------------------------------------ editing

  /** Replaces the scene with the starting one: lights and a few shapes. */
  reset(): void {
    this.clear();
    const hemi = new THREE.HemisphereLight(0xdde6ff, 0x30302a, 1.2);
    hemi.name = 'Sky light';
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.name = 'Sun';
    sun.position.set(5, 9, 6);
    this.scene.add(hemi, sun);

    const assembly = new THREE.Group();
    assembly.name = 'Assembly';
    this.scene.add(assembly);
    const at = (o: THREE.Object3D, x: number, y: number, z: number) => {
      o.position.set(x, y, z);
      return o;
    };
    assembly.add(at(this.make('box'), -1.6, 0.5, 0));
    assembly.add(at(this.make('cylinder'), 0, 0.5, 0));
    assembly.add(at(this.make('sphere'), 1.6, 0.5, 0));
    this.scene.add(at(this.make('knot'), 0, 1.1, -2.2));
    this.scene.add(at(this.make('cone'), -1.8, 0.5, 2));
    this.scene.add(at(this.make('torus'), 1.8, 0.35, 2));
    this.touch();
  }

  /** Removes everything. */
  clear(): void {
    for (const o of [...this.scene.children]) {
      this.scene.remove(o);
      disposeDeep(o);
    }
    this.colorIndex = 0;
    this.counters.clear();
    this.touch();
  }

  /** Adds a new object, into a group or the scene. Returns its id. */
  add(kind: PrimitiveKind, parentId?: string): string {
    const o = this.make(kind);
    if (kind !== 'group' && kind !== 'point-light' && kind !== 'plane') o.position.y = 0.5;
    if (kind === 'point-light') o.position.set(0, 2.5, 0);
    const parent = (parentId && this.get(parentId)) || this.scene;
    parent.add(o);
    this.touch();
    return o.uuid;
  }

  /** Adds an object made elsewhere, such as an imported model. */
  addObject(object: THREE.Object3D, name?: string): string {
    if (name) object.name = name;
    this.scene.add(object);
    this.touch();
    return object.uuid;
  }

  remove(ids: readonly string[]): void {
    const objects = this.objects(ids);
    // Skip objects inside others being removed.
    for (const o of objects) {
      if (objects.some(p => p !== o && isAncestor(p, o))) continue;
      o.removeFromParent();
      disposeDeep(o);
    }
    if (objects.length) this.touch();
  }

  /** Copies objects beside the originals. Returns the copies' ids. */
  duplicate(ids: readonly string[]): string[] {
    const out: string[] = [];
    for (const o of this.objects(ids)) {
      const copy = o.clone(true);
      copy.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.geometry = m.geometry.clone();
          m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone();
        }
      });
      copy.name = this.nextName(baseName(o.name || o.type));
      copy.position.x += 0.5;
      copy.position.z += 0.5;
      (o.parent ?? this.scene).add(copy);
      out.push(copy.uuid);
    }
    if (out.length) this.touch();
    return out;
  }

  /** Puts objects in a new group, keeping where they are. Returns the group's id. */
  group(ids: readonly string[]): string | null {
    const objects = this.objects(ids);
    if (!objects.length) return null;
    const group = new THREE.Group();
    group.name = this.nextName('Group');
    const parent = objects[0].parent ?? this.scene;
    const centre = new THREE.Box3();
    objects.forEach(o => centre.expandByObject(o));
    if (!centre.isEmpty()) {
      const c = centre.getCenter(new THREE.Vector3());
      parent.worldToLocal(c);
      group.position.set(c.x, 0, c.z);
    }
    parent.add(group);
    group.updateMatrixWorld(true);
    objects.forEach(o => group.attach(o));
    this.touch();
    return group.uuid;
  }

  /** Moves a group's children to its parent and removes the group. Returns the children's ids. */
  ungroup(id: string): string[] {
    const g = this.get(id);
    if (!g || !(g instanceof THREE.Group) || !g.parent) return [];
    const parent = g.parent;
    const children = [...g.children];
    children.forEach(c => parent.attach(c));
    g.removeFromParent();
    this.touch();
    return children.map(c => c.uuid);
  }

  /** Moves an object into another, or to the top with `null`, keeping where it is. */
  reparent(id: string, parentId: string | null): boolean {
    const o = this.get(id);
    const parent = parentId ? this.get(parentId) : this.scene;
    if (!o || !parent || parent === o || isAncestor(o, parent) || o.parent === parent) return false;
    parent.attach(o);
    this.touch();
    return true;
  }

  rename(id: string, name: string): void {
    const o = this.get(id);
    if (o && name.trim() && o.name !== name.trim()) {
      o.name = name.trim();
      this.touch();
    }
  }

  setVisible(ids: readonly string[], visible: boolean): void {
    this.objects(ids).forEach(o => (o.visible = visible));
    this.touch();
  }

  setTransform(id: string, patch: TransformPatch): void {
    const o = this.get(id);
    if (!o) return;
    if (patch.position) o.position.fromArray(patch.position);
    if (patch.rotation) o.rotation.set(...(patch.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]));
    if (patch.scale) o.scale.fromArray(patch.scale.map(v => (Math.abs(v) < 1e-6 ? 1e-6 : v)));
    this.touch();
  }

  /** Changes material properties of meshes, or the colour and intensity of lights. */
  setMaterial(
    ids: readonly string[],
    patch: { color?: string; roughness?: number; metalness?: number; opacity?: number; wireframe?: boolean; intensity?: number },
  ): void {
    for (const o of this.objects(ids)) {
      const light = o as THREE.Light;
      if (light.isLight) {
        if (patch.color) light.color.set(patch.color);
        if (patch.intensity !== undefined) light.intensity = patch.intensity;
        continue;
      }
      for (const m of materialsOf(o)) {
        if (patch.color && 'color' in m) (m as THREE.MeshStandardMaterial).color.set(patch.color);
        if (m instanceof THREE.MeshStandardMaterial) {
          if (patch.roughness !== undefined) m.roughness = patch.roughness;
          if (patch.metalness !== undefined) m.metalness = patch.metalness;
        }
        if (patch.opacity !== undefined) {
          m.opacity = patch.opacity;
          m.transparent = patch.opacity < 1;
          m.depthWrite = patch.opacity >= 1;
          m.needsUpdate = true;
        }
        if (patch.wireframe !== undefined && 'wireframe' in m) {
          (m as THREE.MeshStandardMaterial).wireframe = patch.wireframe;
        }
      }
    }
    this.touch();
  }

  /** The bounding box of objects, or of the whole scene. */
  bounds(ids?: readonly string[]): THREE.Box3 {
    const box = new THREE.Box3();
    const objects = ids?.length ? this.objects(ids) : this.scene.children.filter(o => !(o as THREE.Light).isLight);
    objects.forEach(o => box.expandByObject(o));
    return box;
  }

  // ------------------------------------------------------------ making objects

  private make(kind: PrimitiveKind): THREE.Object3D {
    const material = () =>
      new THREE.MeshStandardMaterial({ color: PALETTE[this.colorIndex++ % PALETTE.length], roughness: 0.45, metalness: 0.1 });
    let o: THREE.Object3D;
    switch (kind) {
      case 'box':
        o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material());
        break;
      case 'sphere':
        o = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 24), material());
        break;
      case 'cylinder':
        o = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1, 48), material());
        break;
      case 'cone':
        o = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 48), material());
        break;
      case 'torus':
        o = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.18, 24, 64), material());
        break;
      case 'knot':
        o = new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.16, 160, 20), material());
        break;
      case 'plane': {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material());
        plane.rotation.x = -Math.PI / 2;
        (plane.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        o = plane;
        break;
      }
      case 'group':
        o = new THREE.Group();
        break;
      case 'point-light': {
        const light = new THREE.PointLight(0xffffff, 8, 0, 2);
        o = light;
        break;
      }
    }
    o.name = this.nextName(NAMES[kind]);
    return o;
  }

  private nextName(base: string): string {
    const n = (this.counters.get(base) ?? 0) + 1;
    this.counters.set(base, n);
    return `${base} ${n}`;
  }
}

const NAMES: Record<PrimitiveKind, string> = {
  box: 'Box',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  torus: 'Torus',
  knot: 'Knot',
  plane: 'Plane',
  group: 'Group',
  'point-light': 'Point light',
};

/** Objects that belong to the document, as opposed to helpers a view adds. */
export function isDocumentObject(o: THREE.Object3D): boolean {
  return !o.userData['helper'];
}

export function kindOf(o: THREE.Object3D): string {
  if ((o as THREE.Light).isLight) return 'Light';
  if ((o as THREE.Mesh).isMesh) return 'Mesh';
  if ((o as THREE.Line).isLine) return 'Line';
  if ((o as THREE.Points).isPoints) return 'Points';
  if ((o as THREE.Group).isGroup) return 'Group';
  return o.type;
}

export function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const m = (o as THREE.Mesh).material;
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

function isAncestor(a: THREE.Object3D, b: THREE.Object3D): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

function baseName(name: string): string {
  return name.replace(/\s+\d+$/, '') || name;
}

function disposeDeep(o: THREE.Object3D): void {
  o.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    materialsOf(c).forEach(x => x.dispose());
  });
}
