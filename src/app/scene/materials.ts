import * as THREE from 'three';

/**
 * Materials as three.js has them for meshes, and their settings, for editing. The properties panel
 * shows the settings a material has, in groups, from `MATERIAL_FIELDS`; changing its type keeps the
 * settings the old and new types share.
 */

export interface MaterialType {
  type: string;
  label: string;
  about: string;
  make(): THREE.Material;
}

export const MATERIAL_TYPES: MaterialType[] = [
  { type: 'MeshBasicMaterial', label: 'Basic', about: 'Its colour as it is, without lighting', make: () => new THREE.MeshBasicMaterial() },
  { type: 'MeshLambertMaterial', label: 'Lambert', about: 'Matt: lit, without highlights', make: () => new THREE.MeshLambertMaterial() },
  { type: 'MeshPhongMaterial', label: 'Phong', about: 'Shiny, with specular highlights', make: () => new THREE.MeshPhongMaterial() },
  {
    type: 'MeshStandardMaterial',
    label: 'Standard',
    about: 'Physically based, by roughness and metalness',
    make: () => new THREE.MeshStandardMaterial(),
  },
  {
    type: 'MeshPhysicalMaterial',
    label: 'Physical',
    about: 'Standard, with clear coat, sheen, iridescence, and transmission for glass',
    make: () => new THREE.MeshPhysicalMaterial(),
  },
  { type: 'MeshToonMaterial', label: 'Toon', about: 'Cartoon-like, in bands of light', make: () => new THREE.MeshToonMaterial() },
  { type: 'MeshNormalMaterial', label: 'Normal', about: 'Coloured by which way the surface faces', make: () => new THREE.MeshNormalMaterial() },
];

export type FieldKind = 'color' | 'slider' | 'number' | 'bool' | 'side';

export interface MaterialField {
  key: string;
  label: string;
  kind: FieldKind;
  group: string;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
  /** False where ray tracing leaves the setting out. */
  traced?: boolean;
  /** A number whose infinite value is shown, and typed, as 0. */
  zeroIsInfinite?: boolean;
}

/** The groups fields are shown in, in order; the first two start open. */
export const MATERIAL_GROUPS = ['Surface', 'Emission', 'Specular', 'Clear coat', 'Sheen', 'Iridescence', 'Transmission', 'Rendering'];

export const MATERIAL_FIELDS: MaterialField[] = [
  { key: 'color', label: 'Colour', kind: 'color', group: 'Surface' },
  { key: 'roughness', label: 'Roughness', kind: 'slider', group: 'Surface', min: 0, max: 1, step: 0.01, title: '0 mirror-smooth, 1 fully rough' },
  { key: 'metalness', label: 'Metalness', kind: 'slider', group: 'Surface', min: 0, max: 1, step: 0.01, title: '0 non-metal, 1 metal' },
  { key: 'specular', label: 'Specular colour', kind: 'color', group: 'Surface', title: 'The colour of highlights' },
  { key: 'shininess', label: 'Shininess', kind: 'number', group: 'Surface', min: 0, max: 1000, step: 5, title: 'How small and sharp highlights are' },

  { key: 'emissive', label: 'Emissive colour', kind: 'color', group: 'Emission', title: 'Light the surface gives off itself, whatever lights it' },
  { key: 'emissiveIntensity', label: 'Intensity', kind: 'number', group: 'Emission', min: 0, max: 100, step: 0.1 },

  { key: 'ior', label: 'Index of refraction', kind: 'number', group: 'Specular', min: 1, max: 2.333, step: 0.01, title: '1.5 for glass and plastics, 1.33 for water' },
  { key: 'specularIntensity', label: 'Specular intensity', kind: 'slider', group: 'Specular', min: 0, max: 1, step: 0.01 },
  { key: 'specularColor', label: 'Specular colour', kind: 'color', group: 'Specular' },
  { key: 'anisotropy', label: 'Anisotropy', kind: 'slider', group: 'Specular', min: 0, max: 1, step: 0.01, title: 'Stretched highlights, as on brushed metal', traced: false },

  { key: 'clearcoat', label: 'Clear coat', kind: 'slider', group: 'Clear coat', min: 0, max: 1, step: 0.01, title: 'A clear lacquer layer, as on car paint', traced: false },
  { key: 'clearcoatRoughness', label: 'Roughness', kind: 'slider', group: 'Clear coat', min: 0, max: 1, step: 0.01, traced: false },

  { key: 'sheen', label: 'Sheen', kind: 'slider', group: 'Sheen', min: 0, max: 1, step: 0.01, title: 'Soft glow at grazing angles, as on velvet', traced: false },
  { key: 'sheenRoughness', label: 'Roughness', kind: 'slider', group: 'Sheen', min: 0, max: 1, step: 0.01, traced: false },
  { key: 'sheenColor', label: 'Colour', kind: 'color', group: 'Sheen', traced: false },

  { key: 'iridescence', label: 'Iridescence', kind: 'slider', group: 'Iridescence', min: 0, max: 1, step: 0.01, title: 'Rainbow colours, as on soap bubbles', traced: false },
  { key: 'iridescenceIOR', label: 'Index of refraction', kind: 'number', group: 'Iridescence', min: 1, max: 2.333, step: 0.01, traced: false },

  { key: 'transmission', label: 'Transmission', kind: 'slider', group: 'Transmission', min: 0, max: 1, step: 0.01, title: 'How much light passes through, as glass' },
  { key: 'thickness', label: 'Thickness', kind: 'number', group: 'Transmission', min: 0, max: 1000, step: 0.05, title: 'How thick the volume is, for refraction and attenuation' },
  { key: 'attenuationColor', label: 'Attenuation colour', kind: 'color', group: 'Transmission', title: 'The colour light takes on through the volume' },
  {
    key: 'attenuationDistance',
    label: 'Attenuation distance',
    kind: 'number',
    group: 'Transmission',
    min: 0,
    max: 1e6,
    step: 0.1,
    title: 'How far light goes through before taking on that colour; 0 for never',
    zeroIsInfinite: true,
  },
  { key: 'dispersion', label: 'Dispersion', kind: 'number', group: 'Transmission', min: 0, max: 10, step: 0.1, title: 'Splitting light into colours, as a prism', traced: false },

  { key: 'opacity', label: 'Opacity', kind: 'slider', group: 'Rendering', min: 0, max: 1, step: 0.01, title: 'Takes effect when Transparent is on' },
  { key: 'transparent', label: 'Transparent', kind: 'bool', group: 'Rendering' },
  { key: 'alphaTest', label: 'Alpha test', kind: 'slider', group: 'Rendering', min: 0, max: 1, step: 0.01, title: 'Leaves out what is less opaque than this' },
  { key: 'side', label: 'Sides', kind: 'side', group: 'Rendering', title: 'Which sides of faces are drawn' },
  { key: 'flatShading', label: 'Flat shading', kind: 'bool', group: 'Rendering', title: 'Each face lit as one flat facet' },
  { key: 'wireframe', label: 'Wireframe', kind: 'bool', group: 'Rendering' },
  { key: 'depthTest', label: 'Depth test', kind: 'bool', group: 'Rendering', title: 'Hidden behind what is in front' },
  { key: 'depthWrite', label: 'Depth write', kind: 'bool', group: 'Rendering', title: 'Hides what is behind it' },
];

