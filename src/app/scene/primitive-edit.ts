import * as THREE from 'three';

/**
 * Dynamic editing of the base primitives: which feature of a shape the pointer holds, how its
 * dimensions follow the pointer, and the dimension lines that show them. Everything here is in the
 * object's local coordinates; the 3D view turns pointer rays into local points and draws the lines.
 *
 * - **Box:** a face changes one size, an edge two, a corner three. The opposite side stays put.
 * - **Cylinder and cone:** the side changes the diameter, about the axis; a cap or the apex changes
 *   the height, with the other end staying put; a rim changes both.
 * - **Sphere:** anywhere changes the diameter, about the centre.
 * - **Torus:** the outside changes the outer diameter and the inside the inner one, the other staying
 *   put; the top or bottom changes the thickness.
 * - **Plane:** an edge changes its width or length, a corner both.
 *
 * Holding Ctrl (`symmetric`) keeps the centre in place instead of the opposite side.
 */

export type EditableKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';

export interface EditableShape {
  kind: EditableKind;
  /** The geometry's parameters, as three.js keeps them. */
  params: Record<string, number>;
}

/** What the held point may do as the pointer moves: slide along a line, over a plane, or freely. */
export type Constraint =
  | { kind: 'line'; dir: THREE.Vector3 }
  | { kind: 'plane'; normal: THREE.Vector3 }
  /** Over the plane facing the camera. */
  | { kind: 'view' }
  /**
   * Over the plane through the centre that faces the camera, or the plane through the `axis` that
   * faces it most, for sizes measured out from a centre or an axis.
   */
  | { kind: 'radial'; axis: THREE.Vector3 | null };

export interface EditResult {
  params: Record<string, number>;
  /** How far the object's origin moves, in local units, to keep the other side in place. */
  shift: THREE.Vector3;
}

export interface Handle {
  feature: 'face' | 'edge' | 'corner';
  /** The dimensions it changes, by name, such as `width`. */
  dims: DimensionName[];
  /** The point held, on the surface. */
  grab: THREE.Vector3;
  constraint: Constraint;
  /** The shape's new parameters for the held point moved to `p`. */
  apply(p: THREE.Vector3, options: ApplyOptions): EditResult;
}

export interface ApplyOptions {
  /** Keep the centre in place rather than the opposite side. */
  symmetric?: boolean;
  /** Round shown dimensions to multiples of this, in world units. */
  snap?: number | null;
  /** The object's world scale along its local axes, to snap and show world sizes. */
  scale?: THREE.Vector3;
  /**
   * Where the pointer was when the drag began, by the same constraint. Sizes change by how far it
   * has moved from there. The held point if not given.
   */
  from?: THREE.Vector3;
}

export type DimensionName = 'width' | 'height' | 'depth' | 'diameter' | 'outer' | 'inner' | 'thickness';

/** A linear dimension: from `a` to `b`, measured along `axis`, drawn beside them on the `side`. */
export interface Dimension {
  name: DimensionName;
  a: THREE.Vector3;
  b: THREE.Vector3;
  axis: THREE.Vector3;
  /** Which way from the shape the dimension line is set off; zero to draw it through a and b. */
  side: THREE.Vector3;
  /** `Ø` for diameters. */
  prefix: string;
}

/** Smallest size a dimension can be dragged to, as a share of the size when the drag began. */
const MIN_SHARE = 0.02;
const MIN_ABS = 1e-4;

/** The shape of a box, sphere, cylinder, cone, torus or plane, or null for anything else. */
export function editableShape(o: THREE.Object3D): EditableShape | null {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return null;
  const geo = mesh.geometry as THREE.BufferGeometry & { parameters?: Record<string, number> };
  const p = geo.parameters;
  if (!p) return null;
  const kind = (
    {
      BoxGeometry: 'box',
      SphereGeometry: 'sphere',
      CylinderGeometry: 'cylinder',
      ConeGeometry: 'cone',
      TorusGeometry: 'torus',
      PlaneGeometry: 'plane',
    } as Record<string, EditableKind>
  )[geo.type];
  return kind ? { kind, params: { ...p } } : null;
}

