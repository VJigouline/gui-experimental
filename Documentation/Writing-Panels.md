# Writing panels

A panel is an Angular component. It is listed in `src/app/panels/panel-types.ts`, and uses `PanelContext` to keep its settings and talk to other panels.

## A minimal panel

```ts
import { Component, computed, inject } from '@angular/core';
import { PanelContext } from '../../core/panels/panel-context';
import { SceneDocument } from '../../scene/scene-document';

@Component({
  selector: 'app-selection-count-panel',
  template: `
    <p>{{ count() }} selected on {{ panel.channel() }}</p>
    <button type="button" class="btn" (click)="clear()">Deselect</button>
  `,
})
export class SelectionCountPanel {
  protected readonly panel = inject(PanelContext);
  private readonly doc = inject(SceneDocument);
  private readonly selection = this.panel.retained('selection');
  protected readonly count = computed(() => this.doc.objects(this.selection()?.ids).length);

  clear() {
    this.panel.publish('selection', { ids: [] }, true);
  }
}
```

Register it:

```ts
// src/app/panels/panel-types.ts
{
  type: 'selection-count',
  title: 'Selection',
  icon: '#',
  description: 'How many objects are selected',
  component: SelectionCountPanel,
  multiple: true,
},
```

It then appears in the Panels menu and a stack's ＋ menu, and can be used in layouts as `{ "type": "selection-count" }`.

| Field | Meaning |
|---|---|
| `type` | The name used in layouts. Keep it stable, as saved layouts refer to it. |
| `multiple` | `false` for panels that make sense once, such as Panels & Links. Adding a second shows the first instead. |
| `defaultState` | Optional. A function giving a new panel's state. |

## PanelContext

Each panel gets its own `PanelContext`.

| Member | Use |
|---|---|
| `id`, `type` | The panel's id and type. |
| `title()`, `channel()`, `config()` | Its title, link channel, and whole configuration, as signals. |
| `visible()` | Whether it is the tab shown in its stack. |
| `state(key, fallback)` | A value from its saved state, as a signal. |
| `setState(patch)` | Changes its saved state, which is kept with the layout. |
| `publish(topic, payload, retain?)` | Sends a message on its channel. |
| `on(topic, handler, includeOwn?)` | Handles messages on its channel until it closes, following it if its channel changes. Its own messages are left out unless `includeOwn` is set. |
| `retained(topic)` | A topic's retained value on its channel, as a signal. |
| `setTitle()`, `setChannel()`, `activate()`, `close()` | Change it in the layout. |

### Saving settings

Keep what should survive a reload or a saved layout in `state`. The values must be plain JSON. Read them as signals, and write them with `setState`:

```ts
readonly grid = this.panel.state('grid', true);
toggleGrid() { this.panel.setState({ grid: !this.grid() }); }
```

Avoid writing state on every pointer move: each write updates the layout and schedules a save. The 3D view saves its camera when a drag ends.

## Messages and channels

`PanelBus` carries messages between panels. Each message has a topic, a payload, the channel it was sent on, and the panel that sent it.

- **Channels:** panels on the same link share a channel, so a message reaches only them. An unlinked panel's channel is its own.
- **Retained messages:** these are kept as their topic's current value on the channel. A panel that opens later, or moves to that channel, sees the value at once. Use them for state such as the selection, and plain messages for commands.

These topics are defined in `BusTopics`, which gives their payloads types:

| Topic | Payload | Retained | Sent by | Heard by |
|---|---|---|---|---|
| `selection` | `{ ids: string[] }` | yes | 3D views, tree, tools | 3D views, tree, properties, tools |
| `tool.mode` | `{ mode, space, snap }` | yes | tools, 3D views (keys) | 3D views, tools |
| `viewport.command` | `{ action: 'fit', ids? }` or `{ action: 'view', view }` | no | tree, tools | 3D views |

To add a topic, add it to `BusTopics` in `core/bus/panel-bus.ts`. Topics not listed there work too, with `unknown` payloads.

## Shared services

Services that all panels share go in `provideWorkbench({ services: [...] })` in `workbench/workbench.routes.ts`, like `SceneDocument`. A panel injects them as usual.

## Panel lifecycle

- **Made:** when it is first shown.
- **Moved, hidden, or put in a window:** its element is moved to the new container rather than remade, so it keeps its state. Use a `ResizeObserver` to follow its size, which is 0 while it is hidden.
- **Destroyed:** when it is closed, or when a whole layout is loaded. Clean up in `DestroyRef.onDestroy` or `ngOnDestroy`.

The panel's host element is given the `panel-content` class, a flex column filling its slot. Panel styles go in `src/styles.scss`, since panels move between containers.

## Testing

`provideWorkbench` also sets up tests. `src/app/core/workbench.spec.ts` shows tests of the layout service and the dock with stub panels.
