import * as THREE from 'three';

/**
 * Environment maps for ray tracing: what is all around the scene, seen in reflections and
 * refractions, lighting it, and optionally behind it. They are equirectangular images whose pixels
 * the ray tracer can read: high dynamic range ones made here, or files (.hdr, .exr, or an image).
 */

export type EnvironmentKind = 'none' | 'studio' | 'sky' | 'sunset' | 'overcast' | 'file';

export const ENVIRONMENTS: { kind: EnvironmentKind; label: string; about: string }[] = [
  { kind: 'none', label: 'None', about: 'Nothing around the scene: reflections show the background colour' },
  { kind: 'studio', label: 'Studio', about: 'A grey studio with soft light boxes, as product photos use' },
  { kind: 'sky', label: 'Sky', about: 'Blue sky with the sun high, over open ground' },
  { kind: 'sunset', label: 'Sunset', about: 'A low sun on an orange horizon' },
  { kind: 'overcast', label: 'Overcast', about: 'An even, cloudy sky, without hard highlights' },
  { kind: 'file', label: 'From files…', about: 'An .hdr, .exr, .jpg or .png image: a panorama, a cube map as one image or six, a mirror ball or a light probe' },
];

/** File types an environment can be loaded from. */
export const ENVIRONMENT_FILES = '.hdr,.exr,.jpg,.jpeg,.png,.webp';

const WIDTH = 512;
const HEIGHT = 256;
const made = new Map<EnvironmentKind, THREE.DataTexture>();

/** A built-in environment, made the first time it is asked for. */
export function builtInEnvironment(kind: EnvironmentKind): THREE.DataTexture | null {
  if (kind === 'none' || kind === 'file') return null;
  let t = made.get(kind);
  if (!t) {
    t = new THREE.DataTexture(paint(RADIANCE[kind]), WIDTH, HEIGHT, THREE.RGBAFormat, THREE.FloatType);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.name = ENVIRONMENTS.find(e => e.kind === kind)!.label;
    t.needsUpdate = true;
    made.set(kind, t);
  }
  return t;
}

/**
 * How an environment image is laid out: the 2:1 panorama, a cube map as one image or six, a
 * sphere (a photo of a mirror ball, or an angular light probe), or a cylindrical panorama. Each
 * is turned into an equirectangular image for the ray tracer.
 */
export type Projection = 'equirect' | 'cross-h' | 'cross-v' | 'strip-h' | 'strip-v' | 'cube-faces' | 'mirror-ball' | 'angular' | 'cylinder';

export const PROJECTIONS: { id: Projection; label: string; about: string }[] = [
  { id: 'equirect', label: 'Equirectangular', about: 'A 2:1 panorama: across is all the way round, down is from straight up to straight down' },
  { id: 'cross-h', label: 'Cube: horizontal cross', about: 'A cube map unfolded as a cross, 4:3: up on top; left, front, right, back across; down below' },
  { id: 'cross-v', label: 'Cube: vertical cross', about: 'A cube map unfolded as a cross, 3:4: up; left, front, right; down; back, upside down' },
  { id: 'strip-h', label: 'Cube: horizontal strip', about: 'Six cube faces side by side, 6:1, in the order +X, −X, +Y, −Y, +Z, −Z' },
  { id: 'strip-v', label: 'Cube: vertical strip', about: 'Six cube faces one above the other, 1:6, in the order +X, −X, +Y, −Y, +Z, −Z' },
  { id: 'cube-faces', label: 'Cube: six images', about: 'A cube map as six images, named px, nx, py, ny, pz, nz (or posx, right, top, front and so on)' },
  { id: 'mirror-ball', label: 'Sphere: mirror ball', about: 'A photo of a mirrored ball, cropped to the ball, taken from +Z' },
  { id: 'angular', label: 'Sphere: angular map', about: 'A light probe in angular projection: +Z in the middle, −Z all round the edge' },
  { id: 'cylinder', label: 'Cylindrical panorama', about: 'All the way round across, and a band above and below the horizon' },
];

/** An image's pixels: RGBA, linear, unbounded floats, the top row first. */
export interface Pixels {
  width: number;
  height: number;
  data: Float32Array;
}

/** Environment images as read, before they are projected. */
export interface EnvironmentSource {
  name: string;
  /** One image, or six cube faces in the order +X, −X, +Y, −Y, +Z, −Z. */
  images: Pixels[];
}

