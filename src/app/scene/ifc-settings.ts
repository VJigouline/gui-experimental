/** Options for importing IFC files with MeerCADIFCImport, as the IFC import dialog sets them. */
export interface IfcImportSettings {
  /** Subtract openings and voiding features from the elements they void. */
  openings: boolean;
  /** Include IfcSpace volumes. */
  spaces: boolean;
  /** Include IfcOpeningElement volumes as objects of their own. */
  openingElements: boolean;
  /** Read property and quantity sets, shown in Properties. */
  properties: boolean;
  /** Segments for a full circle; arcs use their share. */
  circleSegments: number;
  /** Degrees. Faces meeting at less than this are shaded smoothly. */
  creaseAngle: number;
  /** Show the dialog before each IFC import. */
  ask: boolean;
}

export const IFC_SETTINGS_KEY = 'gui-experimental.ifc.settings';

/** MeerCADIFCImport's own defaults. */
export function defaultIfcSettings(): IfcImportSettings {
  return { openings: true, spaces: false, openingElements: false, properties: true, circleSegments: 24, creaseAngle: 30, ask: true };
}

export function readIfcSettings(): IfcImportSettings {
  const defaults = defaultIfcSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(IFC_SETTINGS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    const merged = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof IfcImportSettings)[]) {
      if (typeof saved[key] === typeof defaults[key]) (merged as Record<string, unknown>)[key] = saved[key];
    }
    merged.circleSegments = Math.round(Math.min(Math.max(merged.circleSegments, 6), 128));
    merged.creaseAngle = Math.min(Math.max(merged.creaseAngle, 0), 180);
    return merged;
  } catch {
    return defaults;
  }
}

export function writeIfcSettings(settings: IfcImportSettings): void {
  try {
    localStorage.setItem(IFC_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not kept; the settings still apply to this import.
  }
}
