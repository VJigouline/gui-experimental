# Layout format

A layout is a JSON object describing where panels are and how they are set up. **Layout › Configuration…** shows the current one. **File › Download layout…** saves it, and **File › Open layout file…** loads one.

```json
{
  "format": "gui-experimental-layout",
  "version": 1,
  "name": "Modelling",
  "root": { ... },
  "floating": [ ... ],
  "panels": { ... }
}
```

| Field | Meaning |
|---|---|
| `format`, `version` | Optional. When given, they must be `"gui-experimental-layout"` and `1`. |
| `name` | Optional. Shown in the toolbar's Layout list. |
| `root` | The docked area: a split or a stack. Required. |
| `floating` | Floating windows, drawn in order, so the last is on top. Optional. |
| `panels` | Panels by id, for stacks that refer to them by id. Optional when stacks hold their panels in place. |

## Nodes

A **split** puts its children side by side (`row`) or one above another (`column`):

```json
{ "type": "split", "direction": "row", "sizes": [1, 3], "children": [ ... ] }
```

`sizes` are the children's relative sizes. They needn't sum to 1, and may be left out to share the space equally. Splits inside splits of the same direction are merged.

A **stack** shows one panel at a time, with a tab for each:

```json
{ "type": "stack", "panels": [ ... ], "active": 0 }
```

`active` is the panel shown, by id or index; by default it is the first. A stack may be empty only as the root.

## Panels

A stack's `panels` hold either ids into the top-level `panels` map, or panels written in place:

```json
{ "type": "stack", "panels": ["view", { "type": "properties", "channel": "B" }] }
```

| Field | Meaning |
|---|---|
| `type` | The kind of panel. Required. One of `viewport`, `scene-tree`, `properties`, `tools`, `raytrace`, `messages`, `links`. |
| `id` | For a panel written in place, optional; one is made up if it's left out. In the `panels` map, the key is the id. |
| `title` | The tab's title. Defaults to the type's title, such as "3D View". |
| `channel` | The link: `A`, `B`, `C`, `D`, or `none` for unlinked. Defaults to `A`. |
| `state` | The panel's own settings, which differ by type. Defaults to `{}`. |

A panel may appear only once in a layout.

### Panel state

| Type | State |
|---|---|
| `viewport` | `camera: { position: [x, y, z], target: [x, y, z] }`, `view` (`iso`, `top`, `bottom`, `front`, `back`, `left`, `right` or `custom`), `grid`, `axes` and `wireframe` (booleans), and `background` (a CSS colour, or `theme`). |
| `messages` | `filter` (text) and `channel` (`A`… or empty for all). |

Other panels keep no state. The Ray Tracing panel's settings are kept in the browser rather than the layout, as they apply to the whole workbench.

## Floating windows

```json
{ "x": 40, "y": 40, "width": 420, "height": 320, "root": { "type": "stack", "panels": [{ "type": "scene-tree" }] } }
```

- **Position and size:** in pixels, relative to the workspace below the toolbar.
- **Content:** a window's `root` is a split or stack, like the docked area's.

## Errors

A layout that can't be read is not applied. The error gives the place in the JSON that is at fault, such as:

```
root.children[1].panels[0].type: unknown panel type "viewer"
```

## Example

Two 3D views on separate links above a message log, and a tree in a window:

```json
{
  "name": "Compare",
  "root": {
    "type": "split", "direction": "column", "sizes": [3, 1],
    "children": [
      {
        "type": "split", "direction": "row",
        "children": [
          { "type": "stack", "panels": [{ "type": "viewport", "title": "Left", "channel": "A" }] },
          { "type": "stack", "panels": [{ "type": "viewport", "title": "Right", "channel": "B", "state": { "view": "top", "wireframe": true } }] }
        ]
      },
      { "type": "stack", "panels": [{ "type": "messages" }] }
    ]
  },
  "floating": [
    { "x": 20, "y": 20, "width": 260, "height": 340, "root": { "type": "stack", "panels": [{ "type": "scene-tree", "channel": "A" }] } }
  ]
}
```

## In the browser

These `localStorage` keys hold layouts:

- **`gui-experimental.layout.current`:** the current layout, saved after each change.
- **`gui-experimental.layout.saved`:** the named layouts, as a list of `{ name, saved, json }`.