/** A geometry like the shape's, with new parameters, keeping its segment counts and angles. */
export function buildGeometry(kind: EditableKind, p: Record<string, number>): THREE.BufferGeometry {
  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(p['width'], p['height'], p['depth'], p['widthSegments'], p['heightSegments'], p['depthSegments']);
    case 'sphere':
      return new THREE.SphereGeometry(p['radius'], p['widthSegments'], p['heightSegments'], p['phiStart'], p['phiLength'], p['thetaStart'], p['thetaLength']);
    case 'cylinder':
      return new THREE.CylinderGeometry(
        p['radiusTop'], p['radiusBottom'], p['height'], p['radialSegments'], p['heightSegments'], !!p['openEnded'], p['thetaStart'], p['thetaLength'],
      );
    case 'cone':
      return new THREE.ConeGeometry(p['radius'], p['height'], p['radialSegments'], p['heightSegments'], !!p['openEnded'], p['thetaStart'], p['thetaLength']);
    case 'torus':
      return new THREE.TorusGeometry(p['radius'], p['tube'], p['radialSegments'], p['tubularSegments'], p['arc']);
    case 'plane':
      return new THREE.PlaneGeometry(p['width'], p['height'], p['widthSegments'], p['heightSegments']);
  }
}

/** A shape's dimensions by name, in local units, for the properties panel. */
export function dimensionsOf(shape: EditableShape): { name: DimensionName; label: string; value: number }[] {
  const p = shape.params;
  switch (shape.kind) {
    case 'box':
      return [
        { name: 'width', label: 'Width (X)', value: p['width'] },
        { name: 'height', label: 'Height (Y)', value: p['height'] },
        { name: 'depth', label: 'Depth (Z)', value: p['depth'] },
      ];
    case 'sphere':
      return [{ name: 'diameter', label: 'Diameter', value: 2 * p['radius'] }];
    case 'cylinder':
      return [
        { name: 'diameter', label: 'Diameter', value: 2 * Math.max(p['radiusTop'], p['radiusBottom']) },
        { name: 'height', label: 'Height', value: p['height'] },
      ];
    case 'cone':
      return [
        { name: 'diameter', label: 'Base diameter', value: 2 * p['radius'] },
        { name: 'height', label: 'Height', value: p['height'] },
      ];
    case 'torus':
      return [
        { name: 'outer', label: 'Outer diameter', value: 2 * (p['radius'] + p['tube']) },
        { name: 'inner', label: 'Inner diameter', value: 2 * (p['radius'] - p['tube']) },
        { name: 'thickness', label: 'Thickness', value: 2 * p['tube'] },
      ];
    case 'plane':
      return [
        { name: 'width', label: 'Width (X)', value: p['width'] },
        { name: 'height', label: 'Length (Y)', value: p['height'] },
      ];
  }
}

/**
 * The shape's parameters with one dimension set, as typed in the properties panel. The centre stays
 * where it is. Returns null for a value it can't take.
 */
export function withDimension(shape: EditableShape, name: DimensionName, value: number): Record<string, number> | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const p = { ...shape.params };
  switch (shape.kind) {
    case 'box':
    case 'plane':
      if (!(name in p)) return null;
      p[name] = value;
      return p;
    case 'sphere':
      p['radius'] = value / 2;
      return p;
    case 'cylinder': {
      if (name === 'height') p['height'] = value;
      else {
        const k = value / 2 / Math.max(p['radiusTop'], p['radiusBottom'], MIN_ABS);
        p['radiusTop'] *= k;
        p['radiusBottom'] *= k;
      }
      return p;
    }
    case 'cone':
      if (name === 'height') p['height'] = value;
      else p['radius'] = value / 2;
      return p;
    case 'torus': {
      let outer = 2 * (p['radius'] + p['tube']);
      let inner = 2 * (p['radius'] - p['tube']);
      if (name === 'outer') outer = value;
      else if (name === 'inner') inner = value;
      else if (name === 'thickness') {
        // The tube grows about its centre line.
        if (value / 2 > p['radius']) return null;
        p['tube'] = value / 2;
        return p;
      }
      if (inner < 0 || outer - inner < 1e-9) return null;
      p['radius'] = (outer + inner) / 4;
      p['tube'] = (outer - inner) / 4;
      return p;
    }
  }
}

/**
 * The feature of a shape at a point on its surface, or null where nothing can be dragged (inside a
 * plane). `normal` is the face's normal there, and `tolerance` how near, per local axis, a point
 * must be to an edge or corner to hold it, about a few pixels.
 */
