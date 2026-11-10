# GuiExperimental

***Playing with technologies***

A workbench of panels in one browser page, built with Angular 22 and three.js. Panels are rectangles that can be:

- **Arranged** by dragging their tabs, or by writing the layout as JSON.
- **Tabbed** together, split side by side, or floated in windows over the page.
- **Linked**, so that they work together.
- **Saved** as layouts and restored.

The sample panels edit a 3D scene: 3D views, a scene tree, properties, editing tools, ray tracing with [MeerCADRaytracer](https://github.com/VJigouline/MeerCADRaytracer), IFC and STEP import with [MeerCADIFCImport](https://github.com/VJigouline/MeerCADIFCImport) and [MeerCADStepImport](https://github.com/VJigouline/MeerCADStepImport), a message log, and a list of panels and their links.

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
| 3D View | The scene, with its own camera. Drag to orbit, right-drag to pan, scroll to zoom. Click to select, Shift+click to add to the selection, double-click to frame. **Sizing shapes:** with a box, sphere, cylinder, cone, torus or plane selected, drag its face, edge or corner to change its size; the cursor shows what will be held. A box face changes one size, an edge two and a corner three. A cylinder's or cone's side changes the diameter, a cap or the apex the height, and a rim both. A torus's outside or inside changes its outer or inner diameter, and its front or back the thickness. The opposite side stays put; hold Ctrl to keep the centre instead. Engineering dimension lines show the sizes as they change, Snap in Edit Tools rounds them, and Esc puts the shape back. Keys: Q select, W move, E rotate, R scale, F fit, U up to the assembly, B zoom box, Delete remove, Esc deselect, G walk, L face loops, Z ray trace. Walk mode (G, or 🚶 Walk): WASD or the arrows move over the ground, Q/E go down and up, drag to look, middle-drag walks left, right, up and down, the wheel walks forward and back, Shift goes fast (3× with the keys, 5× with the mouse), Ctrl+wheel sets the speed, Esc leaves. ⚙ next to Walk opens Walk settings, for the view's normal speed in m/s and the two fast multipliers. Zoom box (⊕ Zoom, or B): drag a rectangle and the view zooms to it, keeping its direction; a click zooms in twice about that point. Its toolbar sets the view direction, grid, axes, lights (💡), wireframe, face loops, reflections (🌐) and background. Face loops (⬚, or L) are the edges of solid faces and surfaces in STEP models, drawn over the faces; the button is off when the scene has none. |
| Assemblies | The product structure: assemblies, subassemblies and parts, with part counts. See [Assemblies](#assemblies). |
| Scene Tree | The scene's objects as a tree. Click to select; Ctrl+click and Shift+click select more. Double-click to frame, 👁 to hide. Drag a row onto another to move it inside. |
| Properties | The selected object's name, visibility, transform, material or light, for editing; for a box, sphere, cylinder, cone, torus or plane, also its dimensions; for a light, the settings of its kind; for a material, its type and settings, as three.js has them. For IFC elements, also their entity type, GlobalId, materials and property sets; for STEP parts, their product and shape item. |
| Edit Tools | The transform tool, with local axes and snapping. Adds shapes, groups, lights of each kind three.js has, and models (glTF, GLB, STL, OBJ, IFC, STEP). Duplicates, deletes, groups and ungroups the selection. Combines shapes into solids: union, subtract and intersect. |
| Ray Tracing | Photorealistic images of a 3D view with MeerCADRaytracer, as on SceneEditor's Photorealistic tab. See [Ray tracing](#ray-tracing). |
| Materials | A library of common materials, with previews: wood, metal, glass, plastic and rubber, stone and concrete, fabric and leather, ceramic and paint. See [Materials](#materials). |
| Messages | The messages panels send each other, with their channel, sender and content. |
| Panels & Links | Every open panel, with its title, link and place, for editing. |

## Importing models

glTF, GLB, STL, OBJ, IFC and STEP files can be imported from **File › Import model…**, the toolbar's **Import…**, or **Edit Tools**. They can also be dropped onto the page. As in SceneEditor:

- **IFC files** are read with [MeerCADIFCImport](https://github.com/VJigouline/MeerCADIFCImport): IFC2X3 and the IFC4 line, in metres with Y up. The **Import IFC** dialog sets its options first: cutting openings out of elements, circle segments, the smoothing angle, room volumes, opening volumes, and property sets. The choices are kept in the browser. Untick *Ask before each IFC import* to skip the dialog, and change the settings later in **File › IFC import settings…**.
- **STEP files** (`.stp`, `.step`, `.p21`, and gzip-compressed `.stpz`) are read with [MeerCADStepImport](https://github.com/VJigouline/MeerCADStepImport): AP203, AP214, AP242 and others, with their assembly structure, colours and units, in metres with Y up. The **Import STEP** dialog sets the tessellation first. Quality is the chord tolerance as a share of each solid's size. The angle and the per-face triangle limit can also be set, as can whether to include hidden items or prefer AP242 tessellated shapes. It is remembered and can be skipped like the IFC dialog; **File › STEP import settings…** changes it later. An IFC file named `.stp` is refused with a Failure dialog. Files of 2 MB or more are tessellated in web workers (`src/app/scene/step.worker.ts`), up to six at once. A 95 MB assembly then imports in about 6 s rather than 15, and the page keeps drawing meanwhile.
- **While a file imports,** a dialog says so, since the readers run in the page. Large IFC models take a few seconds.
- **A file that can't be read** shows a **Failure** dialog with the reason, and the scene is unchanged. Warnings go to the browser console.
- **Afterwards,** the model is named after its file, and selected and framed on a link channel. That's Link A from the menu or toolbar, the Edit Tools panel's link from there, or the link of the panel the files were dropped on.

Selecting an IFC element shows its IFC data in Properties, with each property set as a section that opens. Selecting a STEP part or assembly shows its product, ID and placement, and for its meshes the shape item they came from.

## Solids

Shapes can be combined into solids, which are worked out with [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg):

- **Making one:** select two or more boxes, spheres, cylinders, cones, tori, knots or solids, then use **Union**, **Subtract** or **Intersect** in **Edit Tools**. Subtract takes the rest from the one selected first. Planes, groups and imported models can't take part.
- **The solid tree:** a solid is a node in the scene tree, with its operands inside it in order, and solids can be operands of other solids. Drag a shape onto a solid in the tree to add it, or out to take it away. Hide an operand to leave it out for a while.
- **Editing:** the result follows its operands as they change: moved with the gizmo, sized by dragging, or typed in Properties. Operands are out of view, but a selected one is drawn as a ghost through the result and can still be moved and sized. Click the result to select the solid, or **Alt+click** to select the operand under the pointer.
- **Properties** sets a solid's operation; for an operand, it shows its place and moves it earlier or later. A solid's colour and finish are its operands', and cut faces take the colour of the shape that cut them.
- **Ungroup** turns a solid back into its shapes, where they were.

## Lights

**Edit Tools › Lights** adds the lights three.js has:

| Light | What it does | Settings in Properties |
|---|---|---|
| Ambient | The same light from every way, without shadows | colour, intensity |
| Hemisphere | Sky colour from above, ground colour from below; its position sets which way is up | sky and ground colours, intensity |
| Directional | Parallel rays, like the sun, from its position towards its target | colour, intensity, aim, shadows |
| Point | Light from one point every way, like a bulb | colour, intensity, distance, decay, shadows |
| Spot | A cone of light from its position towards its target | colour, intensity, distance, decay, cone angle, penumbra, aim, shadows |
| Area | Light from a rectangle facing along its −Z axis, like a window | colour, intensity, width, height |

- **In a 3D view,** lights are drawn as three.js's light helpers, with 💡 in the toolbar to show or hide them. Click near a light to select it, then move or turn it with the gizmo.
- **Aiming:** a directional or spot light shines at its target, which moves and turns with it. Drag the yellow ◎ of a selected light to aim it, or type the point in **Aim at**. Esc puts it back.
- **Shadows:** directional, point and spot lights cast shadows when **Cast shadows** is ticked. New shapes cast and receive them; a directional light's shadow is fitted to the scene when it is turned on.
- **Ray tracing** draws every kind except area lights, which it leaves out.

## Assemblies

The **Assemblies** panel shows the scene as a product structure: assemblies, subassemblies and parts, without lights. Assemblies show how many parts they hold, at any depth, and their part numbers. STEP models keep their structure: a product with products inside is an assembly, and the placed-instance groups between them are left out of the list.

- **Making an assembly:** select parts or assemblies, in the panel, the scene tree or a 3D view, then **Make assembly**, or **🗂 Assembly** in Edit Tools. They keep where they are, and the new assembly goes in the smallest assembly that holds them all, as a subassembly; its origin is the middle of their base. Lights, and shapes inside solids, stay out.
- **Moving items:** drag a row onto an assembly to move it in, or onto the top row to take it out of its assemblies.
- **Going up:** **↑ Up**, or U in a 3D view, selects the assembly the selection is in. Properties shows the assemblies an item is in, as links.
- **Properties** sets an assembly's part number and description, and says what it holds.
- **Dissolve** removes an assembly, moving its items up into the one it was in.

## Materials

**Properties › Material** edits the material of the selected shape, model part or solid:

- **Type:** Basic, Lambert, Phong, Standard, Physical, Toon or Normal, the mesh materials three.js has. Changing it keeps the settings the two types share, such as colour, emissive colour, opacity and textures.
- **Settings,** in groups, as the type has them:
  - Surface: colour, and roughness and metalness, or Phong's specular colour and shininess.
  - Emission: emissive colour and intensity.
  - Specular: index of refraction, specular intensity and colour, and anisotropy.
  - Clear coat, Sheen and Iridescence.
  - Transmission, for glass: transmission, thickness, attenuation colour and distance, and dispersion.
  - Rendering: opacity, transparency, alpha test, sides, flat shading, wireframe, and depth test and write.
- **Several materials:** a part with several materials has a Slot list to choose one. A material shared with other objects changes for all of them, and the panel says so. For a solid, changes go to all the shapes it is made of.
- **Ray tracing** leaves out the settings marked †, and shades Normal materials as Lambert.

**The Materials panel** is a library of 54 common materials in seven groups: wood, metal, glass, plastic and rubber, stone and concrete, fabric and leather, and ceramic and paint. Each has a preview, a ball over a checkered floor, drawn when the panel opens.

- **Finding one:** pick a group, or search by name or description.
- **Giving it to objects:** select objects, then click a material; or drag it onto an object in a 3D view. Given to a group or an imported model, it goes to every part inside. The selected objects' materials are outlined in the library.
- **What it is:** an ordinary three.js material, Standard or Physical, named after the library material. Wood, stone and fabric have textures made here, such as wood grain and marble veins. The objects share it, so editing it in Properties changes them together, and Properties shows which library material it came from.
- **Reflections:** 🌐 in a 3D view lights the scene with a room around it, as the previews are, which metal and glass reflect. It is on by default, at half strength, and ray tracing leaves it out.

## Ray tracing

[MeerCADRaytracer](https://github.com/VJigouline/MeerCADRaytracer) traces the scene in web workers, as in SceneEditor.

- **Over a 3D view:** press **Z** in a 3D view, or use its ☀ Ray trace button, to show the ray traced image over it. Press Z again to go back. The view still takes the mouse, so orbiting, selecting and the gizmo keep working, and every change starts the image again.
- **In a separate window:** the Ray Tracing panel's ⧉ Window opens a browser window showing the image, which follows the 3D view's camera while the view keeps drawing with WebGL. Closing that window turns ray tracing off.
- **The Ray Tracing panel** chooses which 3D view to trace, and shows progress. It restarts, stops and saves the image as PNG, and has SceneEditor's settings: samples, bounces, resolution, preview, worker threads, shadows, global illumination, tone mapping, exposure, colour space and background. The settings are kept in the browser.
- **Adding the panel:** it is a tab in the Modelling preset. Added from the Panels menu or toolbar, it opens in a floating window, like a dialog box.

- **Environment:** what is around the scene, seen in reflections and refractions and lighting it: **Studio** (soft light boxes, as product photos use), **Sky**, **Sunset**, **Overcast**, or files: **.hdr**, **.exr** or ordinary images in any of these projections, which the panel guesses from the image's shape and lets you change:
  - **Equirectangular:** a 2:1 panorama.
  - **Cube maps:** six images (named px, nx, py, ny, pz, nz, or posx, right, top, front and so on), or one image as a horizontal cross (4:3), a vertical cross (3:4), or a strip (6:1 or 1:6). Faces go where three.js puts them in a cube texture.
  - **Spheres:** a photo of a mirror ball, or an angular-map light probe, both seen from +Z.
  - **Cylindrical:** a panorama all the way round, with a band above and below the horizon.

  Each is turned into an equirectangular image for the tracer. The panel shows it as one picture, with its intensity, its rotation round the vertical axis, and whether it shows behind the scene instead of the background colour. It starts as Studio at half strength, like the 3D views' reflections; a loaded file is kept for the visit only.

One renderer is shared, so one 3D view is traced at a time.

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
  scene/           SceneDocument, the shared three.js scene, and model import, including IFC and STEP
  raytrace/        RaytraceService and its web worker, running MeerCADRaytracer
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
- **MeerCADRaytracer**, **MeerCADIFCImport** and **MeerCADStepImport**, pinned to commits, as in SceneEditor.
- **three-bvh-csg** 0.0.18, for solids, with three-mesh-bvh pinned to 0.9.10, the last without deprecation warnings for it.
- **Vitest** 5, for the unit tests.
