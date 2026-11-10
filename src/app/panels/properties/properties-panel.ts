import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import * as THREE from 'three';
import { channelInfo } from '../../core/bus/panel-bus';
import { PanelContext } from '../../core/panels/panel-context';
import { SceneDocument, isDocumentObject, kindOf, materialsOf } from '../../scene/scene-document';
import { DimensionName, dimensionsOf, editableShape, withDimension } from '../../scene/primitive-edit';
import { SOLID_OPERATIONS, SolidOperation, canBeOperand, isSolid, isSolidResult, solidOf, solidOperation, solidResult } from '../../scene/solids';

type Vec = [number, number, number];

interface Props {
  id: string;
  name: string;
  kind: string;
  type: string;
  visible: boolean;
  position: Vec;
  rotation: Vec;
  scale: Vec;
  material: { color: string; roughness: number | null; metalness: number | null; opacity: number; wireframe: boolean } | null;
  light: LightProps | null;
  geometry: { vertices: number; triangles: number } | null;
  /** A primitive's sizes, before its scale. */
  dimensions: { name: DimensionName; label: string; value: number }[] | null;
  /** For a solid: its operation, how many operands it combines, and the result's size. */
  solid: { operation: SolidOperation; operands: number; triangles: number } | null;
  /** For an operand of a solid: which solid, and its place among the operands. */
  operand: { solidId: string; solid: string; index: number; count: number; role: string } | null;
  children: number;
  ifc: IfcInfo | null;
  step: { label: string; value: string }[] | null;
}

/** A light's settings; those its kind doesn't have are left out. Angles in degrees. */
interface LightProps {
  kind: string;
  /** What the light is, in a few words. */
  about: string;
  color: string;
  intensity: number;
  groundColor?: string;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  width?: number;
  height?: number;
  castShadow?: boolean;
  /** The point it is aimed at, in world coordinates. */
  target?: Vec;
  /** Whether the ray tracer draws it. */
  traced: boolean;
}

