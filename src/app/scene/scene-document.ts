import { Injectable, computed, signal } from '@angular/core';
import * as THREE from 'three';
import { buildGeometry, editableShape } from './primitive-edit';
import { FieldValue, MATERIAL_FIELDS, convertMaterial, isMeshMaterial, writeField } from './materials';
import { SOLID_OPERATIONS, SolidEngine, SolidOperation, canBeOperand, isSolid, isSolidResult, solidResult } from './solids';

/** The kinds of object the editing tools can add. */
export type PrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'knot' | 'plane' | 'group' | LightKind;

/** The kinds of light, as three.js has them. */
export type LightKind = 'ambient-light' | 'hemisphere-light' | 'directional-light' | 'point-light' | 'spot-light' | 'rect-area-light';

export const LIGHT_KINDS: LightKind[] = ['ambient-light', 'hemisphere-light', 'directional-light', 'point-light', 'spot-light', 'rect-area-light'];

export function isLightKind(kind: PrimitiveKind): kind is LightKind {
  return (LIGHT_KINDS as string[]).includes(kind);
}

/** Changes to a light, as the properties panel makes them. Angles in degrees; `target` in world coordinates. */
export interface LightPatch {
  color?: string;
  intensity?: number;
  groundColor?: string;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  width?: number;
  height?: number;
  castShadow?: boolean;
  target?: [number, number, number];
}

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
  /** Works out solids' results again as their operands change. */
  private readonly solids = new SolidEngine();

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

  /**
   * Lines along the boundary loops of B-rep faces and surfaces, which STEP import adds under its
   * meshes. Views show or hide them; they aren't objects of their own.
   */
  readonly faceLoops = computed<THREE.Object3D[]>(() => {
    this.revision();
    const out: THREE.Object3D[] = [];
    this.scene.traverse(o => {
      if (isFaceLoops(o)) out.push(o);
    });
    return out;
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

  /** Marks the scene changed, and brings solids up to date with their operands. */
  touch(): void {
    this.solids.sync(this.scene);
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

  /** Replaces the scene with an empty one, lit by the default lights. */
  newScene(): void {
    this.clear();
    this.addLights();
    this.touch();
  }

  /** Replaces the scene with the starting one: lights and a few shapes. */
  reset(): void {
    this.clear();
    this.addLights();

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

  private addLights(): void {
    const hemi = new THREE.HemisphereLight(0xdde6ff, 0x30302a, 1.2);
    hemi.name = 'Sky light';
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.name = 'Sun';
    sun.position.set(5, 9, 6);
    aim(sun, new THREE.Vector3(-5, -9, -6));
    this.scene.add(hemi, sun);
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
    if (kind !== 'group' && kind !== 'plane' && !isLightKind(kind)) o.position.y = 0.5;
    let parent = (parentId && this.get(parentId)) || this.scene;
    // Into a solid, only what can be an operand; anything else goes beside it.
    if (isSolid(parent) && !canBeOperand(o)) parent = parent.parent ?? this.scene;
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
      // A copied light aims with its own target, not the original's.
      copy.traverse(c => {
        const target = c.children.find(isLightTarget);
        if (target && 'target' in c) (c as THREE.DirectionalLight).target = target;
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

  /**
   * Combines objects into a solid: a union, subtraction or intersection of them, in the order
   * given; a subtraction takes the rest from the first. Only base primitives that are closed and
   * other solids can take part. Returns the solid's id, or null if fewer than two can.
   */
  combine(ids: readonly string[], operation: SolidOperation): string | null {
    const all = this.objects(ids);
    const objects = all.filter(o => canBeOperand(o) && !all.some(p => p !== o && isAncestor(p, o)));
    if (objects.length < 2) return null;
    const solid = new THREE.Group();
    solid.userData['solid'] = { operation };
    solid.name = this.nextName(SOLID_OPERATIONS.find(x => x.op === operation)!.name);
    const parent = objects[0].parent ?? this.scene;
    const box = new THREE.Box3();
    objects.forEach(o => box.expandByObject(o));
    parent.add(solid);
    if (!box.isEmpty()) {
      solid.position.copy(parent.worldToLocal(box.getCenter(new THREE.Vector3())));
    }
    solid.updateMatrixWorld(true);
    objects.forEach(o => solid.attach(o));
    this.touch();
    return solid.uuid;
  }

  /** Changes a solid's operation. */
  setOperation(id: string, operation: SolidOperation): void {
    const o = this.get(id);
    if (!o || !isSolid(o)) return;
    o.userData['solid'] = { ...(o.userData['solid'] as object), operation };
    if (/^(Union|Difference|Intersection) \d+$/.test(o.name)) {
      o.name = this.nextName(SOLID_OPERATIONS.find(x => x.op === operation)!.name);
    }
    this.touch();
  }

  /** Moves an operand earlier (-1) or later (+1) among its solid's operands, or any object among its siblings. */
  moveInOrder(id: string, delta: -1 | 1): boolean {
    const o = this.get(id);
    const parent = o?.parent;
    if (!o || !parent) return false;
    const siblings = parent.children.filter(c => !isSolidResult(c) && isDocumentObject(c));
    const i = siblings.indexOf(o);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= siblings.length) return false;
    const a = parent.children.indexOf(o);
    const b = parent.children.indexOf(siblings[j]);
    parent.children[a] = siblings[j];
    parent.children[b] = o;
    this.touch();
    return true;
  }

  /** Moves a group's children to its parent and removes the group. Returns the children's ids. */
  ungroup(id: string): string[] {
    const g = this.get(id);
    if (!g || !(g instanceof THREE.Group) || !g.parent) return [];
    // A solid's result goes with it; its operands become objects of their own again.
    const result = solidResult(g);
    if (result) {
      result.removeFromParent();
      result.geometry.dispose();
    }
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
    // Only what can be an operand goes into a solid.
    if (isSolid(parent) && !canBeOperand(o)) return false;
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

  /**
   * Changes a primitive's dimensions: replaces its geometry with one built from `params`, and
   * optionally moves it to `position`, in its parent, so that a side held still stays put.
   */
  setShape(id: string, params: Record<string, number>, position?: THREE.Vector3): void {
    const o = this.get(id) as THREE.Mesh | undefined;
    const shape = o && editableShape(o);
    if (!o || !shape) return;
    const old = o.geometry;
    o.geometry = buildGeometry(shape.kind, { ...shape.params, ...params });
    old.dispose();
    if (position) o.position.copy(position);
    this.touch();
  }

  /** Changes lights: any of their colours, intensity, reach, cone, size, shadows and aim. */
  setLight(ids: readonly string[], patch: LightPatch): void {
    for (const o of this.objects(ids)) {
      const l = o as THREE.Light & Partial<THREE.SpotLight & THREE.RectAreaLight & THREE.HemisphereLight>;
      if (!l.isLight) continue;
      const num = (v: number | undefined, min: number, max = Infinity) =>
        v === undefined || !Number.isFinite(v) ? undefined : Math.min(Math.max(v, min), max);
      if (patch.color) l.color.set(patch.color);
      if (patch.groundColor && l.groundColor) l.groundColor.set(patch.groundColor);
      const intensity = num(patch.intensity, 0);
      if (intensity !== undefined) l.intensity = intensity;
      const distance = num(patch.distance, 0);
      if (distance !== undefined && 'distance' in l) l.distance = distance;
      const decay = num(patch.decay, 0, 10);
      if (decay !== undefined && 'decay' in l) l.decay = decay;
      const angle = num(patch.angle, 0.5, 90);
      if (angle !== undefined && l.isSpotLight) l.angle = THREE.MathUtils.degToRad(angle);
      const penumbra = num(patch.penumbra, 0, 1);
      if (penumbra !== undefined && l.isSpotLight) l.penumbra = penumbra;
      const width = num(patch.width, 1e-3);
      if (width !== undefined && 'width' in l) l.width = width;
      const height = num(patch.height, 1e-3);
      if (height !== undefined && 'height' in l) l.height = height;
      if (patch.castShadow !== undefined && l.shadow) {
        l.castShadow = patch.castShadow;
        if (patch.castShadow) this.fitShadow(l as unknown as ShadowLight);
      }
      if (patch.target && patch.target.every(Number.isFinite)) this.aimAt(l, new THREE.Vector3(...patch.target));
    }
    this.touch();
  }

  /** Points a directional or spot light at a point in the world, keeping where it is. */
  aimAt(light: THREE.Object3D, world: THREE.Vector3): void {
    const l = light as THREE.DirectionalLight;
    if (!l.target) return;
    l.updateMatrixWorld(true);
    // Not onto the light itself: a light can't point at where it is.
    if (world.distanceTo(l.getWorldPosition(new THREE.Vector3())) < 1e-6) return;
    aim(l, l.worldToLocal(world.clone()));
  }

  /** Shadows sharp enough for the scene: a directional light's shadow covers what is in the scene. */
  private fitShadow(light: ShadowLight): void {
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0005;
    light.shadow.map?.dispose();
    light.shadow.map = null;
    const cam = light.shadow.camera as THREE.OrthographicCamera;
    if (!(light as THREE.DirectionalLight).isDirectionalLight || !cam.isOrthographicCamera) return;
    const box = this.bounds();
    const r = box.isEmpty() ? 5 : Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.1);
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = 0.01;
    cam.far = Math.max(r * 4, light.position.length() + r * 2);
    cam.updateProjectionMatrix();
  }

  /**
   * The meshes, or other drawn objects, whose materials editing an object's material changes: the
   * object itself, or for a solid, the shapes it is made of.
   */
  materialOwners(o: THREE.Object3D): THREE.Object3D[] {
    if (isSolid(o)) {
      const out: THREE.Object3D[] = [];
      o.traverse(c => {
        if ((c as THREE.Mesh).isMesh && !isSolidResult(c)) out.push(c);
      });
      return out;
    }
    return materialsOf(o).length ? [o] : [];
  }

  /** Sets one setting of the materials of objects, in slot `slot` where they have several. */
  setMaterialField(ids: readonly string[], key: string, value: FieldValue, slot = 0): void {
    const field = MATERIAL_FIELDS.find(f => f.key === key);
    if (!field) return;
    const done = new Set<THREE.Material>();
    for (const o of this.objects(ids)) {
      for (const owner of this.materialOwners(o)) {
        const m = materialAt(owner, slot);
        if (m && !done.has(m)) {
          writeField(m, field, value);
          done.add(m);
        }
      }
    }
    this.touch();
  }

  /**
   * Changes the type of the materials of objects, in slot `slot`, keeping the settings the types
   * share. Objects that shared a material share the new one. Returns how many were changed.
   */
  setMaterialType(ids: readonly string[], type: string, slot = 0): number {
    const made = new Map<THREE.Material, THREE.Material>();
    for (const o of this.objects(ids)) {
      for (const owner of this.materialOwners(o)) {
        const mesh = owner as THREE.Mesh;
        const old = materialAt(owner, slot);
        if (!old || old.type === type || !isMeshMaterial(old)) continue;
        let next = made.get(old);
        if (!next) {
          next = convertMaterial(old, type) ?? undefined;
          if (!next) continue;
          made.set(old, next);
        }
        if (Array.isArray(mesh.material)) mesh.material[Math.min(slot, mesh.material.length - 1)] = next;
        else mesh.material = next;
      }
    }
    // Materials nothing uses any more are let go.
    if (made.size) {
      const used = new Set<THREE.Material>();
      this.scene.traverse(c => {
        if (!isSolidResult(c)) materialsOf(c).forEach(m => used.add(m));
      });
      for (const old of made.keys()) if (!used.has(old)) old.dispose();
    }
    this.touch();
    return made.size;
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
      // A solid's material is its operands'.
      const targets: THREE.Object3D[] = [];
      if (isSolid(o)) o.traverse(c => (c as THREE.Mesh).isMesh && !isSolidResult(c) && targets.push(c));
      else targets.push(o);
      for (const m of targets.flatMap(materialsOf)) {
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
      case 'ambient-light':
        o = new THREE.AmbientLight(0xffffff, 0.4);
        break;
      case 'hemisphere-light':
        // Lit from the sky above its position, and from the ground below.
        o = new THREE.HemisphereLight(0xdde6ff, 0x30302a, 1);
        o.position.set(0, 3, 0);
        break;
      case 'directional-light':
        o = new THREE.DirectionalLight(0xffffff, 1.5);
        o.position.set(3, 5, 2);
        aim(o as THREE.DirectionalLight, new THREE.Vector3(-3, -5, -2));
        break;
      case 'point-light':
        o = new THREE.PointLight(0xffffff, 8, 0, 2);
        o.position.set(0, 2.5, 0);
        break;
      case 'spot-light':
        o = new THREE.SpotLight(0xffffff, 20, 0, Math.PI / 6, 0.25, 2);
        o.position.set(2, 3, 2);
        aim(o as THREE.SpotLight, new THREE.Vector3(-2, -3, -2));
        break;
      case 'rect-area-light': {
        // A panel facing down, lighting what is below it.
        const panel = new THREE.RectAreaLight(0xffffff, 5, 1.5, 0.75);
        panel.position.set(0, 2.5, 0);
        panel.rotation.x = -Math.PI / 2;
        o = panel;
        break;
      }
    }
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
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
  'ambient-light': 'Ambient light',
  'hemisphere-light': 'Hemisphere light',
  'directional-light': 'Directional light',
  'point-light': 'Point light',
  'spot-light': 'Spot light',
  'rect-area-light': 'Area light',
};

type ShadowLight = THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight;

/** The object a directional or spot light points at: a child of the light, so it moves and turns with it. */
export function isLightTarget(o: THREE.Object3D): boolean {
  return o.userData['lightTarget'] === true;
}

/** Points a light at a point in its own coordinates, with a target that is a child of it. */
function aim(light: THREE.DirectionalLight | THREE.SpotLight, local: THREE.Vector3): void {
  let target = light.children.find(isLightTarget);
  if (!target) {
    target = new THREE.Object3D();
    target.name = 'Target';
    target.userData['helper'] = true;
    target.userData['lightTarget'] = true;
    light.add(target);
  }
  target.position.copy(local);
  target.updateMatrixWorld(true);
  light.target = target;
}

/** Objects that belong to the document, as opposed to helpers a view adds. */
export function isDocumentObject(o: THREE.Object3D): boolean {
  return !o.userData['helper'] && !isFaceLoops(o);
}

/**
 * The three.js layer face loops are drawn on. Views enable it on their cameras to show them, and
 * picking, which looks at layer 0 only, doesn't hit them.
 */
export const FACE_LOOPS_LAYER = 1;

/** Face boundary lines from STEP import, as MeerCADStepImport marks them. */
export function isFaceLoops(o: THREE.Object3D): boolean {
  return o.userData['stepEdges'] === true;
}

export function kindOf(o: THREE.Object3D): string {
  if (isSolid(o)) return 'Solid';
  if ((o as THREE.Light).isLight) return 'Light';
  if ((o as THREE.Mesh).isMesh) return 'Mesh';
  if ((o as THREE.Line).isLine) return 'Line';
  if ((o as THREE.Points).isPoints) return 'Points';
  if ((o as THREE.Group).isGroup) return 'Group';
  return o.type;
}

/** An object's material in a slot: the one it has, or the slot's, where it has several. */
export function materialAt(o: THREE.Object3D, slot: number): THREE.Material | undefined {
  const all = materialsOf(o);
  return all[Math.min(Math.max(slot, 0), all.length - 1)];
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