/** The projections that fit images: six are a cube; one is anything else. */
export function projectionsFor(source: EnvironmentSource): Projection[] {
  return source.images.length === 6 ? ['cube-faces'] : PROJECTIONS.map(p => p.id).filter(p => p !== 'cube-faces');
}

/** The projection an image most likely has, from its proportions; `hdr` for light probes. */
export function guessProjection(source: EnvironmentSource, hdr = false): Projection {
  if (source.images.length === 6) return 'cube-faces';
  const { width, height } = source.images[0];
  const a = width / height;
  const near = (x: number, tolerance = 0.04) => Math.abs(a / x - 1) < tolerance;
  if (near(2)) return 'equirect';
  if (near(4 / 3)) return 'cross-h';
  if (near(3 / 4)) return 'cross-v';
  if (near(6)) return 'strip-h';
  if (near(1 / 6)) return 'strip-v';
  // Square: light probes in HDR are angular maps; photos are of a mirror ball.
  if (near(1, 0.05)) return hdr ? 'angular' : 'mirror-ball';
  return a > 2 ? 'cylinder' : 'equirect';
}

/** Reads environment images: one file, or six cube faces, ordered by their names. */
export async function readEnvironmentFiles(files: File[]): Promise<EnvironmentSource> {
  if (files.length !== 1 && files.length !== 6) throw new Error('Choose one image, or six: the faces of a cube map.');
  const ordered = files.length === 6 ? orderFaces(files) : files;
  const images = await Promise.all(ordered.map(readPixels));
  if (images.length === 6 && images.some(i => i.width !== images[0].width || i.height !== images[0].height)) {
    throw new Error('The six faces of a cube map must all be the same size.');
  }
  const common = commonName(files.map(f => f.name));
  const name = files.length === 1 ? files[0].name : common ? `${common} (cube map)` : 'Cube map';
  return { name, images };
}

const FACE_NAMES: [number, RegExp][] = [
  [0, /(^|[^a-z])(px|posx|pos_x|positive_?x|right|rt|\+x)([^a-z]|$)/i],
  [1, /(^|[^a-z])(nx|negx|neg_x|negative_?x|left|lf|-x)([^a-z]|$)/i],
  [2, /(^|[^a-z])(py|posy|pos_y|positive_?y|top|up|\+y)([^a-z]|$)/i],
  [3, /(^|[^a-z])(ny|negy|neg_y|negative_?y|bottom|bot|down|dn|-y)([^a-z]|$)/i],
  [4, /(^|[^a-z])(pz|posz|pos_z|positive_?z|front|ft|\+z)([^a-z]|$)/i],
  [5, /(^|[^a-z])(nz|negz|neg_z|negative_?z|back|bk|-z)([^a-z]|$)/i],
];

/** Six files as cube faces, +X, −X, +Y, −Y, +Z, −Z, by their names, or in the order given. */
export function orderFaces<T extends { name: string }>(files: T[]): T[] {
  const out: (T | undefined)[] = Array.from({ length: 6 }, () => undefined);
  for (const f of files) {
    const base = f.name.replace(/\.[^.]+$/, '');
    const hit = FACE_NAMES.find(([i, re]) => !out[i] && re.test(base));
    if (hit) out[hit[0]] = f;
  }
  return out.every(Boolean) ? (out as T[]) : files;
}

function commonName(names: string[]): string {
  let p = names[0];
  for (const n of names) while (!n.startsWith(p)) p = p.slice(0, -1);
  return p.replace(/[_\-. ]+$/, '');
}

