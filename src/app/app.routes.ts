import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // The workbench, its panels and three.js load after the page shell.
    loadChildren: () => import('./workbench/workbench.routes').then(m => m.WORKBENCH_ROUTES),
  },
  { path: '**', redirectTo: '' },
];
