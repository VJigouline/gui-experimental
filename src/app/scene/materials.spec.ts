import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { MATERIAL_FIELDS, MATERIAL_TYPES, convertMaterial, fieldsOf, readField, writeField } from './materials';
import { SceneDocument } from './scene-document';
import { solidResult } from './solids';

const field = (key: string) => MATERIAL_FIELDS.find(f => f.key === key)!;
const keys = (m: THREE.Material) => fieldsOf(m).map(f => f.key);

describe('materials', () => {
  it('lists the mesh materials three.js has', () => {
    expect(MATERIAL_TYPES.map(t => t.make().type)).toEqual(MATERIAL_TYPES.map(t => t.type));
  });

  it('shows each type the settings it has', () => {
    expect(keys(new THREE.MeshBasicMaterial())).not.toContain('emissive');
    expect(keys(new THREE.MeshPhongMaterial())).toEqual(expect.arrayContaining(['color', 'specular', 'shininess', 'emissive']));
    expect(keys(new THREE.MeshStandardMaterial())).toEqual(expect.arrayContaining(['roughness', 'metalness']));
    expect(keys(new THREE.MeshStandardMaterial())).not.toContain('clearcoat');
    expect(keys(new THREE.MeshPhysicalMaterial())).toEqual(
      expect.arrayContaining(['clearcoat', 'sheen', 'iridescence', 'transmission', 'thickness', 'ior', 'attenuationDistance', 'dispersion']),
    );
    expect(keys(new THREE.MeshNormalMaterial())).not.toContain('color');
    // Everything has the rendering settings.
    for (const t of MATERIAL_TYPES) expect(keys(t.make())).toEqual(expect.arrayContaining(['opacity', 'transparent', 'side', 'wireframe']));
  });

  it('reads and writes values within their ranges', () => {
    const m = new THREE.MeshPhysicalMaterial();
    const version = m.version;
    expect(writeField(m, field('color'), '#336699')).toBe(true);
    expect(readField(m, field('color'))).toBe('#336699');
    expect(writeField(m, field('color'), 'red')).toBe(false);
    writeField(m, field('roughness'), 3);
    expect(m.roughness).toBe(1);
    writeField(m, field('ior'), 0.2);
    expect(m.ior).toBe(1);
    writeField(m, field('side'), THREE.DoubleSide);
    expect(m.side).toBe(THREE.DoubleSide);
    expect(writeField(m, field('side'), 7)).toBe(false);
    // Infinite attenuation is shown and typed as 0.
    expect(readField(m, field('attenuationDistance'))).toBe(0);
    writeField(m, field('attenuationDistance'), 2);
    expect(m.attenuationDistance).toBe(2);
    writeField(m, field('attenuationDistance'), 0);
    expect(m.attenuationDistance).toBe(Infinity);
    expect(m.version).toBeGreaterThan(version);
    expect(writeField(new THREE.MeshBasicMaterial(), field('roughness'), 0.5)).toBe(false);
  });

  it('keeps what types share when converting', () => {
    const phong = new THREE.MeshPhongMaterial({ color: 0x123456, emissive: 0x010203, opacity: 0.5, transparent: true, side: THREE.DoubleSide });
    phong.name = 'Paint';
    const map = new THREE.Texture();
    phong.map = map;
    const std = convertMaterial(phong, 'MeshStandardMaterial') as THREE.MeshStandardMaterial;
    expect(std.type).toBe('MeshStandardMaterial');
    expect(std.name).toBe('Paint');
    expect(std.color.getHex()).toBe(0x123456);
    expect(std.emissive.getHex()).toBe(0x010203);
    expect([std.opacity, std.transparent, std.side]).toEqual([0.5, true, THREE.DoubleSide]);
    expect(std.map).toBe(map);
    expect(convertMaterial(phong, 'Nothing')).toBeNull();
  });

  describe('in the scene', () => {
    let doc: SceneDocument;
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [SceneDocument] });
      doc = TestBed.inject(SceneDocument);
      doc.newScene();
    });

    it('changes a shape’s material type and settings', () => {
      const id = doc.add('box');
      const mesh = doc.get(id) as THREE.Mesh;
      const colour = (mesh.material as THREE.MeshStandardMaterial).color.getHex();
      expect(doc.setMaterialType([id], 'MeshPhysicalMaterial')).toBe(1);
      const m = mesh.material as THREE.MeshPhysicalMaterial;
      expect(m.type).toBe('MeshPhysicalMaterial');
      expect(m.color.getHex()).toBe(colour);
      doc.setMaterialField([id], 'transmission', 0.9);
      doc.setMaterialField([id], 'clearcoat', 1);
      expect([m.transmission, m.clearcoat]).toEqual([0.9, 1]);
      // To the same type: nothing to do.
      expect(doc.setMaterialType([id], 'MeshPhysicalMaterial')).toBe(0);
    });

    it('keeps shared materials shared, and frees replaced ones', () => {
      const a = doc.get(doc.add('box')) as THREE.Mesh;
      const b = doc.get(doc.add('sphere')) as THREE.Mesh;
      const shared = a.material as THREE.Material;
      b.material = shared;
      let disposed = false;
      shared.addEventListener('dispose', () => (disposed = true));
      doc.setMaterialType([a.uuid, b.uuid], 'MeshToonMaterial');
      expect(a.material).toBe(b.material);
      expect((a.material as THREE.Material).type).toBe('MeshToonMaterial');
      expect(disposed).toBe(true);
    });

    it('edits one slot of an object with several materials', () => {
      const mesh = doc.get(doc.add('box')) as THREE.Mesh;
      const second = new THREE.MeshLambertMaterial();
      mesh.material = [mesh.material as THREE.Material, second];
      doc.setMaterialField([mesh.uuid], 'color', '#ff0000', 1);
      expect(second.color.getHexString()).toBe('ff0000');
      doc.setMaterialType([mesh.uuid], 'MeshBasicMaterial', 1);
      const mats = mesh.material as THREE.Material[];
      expect(mats.map(m => m.type)).toEqual(['MeshStandardMaterial', 'MeshBasicMaterial']);
    });

    it('edits a solid’s shapes, and its result follows', () => {
      const box = doc.add('box');
      const sphere = doc.add('sphere');
      doc.setTransform(sphere, { position: [0.5, 0.5, 0] });
      const solid = doc.combine([box, sphere], 'union')!;
      doc.setMaterialType([solid], 'MeshPhongMaterial');
      const result = solidResult(doc.get(solid)!)!;
      const types = (Array.isArray(result.material) ? result.material : [result.material]).map(m => m.type);
      expect(new Set(types)).toEqual(new Set(['MeshPhongMaterial']));
      doc.setMaterialField([solid], 'shininess', 100);
      expect(((doc.get(box) as THREE.Mesh).material as THREE.MeshPhongMaterial).shininess).toBe(100);
    });
  });
});
