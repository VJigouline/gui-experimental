import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BusMessage, PanelBus, channelKey } from './panel-bus';

describe('PanelBus', () => {
  let bus: PanelBus;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PanelBus] });
    bus = TestBed.inject(PanelBus);
  });

  it('delivers messages to listeners on the same channel only', () => {
    const a: BusMessage[] = [];
    const b: BusMessage[] = [];
    bus.on('selection', 'A').subscribe(m => a.push(m));
    bus.on('selection', 'B').subscribe(m => b.push(m));
    bus.publish('selection', { ids: ['1'] }, { channel: 'A', source: 'p1' });
    expect(a.map(m => m.payload)).toEqual([{ ids: ['1'] }]);
    expect(a[0].source).toBe('p1');
    expect(b).toEqual([]);
  });

  it('follows a listener that changes channel', () => {
    const channel = signal('A');
    const got: string[] = [];
    bus.on('selection', () => channel()).subscribe(m => got.push(m.channel));
    bus.publish('selection', { ids: [] }, { channel: 'A' });
    channel.set('B');
    bus.publish('selection', { ids: [] }, { channel: 'A' });
    bus.publish('selection', { ids: [] }, { channel: 'B' });
    expect(got).toEqual(['A', 'B']);
  });

  it('keeps retained messages per channel and topic', () => {
    const channel = signal('A');
    const sel = TestBed.runInInjectionContext(() => bus.retained('selection', () => channel()));
    expect(sel()).toBeUndefined();
    bus.publish('selection', { ids: ['x'] }, { channel: 'A', retain: true });
    bus.publish('selection', { ids: ['y'] }, { channel: 'B', retain: true });
    bus.publish('selection', { ids: ['z'] }, { channel: 'A' });
    expect(sel()).toEqual({ ids: ['x'] });
    channel.set('B');
    expect(sel()).toEqual({ ids: ['y'] });
  });

  it('logs messages in order, and forgets a channel', () => {
    bus.publish('a', 1, { channel: 'A' });
    bus.publish('b', 2, { channel: 'panel:p', retain: true });
    expect(bus.log().map(m => [m.seq, m.topic])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
    bus.forgetChannel('panel:p');
    expect(bus.retainedMessage('b', 'panel:p')).toBeUndefined();
    bus.clearLog();
    expect(bus.log()).toEqual([]);
  });

  it('gives unlinked panels a channel of their own', () => {
    expect(channelKey('A', 'p1')).toBe('A');
    expect(channelKey('none', 'p1')).toBe('panel:p1');
    expect(channelKey('none', 'p1')).not.toBe(channelKey('none', 'p2'));
  });
});