export const SIDES = [
  { value: THREE.FrontSide, label: 'Front' },
  { value: THREE.BackSide, label: 'Back' },
  { value: THREE.DoubleSide, label: 'Both' },
];

/** A material's type in the list, if it is one of them. */
export function materialType(m: THREE.Material): MaterialType | undefined {
  return MATERIAL_TYPES.find(t => t.type === m.type);
}

/** Whether a material is one of the mesh materials that can be edited and converted. */
export function isMeshMaterial(m: THREE.Material): boolean {
  return !!materialType(m);
}

/** The fields a material has. */
export function fieldsOf(m: THREE.Material): MaterialField[] {
  return MATERIAL_FIELDS.filter(f => f.key in m);
}

export type FieldValue = string | number | boolean;

/** A field's value, for an input: colours as #rrggbb, numbers rounded. */
export function readField(m: THREE.Material, f: MaterialField): FieldValue {
  const v = (m as unknown as Record<string, unknown>)[f.key];
  if (f.kind === 'color') return `#${(v as THREE.Color).getHexString()}`;
  if (f.kind === 'bool') return !!v;
  const n = v as number;
  if (f.zeroIsInfinite && !Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

/** Sets a field from an input's value, within its range. Returns whether it was set. */
export function writeField(m: THREE.Material, f: MaterialField, value: FieldValue): boolean {
  if (!(f.key in m)) return false;
  const target = m as unknown as Record<string, unknown>;
  switch (f.kind) {
    case 'color': {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return false;
      (target[f.key] as THREE.Color).set(value);
      break;
    }
    case 'bool':
      target[f.key] = !!value;
      break;
    case 'side': {
      const side = Number(value);
      if (!SIDES.some(s => s.value === side)) return false;
      target[f.key] = side;
      break;
    }
    default: {
      let n = Number(value);
      if (!Number.isFinite(n)) return false;
      n = Math.min(Math.max(n, f.min ?? -Infinity), f.max ?? Infinity);
      target[f.key] = f.zeroIsInfinite && n === 0 ? Infinity : n;
    }
  }
  // Some settings change the shader: let three.js check.
  m.needsUpdate = true;
  return true;
}

/** Texture slots carried over when a material changes type, where both types have them. */
const MAPS = ['map', 'alphaMap', 'aoMap', 'lightMap', 'emissiveMap', 'normalMap', 'bumpMap', 'displacementMap', 'roughnessMap', 'metalnessMap', 'specularMap', 'envMap'];

/** A new material of another type, with the settings and textures the two types share. */
export function convertMaterial(old: THREE.Material, type: string): THREE.Material | null {
  const t = MATERIAL_TYPES.find(x => x.type === type);
  if (!t) return null;
  const next = t.make();
  next.name = old.name;
  next.userData = { ...old.userData };
  const from = old as unknown as Record<string, unknown>;
  const to = next as unknown as Record<string, unknown>;
  for (const f of MATERIAL_FIELDS) {
    if (!(f.key in old) || !(f.key in next)) continue;
    if (f.kind === 'color') (to[f.key] as THREE.Color).copy(from[f.key] as THREE.Color);
    else to[f.key] = from[f.key];
  }
  for (const key of [...MAPS, 'vertexColors', 'normalScale']) {
    if (!(key in old) || !(key in next) || from[key] == null) continue;
    if (key === 'normalScale') (to[key] as THREE.Vector2).copy(from[key] as THREE.Vector2);
    else to[key] = from[key];
  }
  return next;
}
