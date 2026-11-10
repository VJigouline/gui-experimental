import * as THREE from 'three';
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';

/**
 * Solid operations: union, subtraction and intersection of the base primitives and of other
 * solids, kept as a tree. A solid is a group whose children are its operands, in order; it draws
 * the result of the operation, worked out again whenever an operand changes, and its operands are
 * kept out of view. Operands can be solids too, so solids nest into a tree.
 *
 * For a subtraction the first operand is the one the others are taken from.
 */
export type SolidOperation = 'union' | 'subtract' | 'intersect';

export const SOLID_OPERATIONS: { op: SolidOperation; label: string; name: string; icon: string }[] = [
  { op: 'union', label: 'Union', name: 'Union', icon: '∪' },
  { op: 'subtract', label: 'Subtract', name: 'Difference', icon: '∖' },
  { op: 'intersect', label: 'Intersect', name: 'Intersection', icon: '∩' },
];

/**
 * The layer operands are moved to, so that views, picking and ray tracing, which look at layer 0,
 * leave them out. Views draw selected operands over the result as ghosts.
 */
export const OPERAND_LAYER = 2;

const CSG: Record<SolidOperation, number> = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };

/** Whether an object is a solid: a group whose children an operation combines. */
export function isSolid(o: THREE.Object3D | null | undefined): boolean {
  return !!o && !!o.userData['solid'];
}

export function solidOperation(o: THREE.Object3D): SolidOperation | null {
  const op = (o.userData['solid'] as { operation?: SolidOperation } | undefined)?.operation;
  return op && op in CSG ? op : null;
}

/** The mesh a solid draws its result with. Not an object of the document. */
export function isSolidResult(o: THREE.Object3D): boolean {
  return o.userData['solidResult'] === true;
}

export function solidResult(solid: THREE.Object3D): THREE.Mesh | undefined {
  return solid.children.find(isSolidResult) as THREE.Mesh | undefined;
}

/** The solid an object is an operand of, at any depth, or null. */
export function solidOf(o: THREE.Object3D): THREE.Object3D | null {
  for (let p = o.parent; p; p = p.parent) if (isSolid(p)) return p;
  return null;
}

/**
 * Whether an object can take part in a solid operation: a closed base primitive (box, sphere,
 * cylinder, cone, torus or knot, whole and not open-ended) or a solid.
 */
export function canBeOperand(o: THREE.Object3D): boolean {
  if (isSolid(o)) return true;
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || isSolidResult(o)) return false;
  const geo = mesh.geometry as THREE.BufferGeometry & { parameters?: Record<string, number | boolean> };
  const p = geo.parameters ?? {};
  const full = (v: unknown) => v === undefined || Math.abs((v as number) - Math.PI * 2) < 1e-9;
  switch (geo.type) {
    case 'BoxGeometry':
    case 'TorusKnotGeometry':
      return true;
    case 'SphereGeometry':
      return full(p['phiLength']) && (p['thetaLength'] === undefined || Math.abs((p['thetaLength'] as number) - Math.PI) < 1e-9);
    case 'CylinderGeometry':
    case 'ConeGeometry':
      return !p['openEnded'] && full(p['thetaLength']);
    case 'TorusGeometry':
      return full(p['arc']);
    default:
      return false;
  }
}

/** Keeps every solid's result up to date with its operands, and its operands out of view. */
export class SolidEngine {
  private readonly evaluator = new Evaluator();
  /** What each solid's result was worked out from, to work it out again only when that changes. */
  private readonly done = new WeakMap<THREE.Object3D, string>();
  /** Brushes for operand geometries, ready for the evaluator, which changes the geometry it is given. */
  private readonly brushes = new WeakMap<THREE.BufferGeometry, Brush>();
  /** Problems met, by solid, so each is reported once. */
  private readonly failed = new WeakMap<THREE.Object3D, string>();

  constructor() {
    this.evaluator.attributes = ['position', 'uv', 'normal'];
    this.evaluator.useGroups = true;
  }

  /** Brings every solid under `root` up to date. Solids inside solids are done first. */
  sync(root: THREE.Object3D): void {
    this.visit(root, false);
  }

  private visit(o: THREE.Object3D, inside: boolean): void {
    for (const child of o.children) {
      if (isSolidResult(child)) continue;
      if (isSolid(child)) {
        this.visit(child, true);
        this.update(child, inside);
      } else {
        hide(child, inside);
        this.visit(child, inside);
      }
    }
  }

