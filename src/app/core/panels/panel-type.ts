import { InjectionToken, Type } from '@angular/core';

/** A kind of panel that can be added to the workbench. */
export interface PanelType {
  /** Used in layouts, such as `viewport`. */
  type: string;
  title: string;
  /** A short symbol shown in menus and tabs. */
  icon: string;
  description: string;
  component: Type<unknown>;
  /** Whether more than one can be open. If not, adding another shows the open one. */
  multiple: boolean;
  /** State for a new panel. */
  defaultState?: () => Record<string, unknown>;
}

/** The panel types available. Provided by the application, and by tests. */
export const PANEL_TYPES = new InjectionToken<readonly PanelType[]>('PANEL_TYPES');

/** The layouts offered under Layout › Presets, as layout JSON objects. */
export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  layout: unknown;
}

export const LAYOUT_PRESETS = new InjectionToken<readonly LayoutPreset[]>('LAYOUT_PRESETS');
