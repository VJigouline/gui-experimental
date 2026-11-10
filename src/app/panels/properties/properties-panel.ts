import { Component, computed, inject, linkedSignal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import * as THREE from 'three';
import { channelInfo } from '../../core/bus/panel-bus';
import { PanelContext } from '../../core/panels/panel-context';
import { SceneDocument, isDocumentObject, kindOf, materialsOf } from '../../scene/scene-document';
import { FieldValue, MATERIAL_GROUPS, MATERIAL_TYPES, MaterialField, SIDES, fieldsOf, materialType, readField } from '../../scene/materials';
import { libraryEntry, libraryIdOf } from '../../scene/material-library';
import { assemblyInfo, assemblyPath, isAssembly, productTree } from '../../scene/assemblies';
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
  material: MaterialProps | null;
  light: LightProps | null;
  geometry: { vertices: number; triangles: number } | null;
  /** A primitive's sizes, before its scale. */
  dimensions: { name: DimensionName; label: string; value: number }[] | null;
  /** For an assembly: what it says about itself, and what it holds. */
  assembly: { partNumber: string; description: string; contents: string } | null;
  /** The assemblies it is in, the outermost first. */
  inAssembly: { id: string; name: string }[];
  /** For a solid: its operation, how many operands it combines, and the result's size. */
  solid: { operation: SolidOperation; operands: number; triangles: number } | null;
  /** For an operand of a solid: which solid, and its place among the operands. */
  operand: { solidId: string; solid: string; index: number; count: number; role: string } | null;
  children: number;
  ifc: IfcInfo | null;
  step: { label: string; value: string }[] | null;
}

/** A material's type and the settings it has, in groups, for one slot. */
interface MaterialProps {
  slots: { index: number; label: string }[];
  slot: number;
  type: string;
  about: string;
  /** Whether its type can be changed: one of the mesh materials. */
  convertible: boolean;
  /** Who else the material is shared with, if anyone. */
  shared: string;
  /** The library material it was made from, by name. */
  library: string;
  groups: { name: string; open: boolean; fields: { f: MaterialField; value: FieldValue }[] }[];
  note: string;
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

        @if (p.assembly; as a) {
          <fieldset>
            <legend>Assembly</legend>
            <label class="field">
              <span>Part number</span>
              <input class="input" [value]="a.partNumber" placeholder="None" (change)="doc.setAssemblyInfo(p.id, { partNumber: value($event) })" />
            </label>
            <label class="field">
              <span>Description</span>
              <input class="input" [value]="a.description" placeholder="None" (change)="doc.setAssemblyInfo(p.id, { description: value($event) })" />
            </label>
            <div class="field"><span>Contains</span><span class="readonly">{{ a.contents }}</span></div>
          </fieldset>
        }

        @if (p.inAssembly.length) {
          <div class="field assembly-path">
            <span>In assembly</span>
            <span class="crumbs">
              @for (c of p.inAssembly; track c.id; let last = $last) {
                <button type="button" class="link-btn" [title]="'Select ' + c.name" (click)="selectId(c.id)">{{ c.name }}</button>
                @if (!last) {
                  <span class="crumb-sep">›</span>
                }
              }
            </span>
          </div>
        }

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
          <fieldset class="material-props">
            <legend>Material</legend>
            @if (m.slots.length > 1) {
              <label class="field" title="This object has several materials, for different parts of it">
                <span>Slot</span>
                <select class="input" (change)="slot.set(+value($event))">
                  @for (s of m.slots; track s.index) {
                    <option [value]="s.index" [selected]="s.index === m.slot">{{ s.label }}</option>
                  }
                </select>
              </label>
            }
            <label class="field">
              <span>Type</span>
              @if (m.convertible) {
                <select class="input" [title]="m.about" (change)="setMaterialType(p.id, value($event), m.slot)">
                  @for (t of materialTypes; track t.type) {
                    <option [value]="t.type" [selected]="t.type === m.type" [title]="t.about">{{ t.label }}</option>
                  }
                </select>
              } @else {
                <span class="readonly">{{ m.type }}</span>
              }
            </label>
            @if (m.library) {
              <div class="field"><span>From library</span><span class="readonly" title="Changes here change this copy of it, not the library">{{ m.library }}</span></div>
            }
            @if (m.shared) {
              <p class="hint">{{ m.shared }}</p>
            }
            @for (g of m.groups; track g.name) {
              <details [open]="g.open">
                <summary>{{ g.name }}</summary>
                @for (x of g.fields; track x.f.key) {
                  <label class="field" [title]="x.f.title ?? ''">
                    <span>
                      {{ x.f.label }}
                      @if (x.f.traced === false) {
                        <sup class="not-traced" title="Ray tracing leaves this out">†</sup>
                      }
                    </span>
                    @switch (x.f.kind) {
                      @case ('color') {
                        <input type="color" [value]="x.value" (input)="setField(p.id, x.f.key, value($event), m.slot)" />
                      }
                      @case ('slider') {
                        <span class="slider-field">
                          <input
                            type="range"
                            [min]="x.f.min"
                            [max]="x.f.max"
                            [step]="x.f.step"
                            [value]="x.value"
                            [attr.aria-label]="x.f.label"
                            (input)="setField(p.id, x.f.key, num($event), m.slot)" />
                          <span class="slider-value">{{ x.value }}</span>
                        </span>
                      }
                      @case ('number') {
                        <input
                          class="input num"
                          type="number"
                          [min]="x.f.min"
                          [max]="x.f.max"
                          [step]="x.f.step"
                          [value]="x.value"
                          [attr.aria-label]="x.f.label"
                          (change)="setField(p.id, x.f.key, num($event), m.slot)" />
                      }
                      @case ('bool') {
                        <input type="checkbox" [checked]="x.value" (change)="setField(p.id, x.f.key, checked($event), m.slot)" />
                      }
                      @case ('side') {
                        <select class="input" (change)="setField(p.id, x.f.key, +value($event), m.slot)">
                          @for (side of sides; track side.value) {
                            <option [value]="side.value" [selected]="side.value === x.value">{{ side.label }}</option>
                          }
                        </select>
                      }
                    }
                  </label>
                }
              </details>
            }
            @if (m.note) {
              <p class="hint">{{ m.note }}</p>
            }
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
  protected readonly materialTypes = MATERIAL_TYPES;
  protected readonly sides = SIDES;
  /** Which of an object's materials is shown, where it has several; back to the first for each new selection. */
  protected readonly slot = linkedSignal({ source: () => this.ids()[0], computation: () => 0 });
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
    const owners = this.doc.materialOwners(o);
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
      material: owners.length ? this.materialProps(o, owners) : null,
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
      assembly: isAssembly(o) ? assemblyProps(o) : null,
      inAssembly: assemblyPath(o).map(a => ({ id: a.uuid, name: a.name || a.type })),
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

