import * as THREE from 'three';
import { FieldValue, MATERIAL_FIELDS, MATERIAL_TYPES, writeField } from './materials';

/**
 * A library of common materials in groups: wood, metal, glass, plastic, stone, fabric, and ceramic
 * and paint. Each is a three.js material with settings, and for some a texture made here, such as
 * wood grain or marble veins; textures tile and are shared by the materials made from an entry.
 */

export interface LibraryCategory {
  id: string;
  label: string;
  icon: string;
}

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  { id: 'wood', label: 'Wood', icon: '🪵' },
  { id: 'metal', label: 'Metal', icon: '⚙' },
  { id: 'glass', label: 'Glass', icon: '◇' },
  { id: 'plastic', label: 'Plastic & rubber', icon: '◍' },
  { id: 'stone', label: 'Stone & concrete', icon: '⬢' },
  { id: 'fabric', label: 'Fabric & leather', icon: '▦' },
  { id: 'ceramic', label: 'Ceramic & paint', icon: '◉' },
];

export type TextureKind = 'wood' | 'marble' | 'brushed' | 'granite' | 'concrete' | 'weave' | 'leather' | 'terrazzo';

export interface LibraryTexture {
  kind: TextureKind;
  /** The colours it is made of, from the main one. */
  colors: string[];
  /** How many times it repeats across a shape's faces. */
  repeat?: number;
}

export interface LibraryMaterial {
  id: string;
  name: string;
  category: string;
  /** What it is like, in a few words. */
  about: string;
  type: 'MeshStandardMaterial' | 'MeshPhysicalMaterial';
  /** Settings, by the material fields' keys. */
  settings: Record<string, FieldValue>;
  texture?: LibraryTexture;
}

const std = 'MeshStandardMaterial' as const;
const phys = 'MeshPhysicalMaterial' as const;

