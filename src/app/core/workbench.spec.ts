import { Component, OnDestroy, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DockWorkspace } from '../dock/dock-workspace';
import { PanelBus } from './bus/panel-bus';
import { stackOfPanel, stacksOf } from './layout/layout.ops';
import { LayoutService, STORAGE_KEYS } from './layout/layout.service';
import { PanelContext } from './panels/panel-context';
import { PanelHost } from './panels/panel-host.service';
import { PanelType } from './panels/panel-type';
import { provideWorkbench } from './workbench.providers';

// jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let alive = 0;

/** A panel that shows its title and counts how many exist. */
@Component({
  selector: 'app-stub-panel',
  template: `<p class="stub">{{ panel.title() }}</p>`,
})
class StubPanel implements OnDestroy {
  readonly panel = inject(PanelContext);
  constructor() {
    alive++;
  }
  ngOnDestroy(): void {
    alive--;
  }
}

const TYPES: PanelType[] = [
  { type: 'stub', title: 'Stub', icon: 'S', description: '', component: StubPanel, multiple: true },
  { type: 'single', title: 'Single', icon: '1', description: '', component: StubPanel, multiple: false, defaultState: () => ({ n: 1 }) },
];

const PRESETS = [
  {
    id: 'two',
    name: 'Two',
    description: '',
    layout: { root: { type: 'split', direction: 'row', children: [{ type: 'stack', panels: [{ id: 'p1', type: 'stub', title: 'One' }] }, { type: 'stack', panels: [{ id: 'p2', type: 'stub', title: 'Two' }] }] } },
  },
  { id: 'one', name: 'One', description: '', layout: { root: { type: 'stack', panels: [{ id: 'q', type: 'single' }] } } },
];

function setup() {
  TestBed.configureTestingModule({ providers: [provideWorkbench({ panels: TYPES, presets: PRESETS })] });
  return TestBed.inject(LayoutService);
}

describe('LayoutService', () => {
  beforeEach(() => localStorage.clear());

  it('starts with the first preset', () => {
    const s = setup();
    expect(s.layout().name).toBe('Two');
    expect(Object.values(s.layout().panels).map(p => p.title)).toEqual(['One', 'Two']);
  });

  it('saves the layout and restores it on the next start', () => {
    const s = setup();
    s.addPanel('stub', undefined, { title: 'Three' });
    s.flushAutosave();
    expect(localStorage.getItem(STORAGE_KEYS.current)).toContain('Three');

    TestBed.resetTestingModule();
    const again = setup();
    expect(Object.values(again.layout().panels).map(p => p.title).sort()).toEqual(['One', 'Three', 'Two']);
  });

  it('falls back to the default when the saved layout is broken', () => {
    localStorage.setItem(STORAGE_KEYS.current, '{"root": {"type": "stack", "panels": [{"type": "gone"}]}}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = setup();
    expect(s.layout().name).toBe('Two');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('shows the open panel instead of adding a second of a single type', () => {
    const s = setup();
    const a = s.addPanel('single');
    const b = s.addPanel('single');
    expect(a).toBe(b);
    expect(s.layout().panels[a!].state).toEqual({ n: 1 });
  });

  it('gives added panels distinct titles', () => {
    const s = setup();
    const a = s.addPanel('stub')!;
    const b = s.addPanel('stub')!;
    expect(s.layout().panels[a].title).toBe('Stub');
    expect(s.layout().panels[b].title).toBe('Stub 2');
  });

  it('keeps named layouts', () => {
    const s = setup();
    s.saveAs('Mine');
    s.applyPreset('one');
    expect(s.layout().name).toBe('One');
    s.loadSaved('Mine');
    expect(s.layout().name).toBe('Mine');
    expect(Object.keys(s.layout().panels).sort()).toEqual(['p1', 'p2']);

    s.renameSaved('Mine', 'Ours');
    expect(s.saved().map(x => x.name)).toEqual(['Ours']);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.saved)!)[0].name).toBe('Ours');
    s.deleteSaved('Ours');
    expect(s.saved()).toEqual([]);
  });

  it('updates panel titles, channels and state', () => {
    const s = setup();
    s.renamePanel('p1', '  Renamed ');
    s.setChannel('p1', 'C');
    s.patchPanelState('p1', { zoom: 2 });
    expect(s.layout().panels['p1']).toMatchObject({ title: 'Renamed', channel: 'C', state: { zoom: 2 } });
  });
});