  /** The material of an object, or of the shapes of a solid, for the panel. */
  private materialProps(o: THREE.Object3D, owners: THREE.Object3D[]): MaterialProps {
    const all = materialsOf(owners[0]);
    const slot = isSolid(o) ? 0 : Math.min(this.slot(), all.length - 1);
    const m = all[slot];
    const t = materialType(m);
    const fields = fieldsOf(m).map(f => ({ f, value: readField(m, f) }));
    const groups = MATERIAL_GROUPS.map((name, i) => ({ name, open: i < 2, fields: fields.filter(x => x.f.group === name) })).filter(g => g.fields.length);
    let users = 0;
    this.doc.scene.traverse(c => {
      if (!isSolidResult(c) && materialsOf(c).includes(m)) users++;
    });
    return {
      slots: isSolid(o) ? [] : all.map((x, i) => ({ index: i, label: `${i + 1}: ${x.name || materialType(x)?.label || x.type}` })),
      slot,
      type: m.type,
      about: t?.about ?? m.type,
      convertible: !!t && !!(o as THREE.Mesh).isMesh || (isSolid(o) && !!t),
      shared: isSolid(o)
        ? `Changes apply to all ${owners.length} shapes of this solid.`
        : users > 1
          ? `Shared with ${users - 1} other object${users > 2 ? 's' : ''}: changes apply to them too.`
          : '',
      groups,
      library: libraryEntry(libraryIdOf(m) ?? '')?.name ?? '',
      note:
        m.type === 'MeshNormalMaterial'
          ? 'Ray tracing shades this as a Lambert material.'
          : groups.some(g => g.fields.some(x => x.f.traced === false))
            ? '† Ray tracing leaves this setting out.'
            : '',
    };
  }

  protected setField(id: string, key: string, value: FieldValue, slot: number): void {
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    this.doc.setMaterialField([id], key, value, slot);
  }

  protected setMaterialType(id: string, type: string, slot: number): void {
    this.doc.setMaterialType([id], type, slot);
  }

  /** Aims a light: one coordinate of the point it shines at. */
  protected setTarget(id: string, target: Vec, axis: number, event: Event): void {
    const v = this.num(event);
    if (!Number.isFinite(v)) return;
    const t = [...target] as Vec;
    t[axis] = v;
    this.doc.setLight([id], { target: t });
  }

  protected selectId(id: string): void {
    this.panel.publish('selection', { ids: [id] }, true);
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

/** An assembly's part number, description, and what it holds. */
function assemblyProps(o: THREE.Object3D): { partNumber: string; description: string; contents: string } {
  const info = assemblyInfo(o);
  const inside = productTree(o);
  const subs = inside.filter(n => n.kind === 'assembly').length;
  const direct = inside.filter(n => n.kind === 'part' || n.kind === 'solid').length;
  const all = inside.reduce((t, n) => t + n.parts, 0);
  const parts: string[] = [];
  if (subs) parts.push(`${subs} ${subs === 1 ? 'subassembly' : 'subassemblies'}`);
  parts.push(`${direct} ${direct === 1 ? 'part' : 'parts'}`);
  return {
    partNumber: info.partNumber ?? '',
    description: info.description ?? '',
    contents: parts.join(', ') + (all !== direct ? ` (${all} parts in all)` : ''),
  };
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
