/** Options for importing STEP files with MeerCADStepImport, as the STEP import dialog sets them. */
export interface StepImportSettings {
  /** Chord tolerance as a fraction of each solid's size: how far the mesh may be from the surface. */
  relativeTolerance: number;
  /** Degrees. Largest angle between neighbouring normals, and per segment along curved edges. */
  angularTolerance: number;
  /** Refinement stops at this many triangles in a face. */
  maxTrianglesPerFace: number;
  /** Draw items the file hides with INVISIBILITY. */
  includeHidden: boolean;
  /** Where a product has both a B-rep and an AP242 tessellated shape, draw the tessellated one. */
  preferTessellated: boolean;
  /** Show the dialog before each STEP import. */
  ask: boolean;
}

export const STEP_SETTINGS_KEY = 'gui-experimental.step.settings';

/** MeerCADStepImport's own defaults; 0.2 rad is about 11.5°. */
export function defaultStepSettings(): StepImportSettings {
  return { relativeTolerance: 0.001, angularTolerance: 11.5, maxTrianglesPerFace: 50000, includeHidden: false, preferTessellated: false, ask: true };
}

export function readStepSettings(): StepImportSettings {
  const defaults = defaultStepSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(STEP_SETTINGS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    const merged = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof StepImportSettings)[]) {
      if (typeof saved[key] === typeof defaults[key]) (merged as Record<string, unknown>)[key] = saved[key];
    }
    merged.relativeTolerance = Math.min(Math.max(merged.relativeTolerance, 0.0001), 0.05);
    merged.angularTolerance = Math.min(Math.max(merged.angularTolerance, 1), 45);
    merged.maxTrianglesPerFace = Math.round(Math.min(Math.max(merged.maxTrianglesPerFace, 1000), 1000000));
    return merged;
  } catch {
    return defaults;
  }
}

export function writeStepSettings(settings: StepImportSettings): void {
  try {
    localStorage.setItem(STEP_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not kept; the settings still apply to this import.
  }
}

/** The quality choices the dialog offers, as chord tolerances. */
export const STEP_QUALITY = [
  { value: 0.005, name: 'Draft (0.5% of each solid)' },
  { value: 0.002, name: 'Normal (0.2%)' },
  { value: 0.001, name: 'Fine (0.1%, the default)' },
  { value: 0.0005, name: 'Very fine (0.05%)' },
  { value: 0.0002, name: 'Finest (0.02%)' },
];
