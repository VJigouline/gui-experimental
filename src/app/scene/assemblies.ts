import * as THREE from 'three';
import { isSolid } from './solids';

/**
 * Assemblies: groups that stand for a product made of parts and smaller assemblies, as in CAD. An
 * assembly is a group marked with `userData.assembly`, or a STEP product with products inside it.
 * The product structure leaves out what isn't a part: lights, helpers, and the placed-instance
 * groups STEP import puts between products, which it shows through.
 */

/** What an assembly says about itself. */
export interface AssemblyInfo {
  partNumber?: string;
  description?: string;
}

export type ProductKind = 'assembly' | 'group' | 'solid' | 'part';

export interface ProductNode {
  id: string;
  name: string;
  kind: ProductKind;
  visible: boolean;
  /** Parts inside it, at any depth; 1 for a part or solid. */
  parts: number;
  partNumber: string;
  children: ProductNode[];
}

/** Whether an object is an assembly: marked as one, or a STEP product with products inside. */
export function isAssembly(o: THREE.Object3D): boolean {
  if (o.userData['assembly']) return true;
  return stepKind(o) === 'product' && o.children.some(c => stepKind(c) === 'instance' || stepKind(c) === 'product');
}

export function assemblyInfo(o: THREE.Object3D): AssemblyInfo {
  const a = o.userData['assembly'];
  if (a && typeof a === 'object') return a as AssemblyInfo;
  const step = o.userData['step'] as { productId?: string; description?: string } | undefined;
  return { partNumber: step?.productId, description: step?.description };
}

function stepKind(o: THREE.Object3D): string | undefined {
  return (o.userData['step'] as { kind?: string } | undefined)?.kind;
}

/** Objects that belong to the product structure: not lights, helpers or face loops. */
function isProductObject(o: THREE.Object3D): boolean {
  return !o.userData['helper'] && !o.userData['stepEdges'] && !(o as THREE.Light).isLight;
}

/** The parts and assemblies directly in an object, through STEP's placed instances. */
export function components(o: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const c of o.children) {
    if (!isProductObject(c)) continue;
    if (stepKind(c) === 'instance' && !isAssembly(c)) out.push(...components(c));
    else out.push(c);
  }
  return out;
}

/** The product structure under an object: its assemblies, groups and parts. */
export function productTree(root: THREE.Object3D): ProductNode[] {
  const node = (o: THREE.Object3D): ProductNode => {
    const assembly = isAssembly(o);
    // A plain group shows what is in it; a STEP part, a mesh or a solid is one part.
    const container = assembly || ((o as THREE.Group).isGroup && !isSolid(o) && stepKind(o) !== 'product');
    const children = container ? components(o).map(node) : [];
    const kind: ProductKind = assembly ? 'assembly' : isSolid(o) ? 'solid' : container ? 'group' : 'part';
    return {
      id: o.uuid,
      name: o.name || o.type,
      kind,
      visible: o.visible,
      parts: container ? children.reduce((t, c) => t + c.parts, 0) : 1,
      partNumber: assembly ? (assemblyInfo(o).partNumber ?? '') : '',
      children,
    };
  };
  return components(root).map(node);
}

/** The assemblies an object is in, the outermost first. */
export function assemblyPath(o: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (let p = o.parent; p; p = p.parent) if (isAssembly(p)) out.unshift(p);
  return out;
}

/** The assembly an object is directly in, if any. */
export function assemblyOf(o: THREE.Object3D): THREE.Object3D | null {
  for (let p = o.parent; p; p = p.parent) if (isAssembly(p)) return p;
  return null;
}

/** The smallest object that contains them all: their parents' deepest common ancestor. */
export function commonParent(objects: THREE.Object3D[], root: THREE.Object3D): THREE.Object3D {
  const chain = (o: THREE.Object3D) => {
    const out: THREE.Object3D[] = [];
    for (let p = o.parent; p; p = p.parent) out.unshift(p);
    return out;
  };
  const chains = objects.map(chain);
  let common: THREE.Object3D = root;
  for (let i = 0; ; i++) {
    const at = chains[0]?.[i];
    if (!at || chains.some(c => c[i] !== at)) break;
    common = at;
  }
  return common;
}