  private update(solid: THREE.Object3D, inside: boolean): void {
    let result = solidResult(solid);
    if (!result) {
      result = new THREE.Mesh(new THREE.BufferGeometry(), []);
      result.name = 'Result';
      result.userData['helper'] = true;
      result.userData['solidResult'] = true;
      result.castShadow = true;
      result.receiveShadow = true;
      solid.add(result);
    }
    // A solid inside another is an operand: only the outermost result is drawn.
    if (inside) result.layers.set(OPERAND_LAYER);
    else result.layers.set(0);

    const op = solidOperation(solid) ?? 'union';
    const operands = solid.children.filter(c => !isSolidResult(c) && c.visible && canBeOperand(c) && sourceOf(c));
    const key =
      op +
      '|' +
      operands
        .map(c => {
          c.updateMatrix();
          const s = sourceOf(c)!;
          const mats = (Array.isArray(s.material) ? s.material : [s.material]).map(m => m.uuid).join('+');
          return `${c.uuid}:${s.geometry.uuid}:${mats}:${c.matrix.elements.map(v => v.toPrecision(10)).join(',')}`;
        })
        .join(';');
    if (this.done.get(solid) === key) return;
    this.done.set(solid, key);

    try {
      const { geometry, material } = this.evaluate(op, operands);
      result.geometry.dispose();
      result.geometry = geometry;
      result.material = material;
      this.failed.delete(solid);
    } catch (e) {
      // Keep the last result; say why once.
      const why = String(e);
      if (this.failed.get(solid) !== why) console.warn(`${solid.name}: the solid operation failed.`, e);
      this.failed.set(solid, why);
    }
  }

  /** The operation on the operands, in the solid's coordinates. */
  private evaluate(op: SolidOperation, operands: THREE.Object3D[]): { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] } {
    if (!operands.length) return { geometry: new THREE.BufferGeometry(), material: [] };
    const brushes = operands.map(c => {
      const s = sourceOf(c)!;
      const brush = this.brushFor(s.geometry);
      brush.material = s.material;
      c.matrix.decompose(brush.position, brush.quaternion, brush.scale);
      brush.updateMatrixWorld(true);
      return brush;
    });
    if (brushes.length === 1) {
      const geometry = brushes[0].geometry.clone().applyMatrix4(brushes[0].matrixWorld);
      return { geometry, material: brushes[0].material };
    }
    let acc: Brush = brushes[0];
    const made: Brush[] = [];
    for (const b of brushes.slice(1)) {
      acc = this.evaluator.evaluate(acc, b, CSG[op]) as Brush;
      made.push(acc);
    }
    // The result is in the first operand's coordinates: bring it into the solid's.
    const geometry = acc.geometry.applyMatrix4(acc.matrixWorld);
    for (const m of made) {
      if (m !== acc) m.geometry.dispose();
      m.disposeCacheData();
    }
    stripCaches(geometry);
    return { geometry, material: acc.material };
  }

  private brushFor(source: THREE.BufferGeometry): Brush {
    let brush = this.brushes.get(source);
    if (!brush) {
      const geometry = source.clone();
      // A primitive's groups are for one material; a solid's are for the materials of its operands.
      if (!(source.groups.length && sourceMaterialCount(source) > 1)) geometry.clearGroups();
      brush = new Brush(geometry);
      this.brushes.set(source, brush);
    }
    return brush;
  }
}

/** The mesh an operand brings: a primitive itself, or a solid's result. */
function sourceOf(o: THREE.Object3D): THREE.Mesh | null {
  if (isSolid(o)) {
    const r = solidResult(o);
    return r && r.geometry.getAttribute('position') ? r : null;
  }
  const m = o as THREE.Mesh;
  return m.isMesh ? m : null;
}

/** How many materials a geometry's groups ask for. */
function sourceMaterialCount(g: THREE.BufferGeometry): number {
  return new Set(g.groups.map(x => x.materialIndex)).size;
}

/** Puts meshes inside a solid on the operand layer, and back when they leave it. */
function hide(o: THREE.Object3D, inside: boolean): void {
  if (!(o as THREE.Mesh).isMesh) return;
  const saved = o.userData['operandLayers'] as number | undefined;
  if (inside && saved === undefined) {
    o.userData['operandLayers'] = o.layers.mask;
    o.layers.set(OPERAND_LAYER);
  } else if (!inside && saved !== undefined) {
    o.layers.mask = saved;
    delete o.userData['operandLayers'];
  }
}

/** The evaluator leaves search structures on geometries; the result doesn't need them. */
function stripCaches(g: THREE.BufferGeometry): void {
  const x = g as THREE.BufferGeometry & { boundsTree?: unknown; halfEdges?: unknown; groupIndices?: unknown };
  delete x.boundsTree;
  delete x.halfEdges;
  delete x.groupIndices;
  g.computeBoundingBox();
  g.computeBoundingSphere();
}
