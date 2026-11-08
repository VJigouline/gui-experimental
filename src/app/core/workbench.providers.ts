import { EnvironmentProviders, Provider, makeEnvironmentProviders } from '@angular/core';
import { PanelBus } from './bus/panel-bus';
import { LayoutService } from './layout/layout.service';
import { PanelHost } from './panels/panel-host.service';
import { LAYOUT_PRESETS, LayoutPreset, PANEL_TYPES, PanelType } from './panels/panel-type';
import { DockDrag } from '../dock/dock-drag.service';
import { PanelActions } from '../dock/panel-actions';

export interface WorkbenchOptions {
  panels: readonly PanelType[];
  presets?: readonly LayoutPreset[];
  /** Other services the panels share, such as a document. */
  services?: Provider[];
}

/** The services of a workbench, for a route or a test. */
export function provideWorkbench(options: WorkbenchOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PANEL_TYPES, useValue: options.panels },
    { provide: LAYOUT_PRESETS, useValue: options.presets ?? [] },
    PanelBus,
    LayoutService,
    PanelHost,
    DockDrag,
    PanelActions,
    ...(options.services ?? []),
  ]);
}
