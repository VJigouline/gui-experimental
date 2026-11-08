import { Component, ElementRef, afterRenderEffect, computed, inject, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BusMessage, CHANNELS, PanelBus, channelInfo } from '../../core/bus/panel-bus';
import { PanelContext } from '../../core/panels/panel-context';
import { LayoutService } from '../../core/layout/layout.service';

/** The messages panels send each other, newest last. */
@Component({
  selector: 'app-messages-panel',
  imports: [DatePipe],
  host: { class: 'messages-panel' },
  template: `
    <div class="panel-toolbar">
      <input
        class="input"
        type="search"
        placeholder="Filter by topic or panel"
        aria-label="Filter messages"
        [value]="filter()"
        (input)="panel.setState({ filter: $any($event.target).value })" />
      <select class="input" aria-label="Channel" [value]="channelFilter()" (change)="panel.setState({ channel: $any($event.target).value })">
        <option value="">All channels</option>
        @for (c of channels; track c.id) {
          <option [value]="c.id">{{ c.label }}</option>
        }
      </select>
      <button type="button" class="tool-btn" title="Clear" (click)="bus.clearLog()">Clear</button>
    </div>
    <div class="message-list" #list role="log" aria-live="polite">
      @for (m of messages(); track m.seq) {
        <div class="message-row">
          <span class="msg-time">{{ m.time | date: 'HH:mm:ss.SSS' }}</span>
          <span class="channel-chip" [style.background]="m.color" [title]="m.channelLabel"></span>
          <span class="msg-topic">{{ m.topic }}</span>
          <span class="msg-source">{{ m.sourceTitle }}</span>
          <span class="msg-payload" [title]="m.payloadText">{{ m.payloadText }}</span>
          @if (m.retained) {
            <span class="msg-flag" title="Retained: kept as the topic's value on the channel">R</span>
          }
        </div>
      } @empty {
        <div class="panel-empty small">No messages yet. Select something in a 3D view or the scene tree.</div>
      }
    </div>
  `,
})
export class MessagesPanel {
  protected readonly panel = inject(PanelContext);
  protected readonly bus = inject(PanelBus);
  private readonly layout = inject(LayoutService);
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  protected readonly channels = CHANNELS.filter(c => c.id !== 'none');
  protected readonly filter = this.panel.state('filter', '');
  protected readonly channelFilter = this.panel.state('channel', '');

  protected readonly messages = computed(() => {
    const panels = this.layout.layout().panels;
    const f = this.filter().trim().toLowerCase();
    const ch = this.channelFilter();
    return this.bus
      .log()
      .filter(m => !ch || m.channel === ch)
      .map(m => describe(m, panels))
      .filter(m => !f || m.topic.toLowerCase().includes(f) || m.sourceTitle.toLowerCase().includes(f))
      .slice(-300);
  });

  constructor() {
    afterRenderEffect(() => {
      this.messages();
      const el = this.list().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }
}

function describe(m: BusMessage, panels: Record<string, { title: string }>) {
  const unlinked = m.channel.startsWith('panel:');
  const info = unlinked ? channelInfo('none') : channelInfo(m.channel);
  let payloadText: string;
  try {
    payloadText = JSON.stringify(m.payload);
  } catch {
    payloadText = String(m.payload);
  }
  if (payloadText.length > 160) payloadText = payloadText.slice(0, 157) + '…';
  return {
    seq: m.seq,
    time: m.time,
    topic: m.topic,
    retained: m.retained,
    color: info.color,
    channelLabel: info.label,
    sourceTitle: m.source ? (panels[m.source]?.title ?? 'closed panel') : 'application',
    payloadText,
  };
}