/** What MeerCADIFCImport puts in an object's userData.ifc, formatted for display. */
interface IfcInfo {
  rows: { label: string; value: string }[];
  sets: { name: string; rows: { label: string; value: string }[] }[];
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/** The selected object's name, transform and material, for editing. */
@Component({
  selector: 'app-properties-panel',
  host: { class: 'properties-panel' },
  template: `
    <div class="panel-caption">
      <span class="channel-chip" [style.background]="channel().color"></span>
      Selection on {{ channel().label }}
    </div>
    @if (props(); as p) {
      <form class="props" (submit)="$event.preventDefault()">
        <fieldset>
          <legend>Object</legend>
          <label class="field">
            <span>Name</span>
            <input class="input" [value]="p.name" (change)="doc.rename(p.id, value($event))" />
          </label>
          <div class="field"><span>Type</span><span class="readonly">{{ p.type }}</span></div>
          <label class="field">
            <span>Visible</span>
            <input type="checkbox" [checked]="p.visible" (change)="doc.setVisible([p.id], checked($event))" />
          </label>
          @if (p.geometry; as g) {
            <div class="field"><span>Geometry</span><span class="readonly">{{ g.vertices | number }} vertices, {{ g.triangles }} triangles</span></div>
          }
          @if (p.children) {
            <div class="field"><span>Children</span><span class="readonly">{{ p.children }}</span></div>
          }
        </fieldset>

        <fieldset>
          <legend>Transform</legend>
          @for (row of transformRows; track row.key) {
            <div class="field vec">
              <span>{{ row.label }}</span>
              @for (axis of axes; track axis) {
                <input
                  class="input num"
                  type="number"
                  [step]="row.step"
                  [attr.aria-label]="row.label + ' ' + axisNames[axis]"
                  [value]="p[row.key][axis]"
                  (change)="setVec(p, row.key, axis, $event)" />
              }
            </div>
          }
        </fieldset>

        @if (p.solid; as sol) {
          <fieldset>
            <legend>Solid</legend>
            <label class="field">
              <span>Operation</span>
              <select class="input" [value]="sol.operation" (change)="doc.setOperation(p.id, $any(value($event)))">
                @for (o of operations; track o.op) {
                  <option [value]="o.op" [selected]="o.op === sol.operation">{{ o.icon }} {{ o.label }}</option>
                }
              </select>
            </label>
            <div class="field"><span>Operands</span><span class="readonly">{{ sol.operands }}{{ sol.operation === 'subtract' && sol.operands ? ', the first cut by the rest' : '' }}</span></div>
            <div class="field"><span>Result</span><span class="readonly">{{ sol.triangles | number }} triangles</span></div>
          </fieldset>
        }

        @if (p.operand; as op) {
          <fieldset>
            <legend>Operand</legend>
            <div class="field"><span>Of</span><span class="readonly">{{ op.solid }}</span></div>
            <div class="field"><span>Place</span><span class="readonly">{{ op.index + 1 }} of {{ op.count }} · {{ op.role }}</span></div>
            <div class="field">
              <span>Order</span>
              <span>
                <button type="button" class="btn" [disabled]="op.index === 0" (click)="doc.moveInOrder(p.id, -1)">↑ Earlier</button>
                <button type="button" class="btn" [disabled]="op.index === op.count - 1" (click)="doc.moveInOrder(p.id, 1)">↓ Later</button>
              </span>
            </div>
          </fieldset>
        }

        @if (p.dimensions; as dims) {
          <fieldset>
            <legend title="The shape's own sizes, before its scale. Drag a face, edge or corner in a 3D view to change them there.">Dimensions</legend>
            @for (d of dims; track d.name) {
              <label class="field">
                <span>{{ d.label }}</span>
                <input class="input num" type="number" min="0" step="0.1" [value]="d.value" (change)="setDimension(p, d.name, $event)" />
              </label>
            }
          </fieldset>
        }

        @if (p.ifc; as ifc) {
          <fieldset class="ifc-props">
            <legend>IFC</legend>
            @for (row of ifc.rows; track row.label) {
              <div class="field"><span>{{ row.label }}</span><span class="value" [title]="row.value">{{ row.value }}</span></div>
            }
            @for (set of ifc.sets; track set.name) {
              <details>
                <summary>{{ set.name }} <span class="hint">{{ set.rows.length }}</span></summary>
                @for (row of set.rows; track row.label) {
                  <div class="field"><span [title]="row.label">{{ row.label }}</span><span class="value" [title]="row.value">{{ row.value }}</span></div>
                }
              </details>
            }
          </fieldset>
        }

        @if (p.step; as rows) {
          <fieldset class="ifc-props">
            <legend>STEP</legend>
            @for (row of rows; track row.label) {
              <div class="field"><span>{{ row.label }}</span><span class="value" [title]="row.value">{{ row.value }}</span></div>
            }
          </fieldset>
        }

        @if (p.material; as m) {
          <fieldset>
            <legend>Material</legend>
            <label class="field">
              <span>Colour</span>
              <input type="color" [value]="m.color" (input)="doc.setMaterial([p.id], { color: value($event) })" />
            </label>
            @if (m.roughness !== null) {
              <label class="field">
                <span>Roughness</span>
                <input type="range" min="0" max="1" step="0.01" [value]="m.roughness" (input)="doc.setMaterial([p.id], { roughness: num($event) })" />
              </label>
              <label class="field">
                <span>Metalness</span>
                <input type="range" min="0" max="1" step="0.01" [value]="m.metalness" (input)="doc.setMaterial([p.id], { metalness: num($event) })" />
              </label>
            }
            <label class="field">
              <span>Opacity</span>
              <input type="range" min="0.05" max="1" step="0.01" [value]="m.opacity" (input)="doc.setMaterial([p.id], { opacity: num($event) })" />
            </label>
            <label class="field">
              <span>Wireframe</span>
              <input type="checkbox" [checked]="m.wireframe" (change)="doc.setMaterial([p.id], { wireframe: checked($event) })" />
            </label>
          </fieldset>
        }

        @if (p.light; as l) {
          <fieldset>
            <legend>Light</legend>
            <div class="field"><span>Kind</span><span class="readonly" [title]="l.about">{{ l.kind }}</span></div>
            <label class="field">
              <span>{{ l.groundColor !== undefined ? 'Sky colour' : 'Colour' }}</span>
              <input type="color" [value]="l.color" (input)="doc.setLight([p.id], { color: value($event) })" />
            </label>
            @if (l.groundColor !== undefined) {
              <label class="field">
                <span>Ground colour</span>
                <input type="color" [value]="l.groundColor" (input)="doc.setLight([p.id], { groundColor: value($event) })" />
              </label>
            }
            <label class="field">
              <span>Intensity</span>
              <input class="input num" type="number" min="0" step="0.1" [value]="l.intensity" (change)="doc.setLight([p.id], { intensity: num($event) })" />
            </label>
            @if (l.distance !== undefined) {
              <label class="field" title="How far the light reaches; 0 for no limit, falling off by the decay">
                <span>Distance</span>
                <input class="input num" type="number" min="0" step="0.5" [value]="l.distance" (change)="doc.setLight([p.id], { distance: num($event) })" />
              </label>
              <label class="field" title="How the light falls off with distance; 2 is physically correct">
                <span>Decay</span>
                <input class="input num" type="number" min="0" max="10" step="0.1" [value]="l.decay" (change)="doc.setLight([p.id], { decay: num($event) })" />
              </label>
            }
            @if (l.angle !== undefined) {
              <label class="field" title="Half the cone's opening, from its axis, in degrees">
                <span>Cone angle °</span>
                <input class="input num" type="number" min="0.5" max="90" step="1" [value]="l.angle" (change)="doc.setLight([p.id], { angle: num($event) })" />
              </label>
              <label class="field" title="How soft the cone's edge is: 0 sharp, 1 soft all the way">
                <span>Penumbra</span>
                <input type="range" min="0" max="1" step="0.01" [value]="l.penumbra" (input)="doc.setLight([p.id], { penumbra: num($event) })" />
              </label>
            }
            @if (l.width !== undefined) {
              <label class="field">
                <span>Width</span>
                <input class="input num" type="number" min="0.001" step="0.1" [value]="l.width" (change)="doc.setLight([p.id], { width: num($event) })" />
              </label>
              <label class="field">
                <span>Height</span>
                <input class="input num" type="number" min="0.001" step="0.1" [value]="l.height" (change)="doc.setLight([p.id], { height: num($event) })" />
              </label>
            }
            @if (l.target; as t) {
              <div class="field vec" title="The point the light shines at, in the world. Drag its handle in a 3D view to aim it.">
                <span>Aim at</span>
                @for (axis of axes; track axis) {
                  <input
                    class="input num"
                    type="number"
                    step="0.1"
                    [attr.aria-label]="'Aim at ' + axisNames[axis]"
                    [value]="t[axis]"
                    (change)="setTarget(p.id, t, axis, $event)" />
                }
              </div>
            }
            @if (l.castShadow !== undefined) {
              <label class="field">
                <span>Cast shadows</span>
                <input type="checkbox" [checked]="l.castShadow" (change)="doc.setLight([p.id], { castShadow: checked($event) })" />
              </label>
            }
            @if (!l.traced) {
              <p class="hint">Ray tracing leaves this kind of light out.</p>
            }
          </fieldset>
        }
      </form>
    } @else if (count() > 1) {
      <div class="panel-empty">
        <p>{{ count() }} objects selected.</p>
        <button type="button" class="btn" (click)="doc.setVisible(ids(), true)">Show all</button>
        <button type="button" class="btn" (click)="doc.setVisible(ids(), false)">Hide all</button>
      </div>
    } @else {
      <div class="panel-empty">Select an object in a 3D view or the scene tree on {{ channel().label }}.</div>
    }
  `,
  imports: [DecimalPipe],
})
export class PropertiesPanel {
  private readonly panel = inject(PanelContext);
  protected readonly doc = inject(SceneDocument);
  protected readonly channel = computed(() => channelInfo(this.panel.channel()));