export function pickHandle(shape: EditableShape, point: THREE.Vector3, normal: THREE.Vector3, tolerance: THREE.Vector3): Handle | null {
  const g = point.clone();
  switch (shape.kind) {
    case 'box':
      return boxHandle(shape.params, g, normal, tolerance);
    case 'plane':
      return planeHandle(shape.params, g, tolerance);
    case 'sphere':
      return sphereHandle(shape.params, g);
    case 'cylinder':
    case 'cone':
      return axialHandle(shape, g, normal, tolerance);
    case 'torus':
      return torusHandle(shape.params, g);
  }
}

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const BOX_KEYS = ['width', 'height', 'depth'] as const;

function feature(n: number): Handle['feature'] {
  return n >= 3 ? 'corner' : n === 2 ? 'edge' : 'face';
}

/** A length dragged from `size` by `delta` at one end, or both ends with `symmetric`, snapped. */
function resize(size: number, delta: number, o: ApplyOptions, scale = 1): number {
  let v = size + (o.symmetric ? 2 : 1) * delta;
  if (o.snap && o.snap > 0) v = (Math.round((v * scale) / o.snap) * o.snap) / scale;
  return Math.max(v, size * MIN_SHARE, MIN_ABS);
}

/** Like `resize`, for a radius whose diameter is what is shown and snapped. */
function resizeRadius(r: number, delta: number, o: ApplyOptions, scale = 1): number {
  let v = r + delta;
  if (o.snap && o.snap > 0) v = (Math.round((2 * v * scale) / o.snap) * o.snap) / scale / 2;
  return Math.max(v, r * MIN_SHARE, MIN_ABS);
}

function axisScale(o: ApplyOptions, i: number): number {
  return o.scale ? Math.abs(o.scale.getComponent(i)) || 1 : 1;
}

function constraintFor(axes: THREE.Vector3[]): Constraint {
  if (axes.length === 1) return { kind: 'line', dir: axes[0].clone() };
  if (axes.length === 2) return { kind: 'plane', normal: new THREE.Vector3().crossVectors(axes[0], axes[1]).normalize() };
  return { kind: 'view' };
}

function boxHandle(p: Record<string, number>, g: THREE.Vector3, normal: THREE.Vector3, tol: THREE.Vector3): Handle {
  const n = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const faceAxis = n.indexOf(Math.max(...n));
  const held: number[] = [faceAxis];
  for (let i = 0; i < 3; i++) {
    if (i === faceAxis) continue;
    const half = p[BOX_KEYS[i]] / 2;
    if (Math.abs(g.getComponent(i)) >= half - Math.min(tol.getComponent(i), half * 0.25)) held.push(i);
  }
  held.sort();
  const signs = [0, 1, 2].map(i => (g.getComponent(i) >= 0 ? 1 : -1));
  return {
    feature: feature(held.length),
    dims: held.map(i => BOX_KEYS[i]),
    grab: g,
    constraint: constraintFor(held.map(i => AXES[i])),
    apply: (to, o) => {
      const params = { ...p };
      const shift = new THREE.Vector3();
      for (const i of held) {
        const size = p[BOX_KEYS[i]];
        const delta = signs[i] * (to.getComponent(i) - (o.from ?? g).getComponent(i));
        const next = resize(size, delta, o, axisScale(o, i));
        params[BOX_KEYS[i]] = next;
        if (!o.symmetric) shift.setComponent(i, (signs[i] * (next - size)) / 2);
      }
      return { params, shift };
    },
  };
}

function planeHandle(p: Record<string, number>, g: THREE.Vector3, tol: THREE.Vector3): Handle | null {
  const keys = ['width', 'height'] as const;
  const held: number[] = [];
  for (let i = 0; i < 2; i++) {
    const half = p[keys[i]] / 2;
    if (Math.abs(g.getComponent(i)) >= half - Math.min(tol.getComponent(i), half * 0.25)) held.push(i);
  }
  if (!held.length) return null;
  const signs = [g.x >= 0 ? 1 : -1, g.y >= 0 ? 1 : -1];
  return {
    feature: held.length === 2 ? 'corner' : 'edge',
    dims: held.map(i => keys[i]),
    grab: g,
    constraint: constraintFor(held.map(i => AXES[i])),
    apply: (to, o) => {
      const params = { ...p };
      const shift = new THREE.Vector3();
      for (const i of held) {
        const size = p[keys[i]];
        const next = resize(size, signs[i] * (to.getComponent(i) - (o.from ?? g).getComponent(i)), o, axisScale(o, i));
        params[keys[i]] = next;
        if (!o.symmetric) shift.setComponent(i, (signs[i] * (next - size)) / 2);
      }
      return { params, shift };
    },
  };
}

