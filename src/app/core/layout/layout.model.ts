/**
 * The layout of the workbench: a tree of split and stack nodes for the docked
 * area, floating windows over it, and the panels shown in them.
 *
 * Layouts are plain JSON, so they can be saved, restored, exported and edited
 * by hand. Every update makes a new object for each node it changes, so the
 * layout can be held in a signal.
 */

/** Panels side by side (`row`) or one above another (`column`). */
export type SplitDirection = 'row' | 'column';

export interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  children: LayoutNode[];
  /** Relative sizes of the children, summing to 1. */
  sizes: number[];
}

/** A rectangle showing one panel at a time, with a tab for each. */
export interface StackNode {
  type: 'stack';
  id: string;
  panels: string[];
  /** The panel shown, or `null` for an empty stack. */
  active: string | null;
}

export type LayoutNode = SplitNode | StackNode;

export interface FloatingWindow {
  id: string;
  /** Position and size in pixels, relative to the workspace. */
  x: number;
  y: number;
  width: number;
  height: number;
  root: LayoutNode;
}

/** A panel: an instance of a panel type, with its own title, channel and state. */
export interface PanelConfig {
  type: string;
  title: string;
  /**
   * The link channel. Panels on the same channel share selection and
   * commands; `none` keeps the panel to itself.
   */
  channel: string;
  /** State that the panel saves with the layout, such as a camera position. */
  state: Record<string, unknown>;
}

export interface LayoutConfig {
  format: typeof LAYOUT_FORMAT;
  version: typeof LAYOUT_VERSION;
  name?: string;
  root: LayoutNode;
  floating: FloatingWindow[];
  panels: Record<string, PanelConfig>;
  /** A stack drawn over the whole docked area, or `null`. */
  maximized: string | null;
}

export const LAYOUT_FORMAT = 'gui-experimental-layout';
export const LAYOUT_VERSION = 1;

/** Where a dragged panel is dropped. */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

export type DropTarget =
  /** Into a stack: as a tab (`center`, optionally at `index`) or beside it. */
  | { kind: 'stack'; stackId: string; zone: DropZone; index?: number }
  /** Along an edge of the whole docked area. */
  | { kind: 'root'; zone: Exclude<DropZone, 'center'> }
  /** Into a new floating window. */
  | { kind: 'float'; x: number; y: number; width?: number; height?: number };

let counter = 0;

/** A new id for a node, window or panel, unique within the page. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function stack(panels: string[], active: string | null = panels[0] ?? null): StackNode {
  return { type: 'stack', id: newId('stack'), panels, active };
}

export function split(direction: SplitDirection, children: LayoutNode[], sizes?: number[]): SplitNode {
  return {
    type: 'split',
    id: newId('split'),
    direction,
    children,
    sizes: sizes ?? children.map(() => 1 / children.length),
  };
}

export function emptyLayout(): LayoutConfig {
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    root: stack([]),
    floating: [],
    panels: {},
    maximized: null,
  };
}
