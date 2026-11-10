import { PanelType } from '../core/panels/panel-type';
import { LinksPanel } from './links/links-panel';
import { MaterialsPanel } from './materials/materials-panel';
import { MessagesPanel } from './messages/messages-panel';
import { PropertiesPanel } from './properties/properties-panel';
import { SceneTreePanel } from './scene-tree/scene-tree-panel';
import { ToolsPanel } from './tools/tools-panel';
import { RaytracePanel } from './raytrace/raytrace-panel';
import { ViewportPanel } from './viewport/viewport-panel';

/** The panels the workbench offers. Add an entry here to add a kind of panel. */
export const APP_PANEL_TYPES: readonly PanelType[] = [
  {
    type: 'viewport',
    title: '3D View',
    icon: '◈',
    description: 'A 3D view of the scene, with its own camera',
    component: ViewportPanel,
    multiple: true,
  },
  {
    type: 'scene-tree',
    title: 'Scene Tree',
    icon: '☰',
    description: "The scene's objects as a tree",
    component: SceneTreePanel,
    multiple: true,
  },
  {
    type: 'properties',
    title: 'Properties',
    icon: '⚙',
    description: "The selected object's name, transform and material",
    component: PropertiesPanel,
    multiple: true,
  },
  {
    type: 'tools',
    title: 'Edit Tools',
    icon: '✥',
    description: 'Transform tools, adding shapes and models, and commands on the selection',
    component: ToolsPanel,
    multiple: true,
  },
  {
    type: 'materials',
    title: 'Materials',
    icon: '🎨',
    description: 'A library of common materials, with previews, to give to objects',
    component: MaterialsPanel,
    multiple: true,
  },
  {
    type: 'raytrace',
    title: 'Ray Tracing',
    icon: '☀',
    description: 'Photorealistic images of a 3D view with MeerCADRaytracer',
    component: RaytracePanel,
    multiple: false,
    float: { width: 360, height: 620 },
  },
  {
    type: 'messages',
    title: 'Messages',
    icon: '✉',
    description: 'The messages panels send each other',
    component: MessagesPanel,
    multiple: true,
  },
  {
    type: 'links',
    title: 'Panels & Links',
    icon: '⛓',
    description: 'Every open panel and its link channel',
    component: LinksPanel,
    multiple: false,
  },
];