/** A file's pixels, linear: .hdr and .exr as they are, other images from sRGB. */
async function readPixels(file: File): Promise<Pixels> {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (ext === '.hdr' || ext === '.exr') {
    const buffer = await file.arrayBuffer();
    const parsed =
      ext === '.hdr'
        ? new (await import('three/examples/jsm/loaders/HDRLoader.js')).HDRLoader().setDataType(THREE.FloatType).parse(buffer)
        : new (await import('three/examples/jsm/loaders/EXRLoader.js')).EXRLoader().setDataType(THREE.FloatType).parse(buffer);
    const { width, height } = parsed as { width: number; height: number };
    const src = (parsed as { data: Float32Array }).data;
    const channels = src.length / (width * height);
    // .hdr files hold the top row first, .exr images the bottom row first, as three.js reads them.
    const bottomFirst = ext === '.exr';
    const data = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const sy = bottomFirst ? height - 1 - y : y;
      for (let x = 0; x < width; x++) {
        const i = (sy * width + x) * channels;
        const o = (y * width + x) * 4;
        data[o] = src[i];
        data[o + 1] = channels > 1 ? src[i + 1] : src[i];
        data[o + 2] = channels > 2 ? src[i + 2] : src[i];
        data[o + 3] = 1;
      }
    }
    return { width, height, data };
  }
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('No canvas to read the image with.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const bytes = ctx.getImageData(0, 0, width, height).data;
  const toLinear = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    toLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = toLinear[bytes[i * 4]];
    data[i * 4 + 1] = toLinear[bytes[i * 4 + 1]];
    data[i * 4 + 2] = toLinear[bytes[i * 4 + 2]];
    data[i * 4 + 3] = 1;
  }
  return { width, height, data };
}

/** Where a world direction falls in an image: which image, and u across and v down, 0 to 1. */
type Lookup = (x: number, y: number, z: number) => [number, number, number];

/** The cube face images and where in the source each one is. */
interface FaceRect {
  x: number;
  y: number;
  /** Turned upside down, as the back face of a vertical cross is. */
  turned?: boolean;
}

/**
 * Cube map lookup as three.js does it for cube textures made of images: x turned round, then the
 * OpenGL face choice; faces in the order +X, −X, +Y, −Y, +Z, −Z, their first row at the top.
 */
function cubeFace(x: number, y: number, z: number): [number, number, number] {
  x = -x;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  let sc: number;
  let tc: number;
  let ma: number;
  if (ax >= ay && ax >= az) {
    face = x > 0 ? 0 : 1;
    ma = ax;
    sc = x > 0 ? -z : z;
    tc = -y;
  } else if (ay >= az) {
    face = y > 0 ? 2 : 3;
    ma = ay;
    sc = x;
    tc = y > 0 ? z : -z;
  } else {
    face = z > 0 ? 4 : 5;
    ma = az;
    sc = z > 0 ? x : -x;
    tc = -y;
  }
  return [face, (sc / ma + 1) / 2, (tc / ma + 1) / 2];
}

/** Where the six faces are in one image, in face sizes, for crosses and strips. */
const LAYOUTS: Partial<Record<Projection, { cols: number; rows: number; faces: FaceRect[] }>> = {
  'cross-h': { cols: 4, rows: 3, faces: [{ x: 2, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 3, y: 1 }] },
  'cross-v': { cols: 3, rows: 4, faces: [{ x: 2, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 1, y: 3, turned: true }] },
  'strip-h': { cols: 6, rows: 1, faces: [0, 1, 2, 3, 4, 5].map(i => ({ x: i, y: 0 })) },
  'strip-v': { cols: 1, rows: 6, faces: [0, 1, 2, 3, 4, 5].map(i => ({ x: 0, y: i })) },
};

function lookupFor(projection: Projection, source: EnvironmentSource): Lookup {
  const { width, height } = source.images[0];
  switch (projection) {
    case 'equirect':
      return (x, y, z) => [0, Math.atan2(z, x) / (2 * Math.PI) + 0.5, 0.5 - Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI];
    case 'cylinder': {
      // Round a cylinder as wide as the image is round: height above the horizon is tan(elevation).
      const k = width / (2 * Math.PI * height);
      return (x, y, z) => [0, Math.atan2(z, x) / (2 * Math.PI) + 0.5, 0.5 - k * (y / Math.max(Math.hypot(x, z), 1e-6))];
    }
    case 'cube-faces':
      return cubeFace;
    case 'mirror-ball':
      // Seen from +Z: the ball's normal halfway between the direction and the camera.
      return (x, y, z) => {
        const len = Math.hypot(x, y, z + 1);
        // Straight behind the ball is all round its rim.
        if (len < 1e-6) return [0, 1, 0.5];
        return [0, (x / len + 1) / 2, (1 - y / len) / 2];
      };
    case 'angular':
      return (x, y, z) => {
        const s = Math.hypot(x, y);
        const r = s < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, z))) / (Math.PI * s);
        return [0, (x * r + 1) / 2, (1 - y * r) / 2];
      };
    default: {
      const layout = LAYOUTS[projection]!;
      return (x, y, z) => {
        const [face, s, t] = cubeFace(x, y, z);
        const rect = layout.faces[face];
        const fs = rect.turned ? 1 - s : s;
        const ft = rect.turned ? 1 - t : t;
        return [0, (rect.x + fs) / layout.cols, (rect.y + ft) / layout.rows];
      };
    }
  }
}

