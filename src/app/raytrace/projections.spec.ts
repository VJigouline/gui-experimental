import * as THREE from 'three';
import { raytrace } from 'meercad-raytracer';
import { EnvironmentSource, Pixels, guessProjection, orderFaces, projectEnvironment, projectionsFor } from './environments';

const FACE_COLOURS = [
  [1, 0, 0], // +X red
  [0, 1, 0], // −X green
  [0, 0, 1], // +Y blue
  [1, 1, 0], // −Y yellow
  [1, 0, 1], // +Z magenta
  [0, 1, 1], // −Z cyan
];

function solid(size: number, c: number[]): Pixels {
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([c[0], c[1], c[2], 1], i * 4);
  return { width: size, height: size, data };
}

/** Faces pasted into one image at cells of a grid, top row first. */
function layout(faces: Pixels[], cols: number, rows: number, cells: [number, number, boolean?][]): Pixels {
  const f = faces[0].width;
  const width = cols * f;
  const height = rows * f;
  const data = new Float32Array(width * height * 4);
  cells.forEach(([cx, cy, turned], i) => {
    for (let y = 0; y < f; y++) {
      for (let x = 0; x < f; x++) {
        const sx = turned ? f - 1 - x : x;
        const sy = turned ? f - 1 - y : y;
        const s = (sy * f + sx) * 4;
        const o = ((cy * f + y) * width + cx * f + x) * 4;
        data.set(faces[i].data.subarray(s, s + 4), o);
      }
    }
  });
  return { width, height, data };
}