export const MATERIAL_LIBRARY: LibraryMaterial[] = [
  // Wood: grain textures, matt or varnished.
  { id: 'oak', name: 'Oak', category: 'wood', about: 'Light oak, oiled', type: std, settings: { roughness: 0.7 }, texture: { kind: 'wood', colors: ['#b98a55', '#8a5f33'] } },
  { id: 'oak-varnished', name: 'Varnished oak', category: 'wood', about: 'Oak under a clear lacquer', type: phys, settings: { roughness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 }, texture: { kind: 'wood', colors: ['#b07a42', '#7a4f26'] } },
  { id: 'walnut', name: 'Walnut', category: 'wood', about: 'Dark walnut, satin', type: std, settings: { roughness: 0.55 }, texture: { kind: 'wood', colors: ['#6b4428', '#3e2614'] } },
  { id: 'pine', name: 'Pine', category: 'wood', about: 'Pale pine, unfinished', type: std, settings: { roughness: 0.8 }, texture: { kind: 'wood', colors: ['#e2c08a', '#c08f52'], repeat: 1 } },
  { id: 'cherry', name: 'Cherry', category: 'wood', about: 'Reddish cherry, satin', type: std, settings: { roughness: 0.5 }, texture: { kind: 'wood', colors: ['#a4532f', '#6e3018'] } },
  { id: 'ebony', name: 'Ebony', category: 'wood', about: 'Near-black ebony, polished', type: phys, settings: { roughness: 0.35, clearcoat: 0.6 }, texture: { kind: 'wood', colors: ['#2b211b', '#140e0a'] } },
  { id: 'bamboo', name: 'Bamboo', category: 'wood', about: 'Straw-coloured bamboo', type: std, settings: { roughness: 0.6 }, texture: { kind: 'wood', colors: ['#d8b56d', '#a98340'], repeat: 3 } },

  // Metal: metalness 1, by roughness; brushed ones are textured.
  { id: 'steel-brushed', name: 'Brushed steel', category: 'metal', about: 'Steel brushed in one direction', type: std, settings: { metalness: 1, roughness: 0.35 }, texture: { kind: 'brushed', colors: ['#b8bcc2', '#8e9399'] } },
  { id: 'stainless', name: 'Polished stainless', category: 'metal', about: 'Mirror-polished stainless steel', type: std, settings: { color: '#c9cdd2', metalness: 1, roughness: 0.08 } },
  { id: 'chrome', name: 'Chrome', category: 'metal', about: 'Chrome plating, a mirror', type: std, settings: { color: '#eef1f5', metalness: 1, roughness: 0.02 } },
  { id: 'aluminium', name: 'Aluminium', category: 'metal', about: 'Bare aluminium, slightly rough', type: std, settings: { color: '#d6d9dd', metalness: 1, roughness: 0.3 } },
  { id: 'aluminium-brushed', name: 'Brushed aluminium', category: 'metal', about: 'Aluminium brushed in one direction', type: std, settings: { metalness: 1, roughness: 0.4 }, texture: { kind: 'brushed', colors: ['#dadde1', '#b3b7bc'] } },
  { id: 'iron', name: 'Cast iron', category: 'metal', about: 'Dark, rough cast iron', type: std, settings: { color: '#4b4c4e', metalness: 1, roughness: 0.75 } },
  { id: 'gold', name: 'Gold', category: 'metal', about: 'Polished yellow gold', type: std, settings: { color: '#ffc356', metalness: 1, roughness: 0.15 } },
  { id: 'silver', name: 'Silver', category: 'metal', about: 'Polished silver', type: std, settings: { color: '#f2f2f0', metalness: 1, roughness: 0.12 } },
  { id: 'copper', name: 'Copper', category: 'metal', about: 'Polished copper', type: std, settings: { color: '#f2a07a', metalness: 1, roughness: 0.2 } },
  { id: 'brass', name: 'Brass', category: 'metal', about: 'Satin brass', type: std, settings: { color: '#e6c06e', metalness: 1, roughness: 0.28 } },
  { id: 'bronze', name: 'Bronze', category: 'metal', about: 'Aged bronze', type: std, settings: { color: '#b07a45', metalness: 1, roughness: 0.4 } },
  { id: 'titanium', name: 'Titanium', category: 'metal', about: 'Grey titanium, satin', type: std, settings: { color: '#b4b2ad', metalness: 1, roughness: 0.32 } },

  // Glass: transmission, by index of refraction and tint.
  { id: 'glass-clear', name: 'Clear glass', category: 'glass', about: 'Window glass', type: phys, settings: { color: '#ffffff', roughness: 0, transmission: 1, ior: 1.5, thickness: 0.2 } },
  { id: 'glass-frosted', name: 'Frosted glass', category: 'glass', about: 'Sand-blasted, diffusing glass', type: phys, settings: { color: '#ffffff', roughness: 0.45, transmission: 1, ior: 1.5, thickness: 0.3 } },
  { id: 'glass-green', name: 'Green glass', category: 'glass', about: 'Bottle-green glass', type: phys, settings: { color: '#ffffff', roughness: 0, transmission: 1, ior: 1.52, thickness: 0.5, attenuationColor: '#3f9a52', attenuationDistance: 0.4 } },
  { id: 'glass-blue', name: 'Blue glass', category: 'glass', about: 'Cobalt-tinted glass', type: phys, settings: { color: '#ffffff', roughness: 0, transmission: 1, ior: 1.52, thickness: 0.5, attenuationColor: '#2d5bd1', attenuationDistance: 0.4 } },
  { id: 'glass-amber', name: 'Amber glass', category: 'glass', about: 'Brown amber glass', type: phys, settings: { color: '#ffffff', roughness: 0, transmission: 1, ior: 1.52, thickness: 0.5, attenuationColor: '#c26a12', attenuationDistance: 0.35 } },
  { id: 'crystal', name: 'Crystal', category: 'glass', about: 'Lead crystal, splitting light into colours', type: phys, settings: { color: '#ffffff', roughness: 0, transmission: 1, ior: 1.7, thickness: 0.6, dispersion: 3 } },
  { id: 'diamond', name: 'Diamond', category: 'glass', about: 'As high an index as three.js takes', type: phys, settings: { color: '#ffffff', roughness: 0, transmission: 1, ior: 2.333, thickness: 0.8, dispersion: 5 } },
  { id: 'water', name: 'Water', category: 'glass', about: 'Clear water', type: phys, settings: { color: '#ffffff', roughness: 0.02, transmission: 1, ior: 1.333, thickness: 1, attenuationColor: '#bfe6f0', attenuationDistance: 2 } },

  // Plastic and rubber.
  { id: 'plastic-white', name: 'White plastic', category: 'plastic', about: 'Glossy white plastic', type: phys, settings: { color: '#f4f4f2', roughness: 0.25, clearcoat: 0.3 } },
  { id: 'plastic-black', name: 'Black plastic', category: 'plastic', about: 'Glossy black plastic', type: phys, settings: { color: '#151515', roughness: 0.22, clearcoat: 0.4 } },
  { id: 'plastic-red', name: 'Red plastic', category: 'plastic', about: 'Glossy red plastic, as a toy brick', type: phys, settings: { color: '#c8201c', roughness: 0.2, clearcoat: 0.5 } },
  { id: 'plastic-yellow', name: 'Yellow ABS', category: 'plastic', about: 'Satin yellow ABS', type: std, settings: { color: '#f2c218', roughness: 0.45 } },
  { id: 'plastic-matte', name: 'Matt grey plastic', category: 'plastic', about: 'Textured, matt grey', type: std, settings: { color: '#7c7f84', roughness: 0.85 } },
  { id: 'acrylic', name: 'Clear acrylic', category: 'plastic', about: 'Transparent acrylic, as Perspex', type: phys, settings: { color: '#ffffff', roughness: 0.05, transmission: 1, ior: 1.49, thickness: 0.3 } },
  { id: 'rubber', name: 'Black rubber', category: 'plastic', about: 'Matt black rubber', type: std, settings: { color: '#1d1d1f', roughness: 0.95 } },
  { id: 'silicone', name: 'Blue silicone', category: 'plastic', about: 'Soft, satin silicone', type: phys, settings: { color: '#3a8fd8', roughness: 0.55, sheen: 0.3, sheenColor: '#bfe0ff' } },

  // Stone and concrete.
  { id: 'marble-white', name: 'White marble', category: 'stone', about: 'Polished Carrara marble', type: phys, settings: { roughness: 0.15, clearcoat: 0.6 }, texture: { kind: 'marble', colors: ['#ecebe7', '#8f9296'] } },
  { id: 'marble-black', name: 'Black marble', category: 'stone', about: 'Polished black marble, white veins', type: phys, settings: { roughness: 0.12, clearcoat: 0.7 }, texture: { kind: 'marble', colors: ['#1e1f22', '#d6d6d2'] } },
  { id: 'granite', name: 'Granite', category: 'stone', about: 'Speckled grey granite', type: std, settings: { roughness: 0.4 }, texture: { kind: 'granite', colors: ['#9a9893', '#2e2d2b', '#e8e4dc'] } },
  { id: 'concrete', name: 'Concrete', category: 'stone', about: 'Cast concrete', type: std, settings: { roughness: 0.9 }, texture: { kind: 'concrete', colors: ['#a8a59f', '#7f7c76'] } },
  { id: 'terrazzo', name: 'Terrazzo', category: 'stone', about: 'Chips of stone in a pale base', type: std, settings: { roughness: 0.3 }, texture: { kind: 'terrazzo', colors: ['#e6e1d8', '#a74a3c', '#5b6b78', '#2f2f2f'] } },
  { id: 'slate', name: 'Slate', category: 'stone', about: 'Dark grey slate', type: std, settings: { roughness: 0.7 }, texture: { kind: 'concrete', colors: ['#4c5257', '#33383c'], repeat: 3 } },

  // Fabric and leather.
  { id: 'cotton', name: 'Cotton', category: 'fabric', about: 'Off-white woven cotton', type: phys, settings: { roughness: 0.9, sheen: 0.4, sheenRoughness: 0.8, sheenColor: '#ffffff' }, texture: { kind: 'weave', colors: ['#ebe6dc', '#cfc8ba'], repeat: 8 } },
  { id: 'denim', name: 'Denim', category: 'fabric', about: 'Blue denim twill', type: phys, settings: { roughness: 0.85, sheen: 0.3, sheenColor: '#9bb4d8' }, texture: { kind: 'weave', colors: ['#3b5a8a', '#d9dde6'], repeat: 10 } },
  { id: 'velvet', name: 'Red velvet', category: 'fabric', about: 'Deep red velvet', type: phys, settings: { color: '#7d0f1d', roughness: 0.9, sheen: 1, sheenRoughness: 0.4, sheenColor: '#ff6b7f' } },
  { id: 'felt', name: 'Grey felt', category: 'fabric', about: 'Soft grey felt', type: phys, settings: { roughness: 1, sheen: 0.6, sheenRoughness: 0.9, sheenColor: '#d0d0d0' }, texture: { kind: 'concrete', colors: ['#77797d', '#686a6e'], repeat: 4 } },
  { id: 'leather-brown', name: 'Brown leather', category: 'fabric', about: 'Grained brown leather', type: phys, settings: { roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.4 }, texture: { kind: 'leather', colors: ['#6a3d22', '#4a2915'], repeat: 3 } },
  { id: 'leather-black', name: 'Black leather', category: 'fabric', about: 'Grained black leather', type: phys, settings: { roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.35 }, texture: { kind: 'leather', colors: ['#242222', '#121111'], repeat: 3 } },

  // Ceramic and paint.
  { id: 'porcelain', name: 'Porcelain', category: 'ceramic', about: 'Glazed white porcelain', type: phys, settings: { color: '#f7f6f2', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 } },
  { id: 'terracotta', name: 'Terracotta', category: 'ceramic', about: 'Unglazed fired clay', type: std, settings: { roughness: 0.95 }, texture: { kind: 'concrete', colors: ['#b8613a', '#9c4e2c'], repeat: 2 } },
  { id: 'car-paint-red', name: 'Red car paint', category: 'ceramic', about: 'Metallic red under a clear coat', type: phys, settings: { color: '#a30d14', metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03 } },
  { id: 'car-paint-blue', name: 'Blue car paint', category: 'ceramic', about: 'Metallic blue under a clear coat', type: phys, settings: { color: '#123c8f', metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03 } },
  { id: 'pearl', name: 'Pearl paint', category: 'ceramic', about: 'Iridescent pearl white', type: phys, settings: { color: '#f2efe9', roughness: 0.25, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6 } },
  { id: 'paint-matte', name: 'Matt white paint', category: 'ceramic', about: 'Flat wall paint', type: std, settings: { color: '#ecebe6', roughness: 0.95 } },
  { id: 'paint-gloss-black', name: 'Gloss black paint', category: 'ceramic', about: 'Piano black', type: phys, settings: { color: '#0b0b0c', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02 } },
];

