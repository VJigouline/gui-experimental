# GuiExperimental

***Playing with technologies***

A workbench of panels in one browser page, built with Angular 22 and three.js. Panels are rectangles that can be:

- **Arranged** by dragging their tabs, or by writing the layout as JSON.
- **Tabbed** together, split side by side, or floated in windows over the page.
- **Linked**, so that they work together.
- **Saved** as layouts and restored.

The sample panels edit a 3D scene: 3D views, a scene tree, properties, editing tools, a message log, and a list of panels and their links.

**Try it:** [vjigouline.github.io/gui-experimental](https://vjigouline.github.io/gui-experimental/)

![The default layout: scene tree, 3D view, properties and tools, with messages below](Documentation/workbench.png)

## Running it

```bash
npm install
npm start          # http://localhost:4200/
npm test           # unit tests, with Vitest
npm run build      # production build in dist/
npm run deploy     # build and publish to GitHub Pages
```

It needs Node.js 22.22, 24.15, or 26 and later, as Angular 22 does. The page needs a browser with WebGL.

`npm run deploy` builds the app for the `/gui-experimental/` path and pushes it to the `gh-pages` branch, which GitHub Pages serves. Changes appear on the site a minute or so later.

## Arranging panels

- **Drag a tab** onto another panel:
  - Over the middle, it becomes a tab there.
  - Over a side, it splits that panel.
  - Over the tab strip, it goes between the tabs.
- **Drag a tab to the outer edge** of the workspace to put it along that whole edge.
- **Float a panel** in a window:
  - Hold **Ctrl** as you drop it, or use ⧉ on its stack or in its tab menu.
  - Drag a window by its title, and resize it from its edges.
  - Double-click the title, or use ⇲, to dock it again.
- **Resize** with the gutters between panels. Double-click a gutter to share the space equally; with a gutter focused, the arrow keys move it.
- **Maximize** a stack by double-clicking a tab, or with 🗖.
- **Close** a panel with its ✕, or by middle-clicking its tab.
- **Add panels** from the Panels menu, the toolbar, or a stack's ＋ button. Menu and toolbar items can also be dragged into place, like tabs.
- **Rename, relink, float or close** from a tab's menu: right-click it, or use ⋮.

## Linking panels

Every panel is on a *link channel*: Link A, B, C, D, or Unlinked. The coloured dot on its tab shows which. Panels on the same link share:

- **The selection:** select in a 3D view or the scene tree, and the properties, tools and other views on that link follow.
- **The transform tool:** move, rotate or scale, set in the tools or with W, E and R in a 3D view.
- **View commands:** framing objects, and views from the top, front and so on.

Panels on different links work independently, though they all show the same scene. The **Two links** preset has two sets of panels, each with its own selection. An unlinked panel talks only to itself.

Set a panel's link from its tab menu, or set them all in **Panels & Links**. **Messages** lists what the panels send each other.

## Saving layouts

- **Automatically:** the layout is saved in the browser after each change and restored on the next visit. This covers each panel's own settings too, such as a 3D view's camera, grid and background.
- **By name:** use **Layout › Save layout as…**, and load or manage named layouts from the Layout menu.
- **As JSON:** **Layout › Configuration…** shows the layout as JSON. Edit it and apply it, or download it as a file and open it again later; **File** has the same.
- **Presets:** **Layout › Presets** has ready-made layouts: Modelling, Two views, Two links and Viewer.

The JSON format is described in [Documentation/Layout-Format.md](Documentation/Layout-Format.md). It can be written by hand, for example:

```json
{
  "root": {
    "type": "split", "direction": "row", "sizes": [1, 3],
    "children": [
      { "type": "stack", "panels": [{ "type": "scene-tree" }] },
      { "type": "stack", "panels": [{ "type": "viewport", "title": "Main" }, { "type": "properties" }] }
    ]
  }
}
```

## The panels

| Panel | What it does |
|---|---|
| 3D View | The scene, with its own camera. Drag to orbit, right-drag to pan, scroll to zoom. Click to select, Shift+click to add to the selection, double-click to frame. Keys: Q select, W move, E rotate, R scale, F fit, Delete remove, Esc deselect. Its toolbar sets the view direction, grid, axes, wireframe and background. |
| Scene Tree | The scene's objects as a tree. Click to select; Ctrl+click and Shift+click select more. Double-click to frame, 👁 to hide. Drag a row onto another to move it inside. |
| Properties | The selected object's name, visibility, transform, material or light, for editing. |
| Edit Tools | The transform tool, with local axes and snapping. Adds shapes, groups, lights and models (glTF, GLB, STL, OBJ). Duplicates, deletes, groups and ungroups the selection. |
| Messages | The messages panels send each other, with their channel, sender and content. |
| Panels & Links | Every open panel, with its title, link and place, for editing. |

## How it is built

```
src/app/
  core/
    layout/        the layout model, its operations, the JSON reader, and LayoutService
    bus/           PanelBus: messages between panels on link channels
    panels/        panel types, PanelContext, and PanelHost, which keeps panels alive as they move
    workbench.providers.ts
  dock/            the docking UI: stacks, splits, floating windows, dragging
  ui/              menus, dialogs, theme
  panels/          the sample panels, their registry and the layout presets
  scene/           SceneDocument, the shared three.js scene, and model import
  workbench/       the page: menu bar, toolbar, workspace and status bar
```

- **Layouts are plain JSON** held in a signal. Every change goes through pure functions in `layout.ops.ts`, which return a new layout.
- **Panels keep their state as they move:** each is made once and its element is moved between containers, so a 3D view keeps its WebGL context. Hidden tabs wait off-screen, still alive.
- **Lazy loading:** the workbench, three.js and the panels load after the page shell.
- **Adding a kind of panel** takes a component and an entry in `panels/panel-types.ts`. See [Documentation/Writing-Panels.md](Documentation/Writing-Panels.md).

## Versions

- **Angular** 22.2, standalone, zoneless, with signals.
- **TypeScript** 6.0. This is the newest version Angular 22 supports; TypeScript 7 isn't supported yet.
- **three.js** 0.187.
- **Vitest** 5, for the unit tests.
