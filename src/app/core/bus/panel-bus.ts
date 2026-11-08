import { Injectable, Signal, computed, signal } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';

/**
 * Topics panels exchange, with their payloads. Add a topic here to make it
 * type-checked; any other string is accepted with an `unknown` payload.
 */
export interface BusTopics {
  /** The objects selected, by id. Retained. */
  selection: { ids: string[] };
  /** The transform tool used by 3D views on the channel. Retained. */
  'tool.mode': { mode: ToolMode; space: 'world' | 'local'; snap: number | null };
  /** A command for 3D views on the channel. */
  'viewport.command': ViewportCommand;
}

export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale';

export type ViewportCommand =
  | { action: 'fit'; ids?: string[] }
  | { action: 'view'; view: ViewName };

export type ViewName = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export type TopicName = keyof BusTopics | (string & {});
export type Payload<T extends TopicName> = T extends keyof BusTopics ? BusTopics[T] : unknown;

export interface BusMessage<T extends TopicName = TopicName> {
  /** Increases by one with each message. */
  seq: number;
  topic: T;
  payload: Payload<T>;
  /** The channel it was sent on, as `channelKey` gives it. */
  channel: string;
  /** The panel that sent it, or `null` for the application. */
  source: string | null;
  retained: boolean;
  time: number;
}

export interface PublishOptions {
  channel: string;
  source?: string | null;
  /** Keep the message as the topic's current value on the channel, for panels that join later. */
  retain?: boolean;
}

/** A link channel that panels can be put on. */
export interface Channel {
  id: string;
  label: string;
  color: string;
}

export const CHANNELS: readonly Channel[] = [
  { id: 'A', label: 'Link A', color: '#3b82f6' },
  { id: 'B', label: 'Link B', color: '#22c55e' },
  { id: 'C', label: 'Link C', color: '#f59e0b' },
  { id: 'D', label: 'Link D', color: '#ec4899' },
  { id: 'none', label: 'Unlinked', color: '#6b7280' },
];

export function channelInfo(id: string): Channel {
  return CHANNELS.find(c => c.id === id) ?? { id, label: id, color: '#6b7280' };
}

/**
 * The key messages travel under. Panels on the same channel share it; an
 * unlinked panel gets a key of its own, so it talks only to itself.
 */
export function channelKey(channel: string, panelId: string): string {
  return channel === 'none' ? `panel:${panelId}` : channel;
}

const LOG_SIZE = 500;

/**
 * Carries messages between panels. Each message goes to a channel, and is seen
 * by everything listening on that channel. Retained messages are kept as
 * their topic's value on the channel, like MQTT's.
 */
@Injectable()
export class PanelBus {
  private seq = 0;
  private readonly messages = new Subject<BusMessage>();
  private readonly retainedStore = signal<ReadonlyMap<string, BusMessage>>(new Map());
  private readonly logStore = signal<readonly BusMessage[]>([]);

  /** Every message, as sent. */
  readonly all$: Observable<BusMessage> = this.messages.asObservable();

  /** The latest messages, oldest first. */
  readonly log: Signal<readonly BusMessage[]> = this.logStore.asReadonly();

  publish<T extends TopicName>(topic: T, payload: Payload<T>, options: PublishOptions): BusMessage<T> {
    const message: BusMessage<T> = {
      seq: ++this.seq,
      topic,
      payload,
      channel: options.channel,
      source: options.source ?? null,
      retained: options.retain ?? false,
      time: Date.now(),
    };
    if (message.retained) {
      this.retainedStore.update(m => new Map(m).set(retainKey(topic, options.channel), message));
    }
    this.logStore.update(l => (l.length >= LOG_SIZE ? [...l.slice(l.length - LOG_SIZE + 1), message] : [...l, message]));
    this.messages.next(message);
    return message;
  }

  /** Messages on a topic and channel, as they are sent. */
  on<T extends TopicName>(topic: T, channel: string | (() => string)): Observable<BusMessage<T>> {
    const current = typeof channel === 'function' ? channel : () => channel;
    return this.all$.pipe(filter((m): m is BusMessage<T> => m.topic === topic && m.channel === current()));
  }

  /** The retained message on a topic and channel, if any. */
  retainedMessage<T extends TopicName>(topic: T, channel: string): BusMessage<T> | undefined {
    return this.retainedStore().get(retainKey(topic, channel)) as BusMessage<T> | undefined;
  }

  /** A topic's retained payload on a channel, as a signal. */
  retained<T extends TopicName>(topic: T, channel: () => string): Signal<Payload<T> | undefined> {
    return computed(() => this.retainedMessage(topic, channel())?.payload);
  }

  clearLog(): void {
    this.logStore.set([]);
  }

  /** Forgets retained messages on a channel key, such as a closed panel's own. */
  forgetChannel(channel: string): void {
    const m = this.retainedStore();
    if (![...m.values()].some(v => v.channel === channel)) return;
    this.retainedStore.set(new Map([...m].filter(([, v]) => v.channel !== channel)));
  }
}

function retainKey(topic: string, channel: string): string {
  return `${channel}\u0000${topic}`;
}