  private readonly selection = this.panel.retained('selection');
  /** Selected objects still in the scene; rechecked as the scene changes. */
  protected readonly ids = computed(() => {
    this.doc.revision();
    return this.doc.objects(this.selection()?.ids).map(o => o.uuid);
  });
  protected readonly count = computed(() => this.ids().length);

  protected readonly operations = SOLID_OPERATIONS;
  protected readonly axes = [0, 1, 2] as const;
  protected readonly axisNames = ['X', 'Y', 'Z'];
  protected readonly transformRows = [
    { key: 'position', label: 'Position', step: 0.1 },
    { key: 'rotation', label: 'Rotation °', step: 5 },
    { key: 'scale', label: 'Scale', step: 0.1 },
  ] as const;

  protected readonly props = computed<Props | null>(() => {
    this.doc.revision();
    const ids = this.ids();
    if (ids.length !== 1) return null;
    const o = this.doc.get(ids[0]);
    if (!o) return null;
    // A solid's material is its operands'; the first stands for them all.
    const firstOperand = isSolid(o) ? operandMeshes(o)[0] : undefined;
    const mats = materialsOf(firstOperand ?? o);
    const m = mats[0] as THREE.MeshStandardMaterial | undefined;
    const light = (o as THREE.Light).isLight ? (o as THREE.Light) : null;
    const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    return {
      id: o.uuid,
      name: o.name,
      kind: kindOf(o),
      type: o.type,
      visible: o.visible,
      position: o.position.toArray().map(v => round(v)) as Vec,
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z].map(v => round(THREE.MathUtils.radToDeg(v), 2)) as Vec,
      scale: o.scale.toArray().map(v => round(v)) as Vec,
      material: m
        ? {
            color: m.color ? `#${m.color.getHexString()}` : '#ffffff',
            roughness: m instanceof THREE.MeshStandardMaterial ? m.roughness : null,
            metalness: m instanceof THREE.MeshStandardMaterial ? m.metalness : null,
            opacity: m.opacity,
            wireframe: !!m.wireframe,
          }
        : null,
      light: light ? lightProps(light) : null,
      geometry: geo?.attributes?.['position']
        ? {
            vertices: geo.attributes['position'].count,
            triangles: Math.round((geo.index ? geo.index.count : geo.attributes['position'].count) / 3),
          }
        : null,
      dimensions: (() => {
        const shape = editableShape(o);
        return shape ? dimensionsOf(shape).map(d => ({ ...d, value: round(d.value) })) : null;
      })(),
      solid: isSolid(o)
        ? {
            operation: solidOperation(o) ?? 'union',
            operands: o.children.filter(c => !isSolidResult(c) && canBeOperand(c)).length,
            triangles: triangles(solidResult(o)?.geometry),
          }
        : null,
      operand: (() => {
        const sol = solidOf(o);
        if (!sol || o.parent !== sol) return null;
        const list = sol.children.filter(c => !isSolidResult(c) && isDocumentObject(c));
        const index = list.indexOf(o);
        const op = solidOperation(sol) ?? 'union';
        const role = !o.visible
          ? 'hidden, left out'
          : !canBeOperand(o)
            ? 'not a closed shape, left out'
            : op === 'subtract'
              ? index === 0
                ? 'cut from'
                : 'cut away'
              : op === 'intersect'
                ? 'intersected'
                : 'joined';
        return { solidId: sol.uuid, solid: sol.name, index, count: list.length, role };
      })(),
      children: o.children.filter(isDocumentObject).length,
      ifc: ifcInfo(o.userData['ifc']),
      step: stepInfo(o.userData['step']),
    };
  });

