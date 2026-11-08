import * as THREE from 'three';

/** File extensions that `importModel` reads. */
export const MODEL_EXTENSIONS = ['.glb', '.gltf', '.stl', '.obj'] as const;

/**
 * Reads a glTF (self-contained `.gltf` or `.glb`), STL or OBJ file into an
 * object. The loaders are fetched when first needed.
 */
export async function importModel(file: File): Promise<THREE.Object3D> {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '');
  let object: THREE.Object3D;
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
      object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb0b8c4, roughness: 0.5, metalness: 0.1 }));
      break;
    }
    case '.obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      object = new OBJLoader().parse(await file.text());
      object.traverse(c => {
        const m = c as THREE.Mesh;
        if (m.isMesh && !(m.material instanceof THREE.MeshStandardMaterial)) {
          m.material = new THREE.MeshStandardMaterial({ color: 0xb0b8c4, roughness: 0.5, metalness: 0.1 });
        }
      });
      break;
    }
    default:
      throw new Error(`"${file.name}" is not a model this can read. Use ${MODEL_EXTENSIONS.join(', ')}.`);
  }
  object.name = name;
  return object;
}
