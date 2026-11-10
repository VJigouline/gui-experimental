import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { LIBRARY_CATEGORIES, MATERIAL_LIBRARY, libraryEntry, libraryIdOf, libraryTexture, makeLibraryMaterial } from './material-library';
import { fieldsOf } from './materials';
import { SceneDocument } from './scene-document';

describe('material library', () => {
  it('has materials of every kind, with names of their own', () => {
    const ids = MATERIAL_LIBRARY.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of LIBRARY_CATEGORIES) expect(MATERIAL_LIBRARY.filter(m => m.category === c.id).length).toBeGreaterThanOrEqual(5);
    expect(MATERIAL_LIBRARY.every(m => LIBRARY_CATEGORIES.some(c => c.id === m.category))).toBe(true);
  });

  it('makes each one as a three.js material with all its settings', () => {
    for (const entry of MATERIAL_LIBRARY) {
      const m = makeLibraryMaterial(entry);
      expect(m.type).toBe(entry.type);
      expect(m.name).toBe(entry.name);
      expect(libraryIdOf(m)).toBe(entry.id);
      // Every setting is one the type has.
      const keys = fieldsOf(m).map(f => f.key);
      for (const key of Object.keys(entry.settings)) expect(keys, `${entry.id}.${key}`).toContain(key);
    }
    const gold = makeLibraryMaterial(libraryEntry('gold')!) as THREE.MeshStandardMaterial;
    expect(gold.metalness).toBe(1);
    const glass = makeLibraryMaterial(libraryEntry('glass-green')!) as THREE.MeshPhysicalMaterial;
    expect(glass.transmission).toBe(1);
    expect(glass.attenuationDistance).toBeCloseTo(0.4);
  });

  it('textures wood, stone and fabric, sharing a texture between copies', () => {
    const oak = libraryEntry('oak')!;
    const a = makeLibraryMaterial(oak) as THREE.MeshStandardMaterial;
    const b = makeLibraryMaterial(oak) as THREE.MeshStandardMaterial;
    expect(a.map).toBeInstanceOf(THREE.DataTexture);
    expect(a.map).toBe(b.map);
    expect(a.color.getHex()).toBe(0xffffff);
    const t = libraryTexture(oak)!;
    expect([t.image.width, t.image.height]).toEqual([256, 256]);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
    // Grain: not one flat colour.
    const data = t.image.data as Uint8Array;
    const reds = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) reds.add(data[i]);
    expect(reds.size).toBeGreaterThan(10);
    expect(libraryTexture(libraryEntry('gold')!)).toBeNull();
  });

  describe('assigning', () => {
    let doc: SceneDocument;
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [SceneDocument] });
      doc = TestBed.inject(SceneDocument);
    });

    it('gives a material to shapes, sharing it, and frees the old ones', () => {
      const box = doc.scene.getObjectByName('Box 1') as THREE.Mesh;
      const sphere = doc.scene.getObjectByName('Sphere 1') as THREE.Mesh;
      const old = box.material as THREE.Material;
      let freed = false;
      old.addEventListener('dispose', () => (freed = true));
      const gold = makeLibraryMaterial(libraryEntry('gold')!);
      expect(doc.assignMaterial([box.uuid, sphere.uuid], gold)).toBe(2);
      expect(box.material).toBe(gold);
      expect(sphere.material).toBe(gold);
      expect(freed).toBe(true);
    });

    it('gives it to every part of a group or model', () => {
      const assembly = doc.scene.getObjectByName('Assembly')!;
      const oak = makeLibraryMaterial(libraryEntry('oak')!);
      expect(doc.assignMaterial([assembly.uuid], oak)).toBe(3);
      assembly.traverse(o => {
        if ((o as THREE.Mesh).isMesh) expect((o as THREE.Mesh).material).toBe(oak);
      });
    });

    it('gives it to a solid’s shapes, and its result follows', () => {
      const box = doc.add('box');
      const sphere = doc.add('sphere');
      const solid = doc.combine([box, sphere], 'union')!;
      const marble = makeLibraryMaterial(libraryEntry('marble-white')!);
      expect(doc.assignMaterial([solid], marble)).toBe(2);
      const result = doc.get(solid)!.children.find(c => c.userData['solidResult']) as THREE.Mesh;
      const mats = Array.isArray(result.material) ? result.material : [result.material];
      expect(mats).toEqual([marble]);
    });
  });
});