function sphereHandle(p: Record<string, number>, g: THREE.Vector3): Handle | null {
  const len = g.length();
  if (len < 1e-12) return null;
  return {
    feature: 'face',
    dims: ['diameter'],
    grab: g,
    constraint: { kind: 'radial', axis: null },
    apply: (to, o) => {
      // As far as the pointer moves out from the centre, the surface does; the centre stays.
      const r = p['radius'];
      const next = resizeRadius(r, to.length() - (o.from ?? g).length(), o, axisScale(o, 0));
      return { params: { ...p, radius: next }, shift: new THREE.Vector3() };
    },
  };
}

/** Cylinders and cones: the axis is local Y, the cone's apex at +height/2. */
function axialHandle(shape: EditableShape, g: THREE.Vector3, normal: THREE.Vector3, tol: THREE.Vector3): Handle {
  const p = shape.params;
  const cone = shape.kind === 'cone';
  const h = p['height'];
  const rTop = cone ? 0 : p['radiusTop'];
  const rBottom = cone ? p['radius'] : p['radiusBottom'];
  const rMax = Math.max(rTop, rBottom);
  const tolY = Math.min(tol.y, h * 0.25);
  const tolR = Math.min(tol.x, rMax * 0.25);
  const rho = Math.hypot(g.x, g.z);
  const u = rho > 1e-12 ? new THREE.Vector3(g.x / rho, 0, g.z / rho) : null;

  // Which end, if any: a cap face, or near the apex or a rim.
  const onCap = Math.abs(normal.y) > 0.999;
  let end = 0;
  if (onCap) end = normal.y > 0 ? 1 : -1;
  else if (g.y >= h / 2 - tolY) end = 1;
  else if (g.y <= -h / 2 + tolY) end = -1;
  // The radius there, and whether the point is at the rim.
  const rAt = (y: number) => rBottom + ((rTop - rBottom) * (y + h / 2)) / h;
  const rimR = end === 1 ? rTop : end === -1 ? rBottom : rAt(g.y);
  const radial = !!u && (!onCap || rho >= rimR - tolR) && !(cone && end === 1);

  const dims: DimensionName[] = [];
  if (radial) dims.push('diameter');
  if (end) dims.push('height');
  // A cone's side between base and apex: the point held stays at the same height.
  const share = cone ? Math.max(rAt(g.y) / Math.max(rBottom, MIN_ABS), 1e-3) : 1;

  return {
    feature: feature(dims.length),
    dims: dims.length ? dims : ['height'],
    grab: g,
    constraint: radial ? { kind: 'radial', axis: AXES[1].clone() } : { kind: 'line', dir: AXES[1].clone() },
    apply: (to, o) => {
      const params = { ...p };
      const shift = new THREE.Vector3();
      const from = o.from ?? g;
      if (radial) {
        const delta = (Math.hypot(to.x, to.z) - Math.hypot(from.x, from.z)) / share;
        if (cone) params['radius'] = resizeRadius(rBottom, delta, o, axisScale(o, 0));
        else {
          const next = resizeRadius(rMax, delta, o, axisScale(o, 0));
          params['radiusTop'] = (rTop / rMax) * next;
          params['radiusBottom'] = (rBottom / rMax) * next;
        }
      }
      if (end || !dims.length) {
        const s = end || 1;
        const next = resize(h, s * (to.y - from.y), o, axisScale(o, 1));
        params['height'] = next;
        if (!o.symmetric) shift.y = (s * (next - h)) / 2;
      }
      return { params, shift };
    },
  };
}

