import { Signal, computed, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { BusMessage, PanelBus, Payload, TopicName, channelKey } from '../bus/panel-bus';
import { PanelConfig } from '../layout/layout.model';
import { LayoutService } from '../layout/layout.service';
import { stackOfPanel } from '../layout/layout.ops';

/**
 * What a panel knows about itself, and how it talks to other panels. Inject
 * it in a panel component:
 *
 * ```ts
 * private readonly panel = inject(PanelContext);
 * readonly selection = this.panel.retained('selection');
 * select(id: string) { this.panel.publish('selection', { ids: [id] }, true); }
 * ```
 */
export class PanelContext {
  private readonly layoutService = inject(LayoutService);
  private readonly bus = inject(PanelBus);
  private readonly subscriptions = new Subscription();
  private readonly fallback: PanelConfig;

  /** The panel's configuration in the layout. */
  readonly config: Signal<PanelConfig>;
  readonly title: Signal<string>;
  /** The channel the panel is on: `A`, `B`, ... or `none`. */
  readonly channel: Signal<string>;
  /** The key its messages travel under; unique to it when unlinked. */
  readonly channelKey: Signal<string>;
  /** Whether the panel is the one shown in its stack. */
  readonly visible: Signal<boolean>;

  constructor(
    readonly id: string,
    readonly type: string,
  ) {
    this.fallback = this.layoutService.layout().panels[id] ?? { type, title: type, channel: 'A', state: {} };
    this.config = computed(() => this.layoutService.layout().panels[id] ?? this.fallback);
    this.title = computed(() => this.config().title);
    this.channel = computed(() => this.config().channel);
    this.channelKey = computed(() => channelKey(this.channel(), id));
    this.visible = computed(() => stackOfPanel(this.layoutService.layout(), id)?.active === id);
  }

  // ------------------------------------------------------------ saved state

  /** A value from the panel's saved state, as a signal. */
  state<T>(key: string, fallback: T): Signal<T> {
    return computed(() => {
      const v = this.config().state[key];
      return v === undefined ? fallback : (v as T);
    });
  }

  /** The panel's saved state as it is now, not tracked. */
  snapshot(): Record<string, unknown> {
    return this.config().state;
  }

  /** Changes the panel's saved state, which is kept with the layout. */
  setState(patch: Record<string, unknown>): void {
    this.layoutService.patchPanelState(this.id, patch);
  }

  setTitle(title: string): void {
    this.layoutService.renamePanel(this.id, title);
  }

  setChannel(channel: string): void {
    this.layoutService.setChannel(this.id, channel);
  }

  // ------------------------------------------------------------ messages

  /** Sends a message on the panel's channel. */
  publish<T extends TopicName>(topic: T, payload: Payload<T>, retain = false): void {
    this.bus.publish(topic, payload, { channel: this.channelKey(), source: this.id, retain });
  }

  /**
   * Calls `handler` for each message on a topic on the panel's channel, until
   * the panel closes. Its own messages are left out unless `includeOwn` is set.
   */
  on<T extends TopicName>(topic: T, handler: (payload: Payload<T>, message: BusMessage<T>) => void, includeOwn = false): void {
    this.subscriptions.add(
      this.bus.on(topic, () => this.channelKey()).subscribe(m => {
        if (includeOwn || m.source !== this.id) handler(m.payload, m);
      }),
    );
  }

  /** A topic's retained value on the panel's channel. It follows the panel when it changes channel. */
  retained<T extends TopicName>(topic: T): Signal<Payload<T> | undefined> {
    return this.bus.retained(topic, () => this.channelKey());
  }

  // ------------------------------------------------------------ layout

  /** Shows the panel, bringing its tab or window to the front. */
  activate(): void {
    this.layoutService.activate(this.id);
  }

  close(): void {
    this.layoutService.closePanel(this.id);
  }

  /** Called by the panel host when the panel is destroyed. */
  dispose(): void {
    this.subscriptions.unsubscribe();
    this.bus.forgetChannel(channelKey('none', this.id));
  }
}