  protected setVec(p: Props, key: 'position' | 'rotation' | 'scale', axis: number, event: Event): void {
    const v = this.num(event);
    if (!Number.isFinite(v)) return;
    const vec = [...p[key]] as Vec;
    vec[axis] = v;
    this.doc.setTransform(p.id, { [key]: vec });
  }

  /** Sets a size of a primitive, keeping its centre; a size it can't take is put back. */
  protected setDimension(p: Props, name: DimensionName, event: Event): void {
    const o = this.doc.get(p.id);
    const shape = o && editableShape(o);
    const params = shape && withDimension(shape, name, this.num(event));
    if (params) this.doc.setShape(p.id, params);
    else {
      const d = p.dimensions?.find(x => x.name === name);
      if (d) (event.target as HTMLInputElement).value = String(d.value);
    }
  }

  /** Aims a light: one coordinate of the point it shines at. */
  protected setTarget(id: string, target: Vec, axis: number, event: Event): void {
    const v = this.num(event);
    if (!Number.isFinite(v)) return;
    const t = [...target] as Vec;
    t[axis] = v;
    this.doc.setLight([id], { target: t });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected num(event: Event): number {
    return parseFloat((event.target as HTMLInputElement).value);
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}

const LIGHT_ABOUT: Record<string, [string, string]> = {
  AmbientLight: ['Ambient', 'The same light from every way, without shadows or a position'],
  HemisphereLight: ['Hemisphere', 'Sky colour from above, ground colour from below; its position sets which way is up'],
  DirectionalLight: ['Directional', 'Parallel rays, like the sun, from its position towards its target'],
  PointLight: ['Point', 'Light from one point every way, like a bulb'],
  SpotLight: ['Spot', 'A cone of light from its position towards its target'],
  RectAreaLight: ['Area', 'Light from a rectangle, facing along its -Z axis, like a window; for standard and physical materials'],
};

/** A light's settings, for the panel. */
function lightProps(light: THREE.Light): LightProps {
  const l = light as THREE.Light &
    Partial<THREE.SpotLight & THREE.RectAreaLight & THREE.HemisphereLight & THREE.PointLight & THREE.DirectionalLight>;
  const [kind, about] = LIGHT_ABOUT[light.type] ?? [light.type, light.type];
  const out: LightProps = {
    kind,
    about,
    color: `#${light.color.getHexString()}`,
    intensity: round(light.intensity, 3),
    traced: light.type !== 'RectAreaLight',
  };
  if (l.isHemisphereLight && l.groundColor) out.groundColor = `#${l.groundColor.getHexString()}`;
  if (l.isPointLight || l.isSpotLight) {
    out.distance = round(l.distance ?? 0, 3);
    out.decay = round(l.decay ?? 2, 3);
  }
  if (l.isSpotLight) {
    out.angle = round(THREE.MathUtils.radToDeg(l.angle ?? 0), 2);
    out.penumbra = round(l.penumbra ?? 0, 3);
  }
  if (l.isRectAreaLight) {
    out.width = round(l.width ?? 1, 4);
    out.height = round(l.height ?? 1, 4);
  }
  if (l.isDirectionalLight || l.isPointLight || l.isSpotLight) out.castShadow = light.castShadow;
  if ((l.isDirectionalLight || l.isSpotLight) && l.target) {
    l.target.updateWorldMatrix(true, false);
    out.target = l.target.getWorldPosition(new THREE.Vector3()).toArray().map(v => round(v)) as Vec;
  }
  return out;
}

/** The meshes a solid is made of, at any depth, without results. */
function operandMeshes(solid: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  solid.traverse(c => {
    if ((c as THREE.Mesh).isMesh && !isSolidResult(c)) out.push(c as THREE.Mesh);
  });
  return out;
}

function triangles(g: THREE.BufferGeometry | undefined): number {
  const pos = g?.getAttribute('position');
  if (!g || !pos) return 0;
  return Math.round((g.index ? g.index.count : pos.count) / 3);
}

/** The IFC data an imported object carries, as label and value rows. */
function ifcInfo(data: unknown): IfcInfo | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => {
    const v = format(value);
    if (v) rows.push({ label, value: v });
  };
  add('Entity', d['type']);
  add('Express ID', typeof d['expressId'] === 'number' ? `#${d['expressId']}` : null);
  add('GlobalId', d['globalId']);
  add('Name', d['name']);
  add('Description', d['description']);
  add('Object type', d['objectType']);
  add('Type object', d['typeObject']);
  add('Materials', Array.isArray(d['materials']) ? d['materials'].join(', ') : null);
  const props = (d['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  const sets = Object.entries(props).map(([name, values]) => ({
    name,
    rows: Object.entries(values ?? {}).map(([label, value]) => ({ label, value: format(value) || '—' })),
  }));
  return { rows, sets };
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(round(value, 4));
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const STEP_KINDS: Record<string, string> = { product: 'Part or assembly', instance: 'Placed instance', shape: 'Shape' };

/** What MeerCADStepImport puts in an object's userData.step, as label and value rows. */
function stepInfo(data: unknown): { label: string; value: string }[] | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => {
    const v = format(value);
    if (v) rows.push({ label, value: v });
  };
  add('Kind', STEP_KINDS[String(d['kind'])] ?? d['kind']);
  add('Product', d['productName']);
  add('Product ID', d['productId']);
  add('Description', d['description']);
  add('Shape item', d['itemType']);
  add('Item', typeof d['itemId'] === 'number' ? `#${d['itemId']}` : null);
  add('Style', typeof d['style'] === 'object' && d['style'] ? (d['style'] as { name?: string }).name : d['style']);
  add('Definition', typeof d['productDefinition'] === 'number' ? `#${d['productDefinition']}` : null);
  add('Occurrence', typeof d['occurrence'] === 'number' ? `#${d['occurrence']}` : null);
  return rows;
}
