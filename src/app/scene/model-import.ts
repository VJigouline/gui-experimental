import * as THREE from 'three';
import { IfcImportSettings } from './ifc-settings';

/** File extensions that `importModel` reads. */
export const MODEL_EXTENSIONS = ['.glb', '.gltf', '.stl', '.obj', '.ifc'] as const;

export interface ImportedModel {
  object: THREE.Object3D;
  /** Things the reader left out or guessed, for the console. */
  warnings: string[];
  /** A short description, such as "IFC4: 120 products, 48 210 triangles". */
  summary: string;
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

export function isModelFile(name: string): boolean {
  return (MODEL_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

/**
 * Reads a glTF (self-contained `.gltf` or `.glb`), STL, OBJ or IFC file into an object named
 * after the file. The readers are fetched when first needed.
 */
export async function importModel(file: File, ifc?: IfcImportSettings): Promise<ImportedModel> {
  const ext = extensionOf(file.name);
  const name = file.name.replace(/\.[^.]+$/, '');
  let object: THREE.Object3D;
  let warnings: string[] = [];
  let summary = '';
  switch (ext) {
    case '.glb':
    case '.gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const data = ext === '.glb' ? await file.arrayBuffer() : await file.text();
      const gltf = await new GLTFLoader().parseAsync(data, '');
      object = gltf.scene;
      break;
    }
    case '.stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geometry = new STLLoader().parse(await file.arrayBuffer());
      geometry.computeVertexNormals();
      object = new THREE.Mesh(geometry, defaultMaterial());
      break;
    }
    case '.obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      object = new OBJLoader().parse(await file.text());
      object.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && !(m.material instanceof THREE.MeshStandardMaterial)) m.material = defaultMaterial();
      });
      break;
    }
    case '.ifc': {
      // IFC2X3 and the IFC4 line, with MeerCADIFCImport, as in SceneEditor.
      const { loadIfc } = await import('meercad-ifc-import');
      const data = await file.arrayBuffer();
      const result = loadIfc(data, {
        openings: ifc?.openings,
        spaces: ifc?.spaces,
        openingElements: ifc?.openingElements,
        properties: ifc?.properties,
        circleSegments: ifc?.circleSegments,
        creaseAngle: ifc?.creaseAngle,
      });
      object = result.group;
      warnings = result.warnings;
      const s = result.statistics;
      summary = `${result.schema.id}: ${s.products} products, ${s.triangles.toLocaleString()} triangles in ${Math.round(s.milliseconds)} ms`;
      break;
    }
    default:
      throw new Error(`"${file.name}" is not a model this can read. Use ${MODEL_EXTENSIONS.join(', ')}.`);
  }
  object.name = name;
  return { object, warnings, summary };
}

function defaultMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xb0b8c4, roughness: 0.5, metalness: 0.1 });
}