/** A torus lies in local XY, round local Z. */
function torusHandle(p: Record<string, number>, g: THREE.Vector3): Handle | null {
  const R = p['radius'];
  const r = p['tube'];
  const rho = Math.hypot(g.x, g.y);
  if (rho < 1e-12) return null;
  const across = rho - R;
  // Within 60° of the outside or inside: a diameter; otherwise the top or bottom: the thickness.
  if (Math.abs(across) >= r * 0.5) {
    const outside = across > 0;
    return {
      feature: 'face',
      dims: [outside ? 'outer' : 'inner'],
      grab: g,
      constraint: { kind: 'radial', axis: AXES[2].clone() },
      apply: (to, o) => {
        const from = o.from ?? g;
        const delta = Math.hypot(to.x, to.y) - Math.hypot(from.x, from.y);
        const sc = axisScale(o, 0);
        let outer = R + r;
        let inner = R - r;
        const min = Math.max(r * MIN_SHARE, MIN_ABS);
        if (outside) {
          outer = resizeRadius(outer, delta, o, sc);
          if (o.symmetric) inner = Math.max(inner - (outer - (R + r)), 0);
          outer = Math.max(outer, inner + 2 * min);
        } else {
          inner = Math.max(inner + delta, 0);
          if (o.snap && o.snap > 0) inner = (Math.round((2 * inner * sc) / o.snap) * o.snap) / sc / 2;
          if (o.symmetric) outer = outer - (inner - (R - r));
          inner = Math.min(Math.max(inner, 0), outer - 2 * min);
        }
        return { params: { ...p, radius: (outer + inner) / 2, tube: (outer - inner) / 2 }, shift: new THREE.Vector3() };
      },
    };
  }
  const s = g.z >= 0 ? 1 : -1;
  const sin = Math.max(Math.abs(g.z) / r, 0.5);
  return {
    feature: 'face',
    dims: ['thickness'],
    grab: g,
    constraint: { kind: 'line', dir: AXES[2].clone() },
    apply: (to, o) => {
      // Thickness is 2·tube; one side moves and the other stays, unless symmetric.
      const delta = (s * (to.z - (o.from ?? g).z)) / sin;
      const thick = Math.min(resize(2 * r, delta, o, axisScale(o, 2)), 2 * R);
      const tube = thick / 2;
      const shift = new THREE.Vector3(0, 0, o.symmetric ? 0 : s * (tube - r));
      return { params: { ...p, tube }, shift };
    },
  };
}

/**
 * Where the held point goes for a pointer ray, both in local coordinates, under the handle's
 * constraint. `view` is the direction the camera looks, in local coordinates. Null when the ray
 * runs along the constraint and gives no answer.
 */
export function constrainedPoint(handle: Handle, ray: THREE.Ray, view: THREE.Vector3): THREE.Vector3 | null {
  const g = handle.grab;
  const c = handle.constraint;
  if (c.kind === 'line') {
    // The point on the line nearest the ray.
    const d = c.dir.clone().normalize();
    const w = ray.direction.clone().normalize();
    const r = g.clone().sub(ray.origin);
    const b = d.dot(w);
    const denom = 1 - b * b;
    // A line pointing at the camera can't be followed: tiny moves would go far.
    if (denom < 0.03) return null;
    const t = (b * r.dot(w) - r.dot(d)) / denom;
    return g.clone().addScaledVector(d, t);
  }
  const look = view.clone().normalize();
  if (c.kind === 'radial') {
    // Through the centre or the axis, facing the camera as far as it can.
    let normal = look;
    if (c.axis) {
      const a = c.axis.clone().normalize();
      normal = look.clone().addScaledVector(a, -look.dot(a));
      // Looking along the axis: across it, through the point held.
      if (normal.lengthSq() < 0.05) return ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(a, g), new THREE.Vector3());
      normal.normalize();
    }
    return ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3()), new THREE.Vector3());
  }
  let normal = c.kind === 'plane' ? c.normal.clone().normalize() : look;
  // A plane seen edge on gives wild points: use the view plane instead.
  if (Math.abs(normal.dot(ray.direction.clone().normalize())) < 0.15) normal = view.clone().normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, g);
  const hit = ray.intersectPlane(plane, new THREE.Vector3());
  return hit;
}

/**
 * The dimension lines to show for a handle's dimensions, with the shape as it now is. `right` and
 * `up` are the camera's directions in local coordinates, which set where diameters are measured and
 * which way lines are set off. Several candidate places are given for some dimensions; the view
 * keeps the one furthest out on screen.
 */