describe('Dock workspace', () => {
  beforeEach(() => {
    localStorage.clear();
    alive = 0;
  });

  function render() {
    const s = setup();
    const fixture = TestBed.createComponent(DockWorkspace);
    fixture.detectChanges();
    return { s, fixture, el: fixture.nativeElement as HTMLElement, host: TestBed.inject(PanelHost) };
  }

  it('draws a tab for each panel and shows the active ones', async () => {
    const { el, fixture } = render();
    await fixture.whenStable();
    expect([...el.querySelectorAll('.tab-title')].map(t => t.textContent)).toEqual(['One', 'Two']);
    expect([...el.querySelectorAll('.stub')].map(t => t.textContent)).toEqual(['One', 'Two']);
    expect(alive).toBe(2);
  });

  it('keeps a panel alive when it moves, and destroys it when it closes', async () => {
    const { s, el, fixture, host } = render();
    await fixture.whenStable();
    const before = host.element('p1');

    const target = stackOfPanel(s.layout(), 'p2')!;
    s.movePanel('p1', { kind: 'stack', stackId: target.id, zone: 'center' });
    await fixture.whenStable();
    expect(stacksOf(s.layout().root)).toHaveLength(1);
    expect(host.element('p1')).toBe(before);
    expect(alive).toBe(2);

    (el.querySelector('[data-tab-id="p1"] .tab-close') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(s.layout().panels['p1']).toBeUndefined();
    expect(alive).toBe(1);
  });

  it('keeps a hidden tab alive', async () => {
    const { s, el, fixture } = render();
    const target = stackOfPanel(s.layout(), 'p2')!;
    s.movePanel('p1', { kind: 'stack', stackId: target.id, zone: 'center' });
    s.activate('p2');
    await fixture.whenStable();
    expect(el.querySelectorAll('.stub')).toHaveLength(1);
    expect(alive).toBe(2);
  });

  it('makes panels afresh when a layout is loaded', async () => {
    const { s, fixture } = render();
    await fixture.whenStable();
    s.applyPreset('one');
    await fixture.whenStable();
    expect(alive).toBe(1);
  });

  it('draws floating windows', async () => {
    const { s, el, fixture } = render();
    s.floatPanel('p2', 30, 40, 300, 200);
    await fixture.whenStable();
    const w = el.querySelector<HTMLElement>('.floating-window')!;
    expect(w.style.left).toBe('30px');
    expect(w.querySelector('.tab-title')!.textContent).toBe('Two');
  });
});

describe('PanelContext', () => {
  beforeEach(() => localStorage.clear());

  it('keeps state in the layout and talks on its channel', () => {
    const s = setup();
    const bus = TestBed.inject(PanelBus);
    const ctx = TestBed.runInInjectionContext(() => new PanelContext('p1', 'stub'));
    const zoom = ctx.state('zoom', 1);
    expect(zoom()).toBe(1);
    ctx.setState({ zoom: 3 });
    expect(zoom()).toBe(3);
    expect(s.layout().panels['p1'].state).toEqual({ zoom: 3 });

    const got: unknown[] = [];
    ctx.on('selection', p => got.push(p));
    const sel = ctx.retained('selection');
    bus.publish('selection', { ids: ['a'] }, { channel: 'A', source: 'p2', retain: true });
    bus.publish('selection', { ids: ['b'] }, { channel: 'B', source: 'p2', retain: true });
    expect(got).toEqual([{ ids: ['a'] }]);
    expect(sel()).toEqual({ ids: ['a'] });

    ctx.setChannel('B');
    expect(sel()).toEqual({ ids: ['b'] });
    ctx.setChannel('none');
    expect(sel()).toBeUndefined();
    ctx.publish('selection', { ids: ['own'] }, true);
    expect(sel()).toEqual({ ids: ['own'] });
    expect(got).toHaveLength(1);
    ctx.dispose();
  });
});
