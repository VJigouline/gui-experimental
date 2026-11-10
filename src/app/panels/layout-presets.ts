import { LayoutPreset } from '../core/panels/panel-type';

/**
 * The layouts under Layout › Presets. They use the short form layout JSON
 * allows: panels written in place, ids and sizes left to defaults where
 * they don't matter. The first is the default.
 */
export const APP_LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: 'modelling',
    name: 'Modelling',
    description: 'Tree, a 3D view, properties and tools, with messages below',
    layout: {
      root: {
        type: 'split',
        direction: 'column',
        sizes: [0.8, 0.2],
        children: [
          {
            type: 'split',
            direction: 'row',
            sizes: [0.18, 0.57, 0.25],
            children: [
              { type: 'stack', panels: [{ id: 'tree', type: 'scene-tree' }, { id: 'assembly', type: 'assembly' }] },
              { type: 'stack', panels: [{ id: 'view', type: 'viewport' }] },
              {
                type: 'split',
                direction: 'column',
                sizes: [0.55, 0.45],
                children: [
                  { type: 'stack', panels: [{ id: 'props', type: 'properties' }, { id: 'links', type: 'links' }] },
                  { type: 'stack', panels: [{ id: 'tools', type: 'tools' }, { id: 'materials', type: 'materials' }, { id: 'raytrace', type: 'raytrace' }] },
                ],
              },
            ],
          },
          { type: 'stack', panels: [{ id: 'log', type: 'messages' }] },
        ],
      },
    },
  },
  {
    id: 'two-views',
    name: 'Two views',
    description: 'Two 3D views of the same selection, from the top and in perspective',
    layout: {
      root: {
        type: 'split',
        direction: 'row',
        sizes: [0.17, 0.33, 0.33, 0.17],
        children: [
          { type: 'stack', panels: [{ id: 'tree', type: 'scene-tree' }] },
          { type: 'stack', panels: [{ id: 'top', type: 'viewport', title: 'Top', state: { view: 'top', camera: { position: [0, 11, 0.001], target: [0, 0, 0] } } }] },
          { type: 'stack', panels: [{ id: 'persp', type: 'viewport', title: 'Perspective' }] },
          {
            type: 'stack',
            panels: [
              { id: 'props', type: 'properties' },
              { id: 'tools', type: 'tools' },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'two-links',
    name: 'Two links',
    description: 'Two sets of panels on Link A and Link B, each with its own selection',
    layout: {
      root: {
        type: 'split',
        direction: 'column',
        children: [
          {
            type: 'split',
            direction: 'row',
            sizes: [0.2, 0.55, 0.25],
            children: [
              { type: 'stack', panels: [{ id: 'tree-a', type: 'scene-tree', title: 'Tree A', channel: 'A' }] },
              { type: 'stack', panels: [{ id: 'view-a', type: 'viewport', title: 'View A', channel: 'A' }] },
              { type: 'stack', panels: [{ id: 'props-a', type: 'properties', title: 'Properties A', channel: 'A' }, { id: 'tools-a', type: 'tools', title: 'Tools A', channel: 'A' }] },
            ],
          },
          {
            type: 'split',
            direction: 'row',
            sizes: [0.2, 0.55, 0.25],
            children: [
              { type: 'stack', panels: [{ id: 'tree-b', type: 'scene-tree', title: 'Tree B', channel: 'B' }] },
              { type: 'stack', panels: [{ id: 'view-b', type: 'viewport', title: 'View B', channel: 'B', state: { background: '#111111', wireframe: true } }] },
              { type: 'stack', panels: [{ id: 'props-b', type: 'properties', title: 'Properties B', channel: 'B' }, { id: 'tools-b', type: 'tools', title: 'Tools B', channel: 'B' }] },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'One large 3D view, with the tree and properties in floating windows',
    layout: {
      root: { type: 'stack', panels: [{ id: 'view', type: 'viewport' }] },
      floating: [
        { x: 16, y: 16, width: 260, height: 360, root: { type: 'stack', panels: [{ id: 'tree', type: 'scene-tree' }] } },
        { x: 16, y: 392, width: 300, height: 380, root: { type: 'stack', panels: [{ id: 'props', type: 'properties' }, { id: 'tools', type: 'tools' }] } },
      ],
    },
  },
];