/** The type of the data a library material is dragged with. */
export const LIBRARY_MIME = 'application/x-library-material';

/** The library material being dragged, if any: drop targets can't read it until the drop. */
export const libraryDrag: { id: string | null } = { id: null };

export function libraryEntry(id: string): LibraryMaterial | undefined {
  return MATERIAL_LIBRARY.find(m => m.id === id);
}

/** The library entry a material was made from, if any. */
export function libraryIdOf(m: THREE.Material | undefined): string | null {
  return (m?.userData['library'] as string | undefined) ?? null;
}

/** A new material made from a library entry, named after it. */
export function makeLibraryMaterial(entry: LibraryMaterial): THREE.Material {
  const material = MATERIAL_TYPES.find(t => t.type === entry.type)!.make();
  material.name = entry.name;
  material.userData['library'] = entry.id;
  for (const [key, value] of Object.entries(entry.settings)) {
    const field = MATERIAL_FIELDS.find(f => f.key === key);
    if (field) writeField(material, field, value);
  }
  if (entry.texture) {
    const m = material as THREE.MeshStandardMaterial;
    m.map = libraryTexture(entry);
    // The texture has the colour.
    if (!('color' in entry.settings)) m.color.set('#ffffff');
  }
  return material;
}

// ------------------------------------------------------------ textures