/** A pixel's colour, bilinearly, at u across and v down; across wraps for panoramas. */
function sample(p: Pixels, u: number, v: number, wrap: boolean, out: number[]): void {
  const fx = u * p.width - 0.5;
  const fy = Math.max(0, Math.min(p.height - 1, v * p.height - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const col = (x: number) => (wrap ? ((x % p.width) + p.width) % p.width : Math.max(0, Math.min(p.width - 1, x)));
  const row = (y: number) => Math.max(0, Math.min(p.height - 1, y));
  const xa = col(x0);
  const xb = col(x0 + 1);
  const ya = row(y0);
  const yb = row(y0 + 1);
  for (let c = 0; c < 3; c++) {
    const a = p.data[(ya * p.width + xa) * 4 + c] * (1 - tx) + p.data[(ya * p.width + xb) * 4 + c] * tx;
    const b = p.data[(yb * p.width + xa) * 4 + c] * (1 - tx) + p.data[(yb * p.width + xb) * 4 + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
}

/** The equirectangular width an image is worth in a projection, within limits. */
function outputWidth(projection: Projection, p: Pixels): number {
  let w: number;
  if (projection === 'equirect' || projection === 'cylinder') w = p.width;
  else if (projection === 'cube-faces') w = 4 * p.width;
  else if (LAYOUTS[projection]) w = (4 * p.width) / LAYOUTS[projection]!.cols;
  else w = 2 * p.width;
  return Math.max(256, Math.min(2048, Math.round(w / 2) * 2));
}

/**
 * Environment images, as an equirectangular HDR texture laid out as three.js and the ray tracer
 * sample it, whatever their projection.
 */
export function projectEnvironment(source: EnvironmentSource, projection: Projection): THREE.DataTexture {
  if ((projection === 'cube-faces') !== (source.images.length === 6)) {
    throw new Error(projection === 'cube-faces' ? 'A cube map needs six images.' : 'Six images are a cube map.');
  }
  const lookup = lookupFor(projection, source);
  const wrap = projection === 'equirect' || projection === 'cylinder';
  const width = outputWidth(projection, source.images[0]);
  const height = width / 2;
  const data = new Float32Array(width * height * 4);
  const c = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    // Row 0 is straight down, as in the built-in environments.
    const elevation = ((y + 0.5) / height - 0.5) * Math.PI;
    const ce = Math.cos(elevation);
    const se = Math.sin(elevation);
    for (let x = 0; x < width; x++) {
      const azimuth = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      const [image, u, v] = lookup(Math.cos(azimuth) * ce, se, Math.sin(azimuth) * ce);
      sample(source.images[image], u, v, wrap, c);
      const o = (y * width + x) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 1;
    }
  }
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.name = source.name;
  t.needsUpdate = true;
  return t;
}

/** Light, linear and unbounded, coming from a direction. */
type Radiance = (d: THREE.Vector3) => [number, number, number];

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add = (a: number[], b: number[], k = 1): [number, number, number] => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** A direction from azimuth (degrees round from +X towards +Z) and elevation (degrees up). */
function dir(azimuth: number, elevation: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuth);
  const e = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
}

/** A soft-edged light box: how much of it is seen towards `d`, 0 to 1. */
function box(d: THREE.Vector3, centre: THREE.Vector3, size: number, softness = 0.6): number {
  const angle = Math.acos(Math.min(Math.max(d.dot(centre), -1), 1));
  return 1 - smooth(size * softness, size, angle);
}

const KEY = dir(-50, 35);
const FILL = dir(140, 20);
const RIM = dir(60, 15);
const SUN = dir(60, 42);
const LOW_SUN = dir(-20, 4);

const RADIANCE: Record<'studio' | 'sky' | 'sunset' | 'overcast', Radiance> = {
  studio: d => {
    // Mid-grey walls, a darker floor, and light boxes: a large key, a fill, a rim and a top light.
    const wall = mix([0.08, 0.08, 0.085], [0.2, 0.2, 0.21], smooth(-0.1, 0.6, d.y));
    let c = d.y < 0 ? mix([0.05, 0.05, 0.05], wall, smooth(-0.3, 0, d.y)) : wall;
    c = add(c, [1, 1, 1], 9 * box(d, KEY, 0.42));
    c = add(c, [1, 0.98, 0.95], 3 * box(d, FILL, 0.5));
    c = add(c, [1, 1, 1], 5 * box(d, RIM, 0.18));
    c = add(c, [1, 1, 1], 4 * smooth(0.88, 0.97, d.y));
    return c;
  },
  sky: d => {
    if (d.y < 0) return mix([0.42, 0.45, 0.5], [0.12, 0.11, 0.1], smooth(0, 0.25, -d.y));
    let c = mix([0.75, 0.85, 1.0], [0.12, 0.3, 0.8], smooth(0, 0.7, d.y));
    const toSun = d.dot(SUN);
    c = add(c, [1, 0.95, 0.85], 0.6 * Math.pow(Math.max(toSun, 0), 24));
    c = add(c, [1, 0.97, 0.9], 400 * smooth(0.9995, 0.9998, toSun));
    return c;
  },
  sunset: d => {
    if (d.y < 0) return mix([0.25, 0.12, 0.07], [0.03, 0.025, 0.03], smooth(0, 0.3, -d.y));
    let c = mix([1.4, 0.5, 0.15], [0.06, 0.07, 0.22], smooth(0, 0.45, d.y));
    const toSun = d.dot(LOW_SUN);
    c = add(c, [1, 0.55, 0.2], 1.5 * Math.pow(Math.max(toSun, 0), 12));
    c = add(c, [1, 0.7, 0.4], 150 * smooth(0.9993, 0.9997, toSun));
    return c;
  },
  overcast: d => {
    if (d.y < 0) return mix([0.5, 0.5, 0.5], [0.18, 0.18, 0.17], smooth(0, 0.3, -d.y));
    return mix([0.8, 0.82, 0.85], [1.05, 1.05, 1.08], smooth(0, 0.8, d.y));
  },
};

/** RGBA floats of an equirectangular image of radiance, laid out as three.js samples it. */
function paint(radiance: Radiance): Float32Array {
  const out = new Float32Array(WIDTH * HEIGHT * 4);
  const d = new THREE.Vector3();
  for (let y = 0; y < HEIGHT; y++) {
    // Row 0 is straight down: three.js reads v = asin(y) / π + 0.5, and data textures aren't flipped.
    const elevation = ((y + 0.5) / HEIGHT - 0.5) * Math.PI;
    for (let x = 0; x < WIDTH; x++) {
      const azimuth = ((x + 0.5) / WIDTH - 0.5) * Math.PI * 2;
      d.set(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation));
      const c = radiance(d);
      const i = (y * WIDTH + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 1;
    }
  }
  return out;
}

/**
 * A small picture of an environment, tone mapped, as a data URL, for showing which is chosen.
 * Null where it can't be drawn.
 */
export function environmentThumbnail(texture: THREE.Texture, width = 160, height = 80): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = texture.image as { data?: ArrayLike<number>; width: number; height: number } | CanvasImageSource;
  const data = (image as { data?: ArrayLike<number> }).data;
  if (data) {
    // HDR pixels: Reinhard tone mapping, then sRGB.
    const { width: w, height: h } = image as { width: number; height: number };
    const half = texture.type === THREE.HalfFloatType;
    const channels = data.length / (w * h);
    const out = ctx.createImageData(width, height);
    const value = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
    const flip = !texture.flipY;
    for (let y = 0; y < height; y++) {
      // Up in the picture is up in the world.
      const sy = Math.floor(((flip ? height - 1 - y : y) + 0.5) * (h / height));
      for (let x = 0; x < width; x++) {
        const sx = Math.floor((x + 0.5) * (w / width));
        const i = (sy * w + sx) * channels;
        const o = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = value(i + c);
          const mapped = v / (1 + v);
          out.data[o + c] = Math.round(255 * (mapped <= 0.0031308 ? mapped * 12.92 : 1.055 * mapped ** (1 / 2.4) - 0.055));
        }
        out.data[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  } else {
    try {
      ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
    } catch {
      return null;
    }
  }
  return canvas.toDataURL('image/jpeg', 0.85);
}
