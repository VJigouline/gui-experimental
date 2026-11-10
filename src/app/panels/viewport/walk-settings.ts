/** How fast a view walks: kept per view, in its panel state. */
export interface WalkSettings {
  /** Normal walking speed, as a multiple of the speed for the scene's size. */
  speed: number;
  /** Shift multiplies the speed of the keys (WASD, Q/E, arrows) by this. */
  fastKeys: number;
  /** Shift multiplies the speed of the mouse (middle-drag and wheel) by this. */
  fastMouse: number;
}

export function defaultWalkSettings(): WalkSettings {
  return { speed: 1, fastKeys: 3, fastMouse: 5 };
}

/** Limits for the settings, so a bad saved value can't stop walking. */
export const WALK_SPEED = { min: 0.05, max: 50 };
export const WALK_FAST = { min: 1, max: 20 };

export function clampWalk(v: number, limits: { min: number; max: number }, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, limits.min), limits.max) : fallback;
}