export function dimensionLines(shape: EditableShape, names: DimensionName[], right: THREE.Vector3, up: THREE.Vector3): Dimension[][] {
  const p = shape.params;
  const out: Dimension[][] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const dim = (name: DimensionName, a: THREE.Vector3, b: THREE.Vector3, axis: THREE.Vector3, side: THREE.Vector3, prefix = ''): Dimension => ({
    name, a, b, axis: axis.clone().normalize(), side, prefix,
  });
  /** A unit direction in the plane square to `normal`, as near the camera's right as can be. */
  const across = (normal: THREE.Vector3) => {
    const d = right.clone().addScaledVector(normal, -right.dot(normal));
    if (d.lengthSq() < 1e-6) d.copy(up).addScaledVector(normal, -up.dot(normal));
    if (d.lengthSq() < 1e-12) d.set(1, 0, 0).addScaledVector(normal, -normal.x);
    return d.normalize();
  };
  for (const name of names) {
    switch (shape.kind) {
      case 'box': {
        const i = BOX_KEYS.indexOf(name as (typeof BOX_KEYS)[number]);
        if (i < 0) break;
        const half = [p['width'] / 2, p['height'] / 2, p['depth'] / 2];
        const [j, k] = [0, 1, 2].filter(x => x !== i);
        const cands: Dimension[] = [];
        for (const sj of [-1, 1]) {
          for (const sk of [-1, 1]) {
            const a = v(0, 0, 0);
            a.setComponent(j, sj * half[j]);
            a.setComponent(k, sk * half[k]);
            const b = a.clone();
            a.setComponent(i, -half[i]);
            b.setComponent(i, half[i]);
            // Set off within one of the two faces at the edge: whichever is less end-on.
            const fj = AXES[j].clone().multiplyScalar(sj);
            const fk = AXES[k].clone().multiplyScalar(sk);
            const side = Math.abs(fj.dot(right)) + Math.abs(fj.dot(up)) >= Math.abs(fk.dot(right)) + Math.abs(fk.dot(up)) ? fj : fk;
            cands.push(dim(name, a, b, AXES[i], side));
          }
        }
        out.push(cands);
        break;
      }
      case 'plane': {
        const i = name === 'width' ? 0 : name === 'height' ? 1 : -1;
        if (i < 0) break;
        const half = [p['width'] / 2, p['height'] / 2];
        const j = 1 - i;
        const cands: Dimension[] = [];
        for (const s of [-1, 1]) {
          const a = v(0, 0, 0);
          a.setComponent(j, s * half[j]);
          const b = a.clone();
          a.setComponent(i, -half[i]);
          b.setComponent(i, half[i]);
          cands.push(dim(name, a, b, AXES[i], AXES[j].clone().multiplyScalar(s)));
        }
        out.push(cands);
        break;
      }
      case 'sphere': {
        const d = across(new THREE.Vector3().crossVectors(right, up).normalize());
        const r = p['radius'];
        out.push([dim('diameter', d.clone().multiplyScalar(-r), d.clone().multiplyScalar(r), d, v(0, 0, 0), 'Ø')]);
        break;
      }
      case 'cylinder':
      case 'cone': {
        const cone = shape.kind === 'cone';
        const h = p['height'];
        const rTop = cone ? 0 : p['radiusTop'];
        const rBottom = cone ? p['radius'] : p['radiusBottom'];
        const d = across(AXES[1]);
        if (name === 'diameter') {
          // Across the larger end, set off away from the body.
          const top = rTop > rBottom;
          const r = top ? rTop : rBottom;
          const y = top ? h / 2 : -h / 2;
          out.push([dim('diameter', d.clone().multiplyScalar(-r).setY(y), d.clone().multiplyScalar(r).setY(y), d, v(0, top ? 1 : -1, 0), 'Ø')]);
        } else if (name === 'height') {
          const cands: Dimension[] = [];
          for (const s of [-1, 1]) {
            const side = d.clone().multiplyScalar(s);
            cands.push(dim('height', side.clone().multiplyScalar(rBottom).setY(-h / 2), side.clone().multiplyScalar(rTop).setY(h / 2), AXES[1], side));
          }
          out.push(cands);
        }
        break;
      }
      case 'torus': {
        const R = p['radius'];
        const r = p['tube'];
        const z = AXES[2];
        const d = across(z);
        const off = new THREE.Vector3().crossVectors(z, d).normalize();
        if (name === 'outer') {
          out.push([-1, 1].map(s => dim('outer', d.clone().multiplyScalar(-(R + r)), d.clone().multiplyScalar(R + r), d, off.clone().multiplyScalar(s), 'Ø')));
        } else if (name === 'inner') {
          out.push([dim('inner', d.clone().multiplyScalar(-(R - r)), d.clone().multiplyScalar(R - r), d, v(0, 0, 0), 'Ø')]);
        } else if (name === 'thickness') {
          out.push(
            [-1, 1].map(s => {
              const c = d.clone().multiplyScalar(s * R);
              return dim('thickness', c.clone().setZ(-r), c.clone().setZ(r), z, d.clone().multiplyScalar(s));
            }),
          );
        }
        break;
      }
    }
  }
  return out;
}

/** A length for a dimension label: up to three decimals, without trailing zeros. */
export function formatLength(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
  return String(Number(value.toFixed(digits)));
}
