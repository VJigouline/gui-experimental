import { Routes } from '@angular/router';
import { provideWorkbench } from '../core/workbench.providers';
import { APP_LAYOUT_PRESETS } from '../panels/layout-presets';
import { APP_PANEL_TYPES } from '../panels/panel-types';
import { SceneDocument } from '../scene/scene-document';
import { Workbench } from './workbench';

export const WORKBENCH_ROUTES: Routes = [
  {
    path: '',
    title: 'GUI Experimental',
    component: Workbench,
    providers: [provideWorkbench({ panels: APP_PANEL_TYPES, presets: APP_LAYOUT_PRESETS, services: [SceneDocument] })],
  },
];