/** The equirectangular texture's colour towards a direction, nearest pixel. */
function towards(t: THREE.DataTexture, d: THREE.Vector3): number[] {
  const { width, height, data } = t.image as { width: number; height: number; data: Float32Array };
  const n = d.clone().normalize();
  const u = Math.atan2(n.z, n.x) / (2 * Math.PI) + 0.5;
  const v = Math.asin(n.y) / Math.PI + 0.5;
  const x = Math.min(width - 1, Math.floor(u * width));
  const y = Math.min(height - 1, Math.floor(v * height));
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

const AXES: [string, THREE.Vector3][] = [
  ['+X', new THREE.Vector3(1, 0, 0)],
  ['−X', new THREE.Vector3(-1, 0, 0)],
  ['+Y', new THREE.Vector3(0, 1, 0.001)],
  ['−Y', new THREE.Vector3(0, -1, 0.001)],
  ['+Z', new THREE.Vector3(0, 0, 1)],
  ['−Z', new THREE.Vector3(0, 0, -1)],
];

describe('environment projections', () => {
  const faces = FACE_COLOURS.map(c => solid(16, c));
  const cube: EnvironmentSource = { name: 'cube', images: faces };
  const fromCube = projectEnvironment(cube, 'cube-faces');

  it('reads six cube faces as three.js and the ray tracer show a cube texture of them', () => {
    // The tracer's own rendering of a three.js CubeTexture with these faces, as a background.
    const cubeTexture = new THREE.CubeTexture(
      faces.map(f => {
        const t = new THREE.DataTexture(f.data, f.width, f.height, THREE.RGBAFormat, THREE.FloatType);
        return t as unknown as HTMLImageElement;
      }),
    );
    cubeTexture.type = THREE.FloatType;
    cubeTexture.needsUpdate = true;
    const camera = new THREE.PerspectiveCamera(10, 1, 0.1, 10);
    for (const [name, d] of AXES) {
      camera.position.set(0, 0, 0);
      camera.up.set(0, 1, 0);
      if (Math.abs(d.y) > 0.5) camera.up.set(0, 0, -1);
      camera.lookAt(d);
      camera.updateMatrixWorld();
      const shot = (background: THREE.Texture) => {
        const scene = new THREE.Scene();
        scene.background = background;
        const img = raytrace(scene, camera, 4, 4, { samples: 1, outputColorSpace: THREE.LinearSRGBColorSpace });
        const i = (2 * 4 + 2) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]].map(v => Math.round(v / 255));
      };
      expect(shot(fromCube), name).toEqual(shot(cubeTexture));
    }
  });

  it('puts the faces where three.js does: +Y up, +Z in front, and X turned round', () => {
    const at = (d: THREE.Vector3) => towards(fromCube, d).map(Math.round);
    expect(at(new THREE.Vector3(0, 1, 0.001))).toEqual(FACE_COLOURS[2]);
    expect(at(new THREE.Vector3(0, -1, 0.001))).toEqual(FACE_COLOURS[3]);
    expect(at(new THREE.Vector3(0, 0, 1))).toEqual(FACE_COLOURS[4]);
    expect(at(new THREE.Vector3(0, 0, -1))).toEqual(FACE_COLOURS[5]);
    // three.js shows a cube texture's +X image towards −X.
    expect(at(new THREE.Vector3(-1, 0, 0))).toEqual(FACE_COLOURS[0]);
  });

  it('reads crosses and strips as the same six faces', () => {
    const one = (images: Pixels) => ({ name: 'one', images: [images] });
    const cases: [Parameters<typeof projectEnvironment>[1], Pixels][] = [
      ['cross-h', layout(faces, 4, 3, [[2, 1], [0, 1], [1, 0], [1, 2], [1, 1], [3, 1]])],
      ['cross-v', layout(faces, 3, 4, [[2, 1], [0, 1], [1, 0], [1, 2], [1, 1], [1, 3, true]])],
      ['strip-h', layout(faces, 6, 1, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])],
      ['strip-v', layout(faces, 1, 6, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]])],
    ];
    for (const [projection, image] of cases) {
      const t = projectEnvironment(one(image), projection);
      expect(guessProjection(one(image)), projection).toBe(projection);
      for (const [name, d] of AXES) expect(towards(t, d).map(Math.round), `${projection} ${name}`).toEqual(towards(fromCube, d).map(Math.round));
    }
  });

  /** A square image whose pixels hold the direction they show, plus one, from a forward mapping. */
  function probe(size: number, direction: (a: number, b: number) => THREE.Vector3 | null): Pixels {
    const data = new Float32Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = ((x + 0.5) / size) * 2 - 1;
        const b = 1 - ((y + 0.5) / size) * 2;
        const d = direction(a, b) ?? new THREE.Vector3(-1, -1, -1);
        data.set([d.x + 1, d.y + 1, d.z + 1, 1], (y * size + x) * 4);
      }
    }
    return { width: size, height: size, data };
  }
  const tests = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0.01), new THREE.Vector3(0.5, -0.4, 0.3), new THREE.Vector3(-0.3, 0.2, -0.6)];

  it('reads a mirror ball photographed from +Z', () => {
    const ball = probe(256, (a, b) => {
      const r2 = a * a + b * b;
      if (r2 > 1) return null;
      const n = new THREE.Vector3(a, b, Math.sqrt(1 - r2));
      // The camera is along +Z: the reflected direction.
      return n.clone().multiplyScalar(2 * n.z).sub(new THREE.Vector3(0, 0, 1));
    });
    const t = projectEnvironment({ name: 'ball', images: [ball] }, 'mirror-ball');
    for (const d of tests) {
      const got = towards(t, d).map(v => v - 1);
      const want = d.clone().normalize();
      expect(new THREE.Vector3(...got).distanceTo(want), `${d.toArray()}`).toBeLessThan(0.08);
    }
  });

  it('reads an angular map, +Z in the middle', () => {
    const angular = probe(256, (a, b) => {
      const r = Math.hypot(a, b);
      if (r > 1) return null;
      const theta = Math.PI * r;
      const phi = Math.atan2(b, a);
      return new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta));
    });
    const t = projectEnvironment({ name: 'probe', images: [angular] }, 'angular');
    for (const d of tests) {
      const got = new THREE.Vector3(...towards(t, d).map(v => v - 1));
      expect(got.distanceTo(d.clone().normalize()), `${d.toArray()}`).toBeLessThan(0.05);
    }
  });

  it('keeps a panorama as it is', () => {
    const pano: Pixels = { width: 64, height: 32, data: new Float32Array(64 * 32 * 4) };
    // Brighter up the image: up in the world.
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) pano.data.set([1 - y / 32, 0, x / 64, 1], (y * 64 + x) * 4);
    const t = projectEnvironment({ name: 'pano', images: [pano] }, 'equirect');
    expect(towards(t, new THREE.Vector3(0, 1, 0.001))[0]).toBeGreaterThan(0.9);
    expect(towards(t, new THREE.Vector3(0, -1, 0.001))[0]).toBeLessThan(0.1);
    expect(guessProjection({ name: 'p', images: [pano] })).toBe('equirect');
  });

  it('guesses projections from shapes, and orders cube faces by name', () => {
    const shape = (w: number, h: number) => ({ name: 's', images: [{ width: w, height: h, data: new Float32Array(0) }] });
    expect(guessProjection(shape(1024, 1024))).toBe('mirror-ball');
    expect(guessProjection(shape(1024, 1024), true)).toBe('angular');
    expect(guessProjection(shape(4000, 1000))).toBe('cylinder');
    expect(projectionsFor(cube)).toEqual(['cube-faces']);
    expect(projectionsFor(shape(10, 10))).not.toContain('cube-faces');
    const named = ['nz.jpg', 'py.jpg', 'px.jpg', 'ny.jpg', 'pz.jpg', 'nx.jpg'].map(name => ({ name }));
    expect(orderFaces(named).map(f => f.name)).toEqual(['px.jpg', 'nx.jpg', 'py.jpg', 'ny.jpg', 'pz.jpg', 'nz.jpg']);
    const words = ['sky_back.png', 'sky_front.png', 'sky_left.png', 'sky_right.png', 'sky_top.png', 'sky_bottom.png'].map(name => ({ name }));
    expect(orderFaces(words).map(f => f.name)).toEqual(['sky_right.png', 'sky_left.png', 'sky_top.png', 'sky_bottom.png', 'sky_front.png', 'sky_back.png']);
    const unnamed = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => ({ name }));
    expect(orderFaces(unnamed)).toEqual(unnamed);
  });
});
