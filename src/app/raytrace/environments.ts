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
  { kind: 'file', label: 'From a file…', about: 'An equirectangular .hdr, .exr, .jpg or .png image' },
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

/** Loads an environment from a file: an .hdr or .exr image, or an ordinary one. */
export async function loadEnvironmentFile(file: File): Promise<THREE.Texture> {
  const url = URL.createObjectURL(file);
  try {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    let texture: THREE.Texture;
    if (ext === '.hdr') {
      const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
      texture = await new HDRLoader().loadAsync(url);
    } else if (ext === '.exr') {
      const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
      texture = await new EXRLoader().loadAsync(url);
    } else {
      texture = await new THREE.TextureLoader().loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.name = file.name;
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
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