const SIZE = 256;
const textures = new Map<string, THREE.DataTexture>();

/** The texture of a library entry, made the first time it is needed and shared after. */
export function libraryTexture(entry: LibraryMaterial): THREE.DataTexture | null {
  if (!entry.texture) return null;
  let t = textures.get(entry.id);
  if (!t) {
    const data = paint(entry.texture, hash(entry.id));
    t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const r = entry.texture.repeat ?? 2;
    t.repeat.set(r, r);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.name = entry.name;
    t.needsUpdate = true;
    textures.set(entry.id, t);
  }
  return t;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Tiling value noise on a `period` x `period` lattice, from a seed. */
function makeNoise(seed: number, period: number): (x: number, y: number) => number {
  const values = new Float32Array(period * period);
  let s = seed || 1;
  for (let i = 0; i < values.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    values[i] = ((s >>> 0) % 10000) / 10000;
  }
  const at = (ix: number, iy: number) => values[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Several octaves of tiling noise, 0 to 1; x and y from 0 to 1 across the texture. */
function makeFbm(seed: number, base: number, octaves = 4): (x: number, y: number) => number {
  const layers = Array.from({ length: octaves }, (_, i) => ({ n: makeNoise(seed + i * 7919, base << i), f: base << i, a: 0.5 ** i }));
  const total = layers.reduce((t, l) => t + l.a, 0);
  return (x, y) => layers.reduce((t, l) => t + l.n(x * l.f, y * l.f) * l.a, 0) / total;
}

/** A #rrggbb colour as sRGB components, 0 to 1, as the texture holds them. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (t: number) => Math.min(Math.max(t, 0), 1);
const smooth = (e0: number, e1: number, t: number) => {
  const x = clamp((t - e0) / (e1 - e0));
  return x * x * (3 - 2 * x);
};

/** RGBA pixels of a tiling texture. */
function paint(tex: LibraryTexture, seed: number): Uint8Array {
  const cols = tex.colors.map(rgb);
  const [c0, c1] = cols;
  const out = new Uint8Array(SIZE * SIZE * 4);
  const big = makeFbm(seed, 4);
  const fine = makeFbm(seed + 101, 32, 3);
  const streak = makeNoise(seed + 303, 256);
  let shade: (u: number, v: number) => number[];
  switch (tex.kind) {
    case 'wood':
      // Growth rings across u, warped along v, with fine grain.
      shade = (u, v) => {
        const rings = (u * 6 + big(u, v * 0.25) * 3) % 1;
        const ring = smooth(0.55, 0.95, rings) * 0.8 + fine(u * 0.25, v) * 0.35;
        return mix(c0, c1, clamp(ring));
      };
      break;
    case 'marble':
      shade = (u, v) => {
        const t = Math.abs(Math.sin((u + v) * Math.PI * 4 + big(u, v) * 9));
        const vein = 1 - smooth(0.0, 0.22, t);
        return mix(mix(c0, c1, fine(u, v) * 0.12), c1, vein * 0.85);
      };
      break;
    case 'brushed':
      // Streaks along u.
      shade = (u, v) => mix(c0, c1, clamp(streak(u * 4, v * 256) * 0.6 + fine(u, v) * 0.4));
      break;
    case 'granite':
      shade = (u, v) => {
        const n = fine(u * 4, v * 4);
        const base = mix(c0, cols[2] ?? c0, big(u, v) * 0.3);
        return n > 0.62 ? c1 : n < 0.3 ? mix(base, cols[2] ?? c0, 0.6) : base;
      };
      break;
    case 'concrete':
      shade = (u, v) => {
        const pit = fine(u * 4, v * 4) < 0.2 ? 0.5 : 0;
        return mix(c0, c1, clamp(big(u, v) * 0.7 + fine(u, v) * 0.5 - 0.25 + pit));
      };
      break;
    case 'weave': {
      // Threads over and under, in a twill.
      const threads = 32;
      shade = (u, v) => {
        const x = u * threads;
        const y = v * threads;
        const over = (Math.floor(x) + Math.floor(y)) % 2 === 0;
        const along = over ? x % 1 : y % 1;
        const round = Math.sin(along * Math.PI);
        const col = over ? c0 : mix(c0, c1, 0.6);
        return mix([0, 0, 0], col, 0.75 + 0.25 * round - fine(u, v) * 0.15);
      };
      break;
    }
    case 'leather':
      shade = (u, v) => {
        const crease = Math.abs(fine(u * 2, v * 2) - 0.5) < 0.03 ? 1 : 0;
        return mix(c0, c1, clamp(big(u, v) * 0.5 + crease * 0.6));
      };
      break;
    case 'terrazzo':
      shade = (u, v) => {
        const n = fine(u * 2, v * 2);
        const chip = makeChip(n);
        return chip ? cols[chip] ?? c1 : mix(c0, c1, big(u, v) * 0.05);
      };
      break;
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = shade(x / SIZE, y / SIZE);
      const i = (y * SIZE + x) * 4;
      out[i] = Math.round(clamp(c[0]) * 255);
      out[i + 1] = Math.round(clamp(c[1]) * 255);
      out[i + 2] = Math.round(clamp(c[2]) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Which chip colour, if any, a noise value falls in, for terrazzo. */
function makeChip(n: number): number {
  if (n > 0.74) return 1;
  if (n < 0.2) return 2;
  if (n > 0.66 && n < 0.68) return 3;
  return 0;
}
