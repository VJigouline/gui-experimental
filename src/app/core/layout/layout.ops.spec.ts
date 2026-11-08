import { LayoutConfig, PanelConfig, SplitNode, StackNode, emptyLayout, split, stack } from './layout.model';
import {
  addPanel,
  allStacks,
  dockWindow,
  floatStack,
  movePanel,
  normalize,
  placedPanels,
  removePanel,
  resizeSplit,
  setMaximized,
  stackOfPanel,
  stacksOf,
} from './layout.ops';

const panel = (type = 'test'): PanelConfig => ({ type, title: type, channel: 'A', state: {} });

/** a | b, with c in a's stack. */
function sample(): LayoutConfig {
  const left = stack(['a', 'c']);
  const right = stack(['b']);
  return {
    ...emptyLayout(),
    root: split('row', [left, right], [0.4, 0.6]),
    panels: { a: panel(), b: panel(), c: panel() },
  };
}

/** The shape of a tree, without ids: `[a,c]` for a stack, `row(...)` for a split. */
function shape(node: LayoutConfig['root']): string {
  return node.type === 'stack'
    ? `[${node.panels.join(',')}]`
    : `${node.direction}(${node.children.map(shape).join(' ')})`;
}

describe('layout operations', () => {
  it('adds a panel to the largest stack by default', () => {
    const l = addPanel(sample(), 'd', panel());
    expect(shape(l.root)).toBe('row([a,c] [b,d])');
    expect(stackOfPanel(l, 'd')!.active).toBe('d');
    expect(l.panels['d']).toBeDefined();
  });

  it('puts the first panel into an empty root', () => {
    const l = addPanel(emptyLayout(), 'a', panel());
    expect(shape(l.root)).toBe('[a]');
  });

  it('removes a panel, collapsing the split it leaves', () => {
    const l = removePanel(sample(), 'b');
    expect(shape(l.root)).toBe('[a,c]');
    expect(l.panels['b']).toBeUndefined();
  });

  it('keeps an empty root stack when the last panel closes', () => {
    let l = addPanel(emptyLayout(), 'a', panel());
    l = removePanel(l, 'a');
    expect(l.root.type).toBe('stack');
    expect((l.root as StackNode).panels).toEqual([]);
  });

  it('shows the neighbouring tab when the active one closes', () => {
    let l = sample();
    l = movePanel(l, 'c', { kind: 'stack', stackId: stacksOf(l.root)[0].id, zone: 'center', index: 1 });
    expect(stackOfPanel(l, 'c')!.active).toBe('c');
    l = removePanel(l, 'c');
    expect(stackOfPanel(l, 'a')!.active).toBe('a');
  });

  it('moves a panel into another stack as a tab, at an index', () => {
    const l0 = sample();
    const right = stacksOf(l0.root)[1];
    const l = movePanel(l0, 'c', { kind: 'stack', stackId: right.id, zone: 'center', index: 0 });
    expect(shape(l.root)).toBe('row([a] [c,b])');
  });

  it('reorders tabs within a stack', () => {
    const l0 = sample();
    const left = stacksOf(l0.root)[0];
    const l = movePanel(l0, 'a', { kind: 'stack', stackId: left.id, zone: 'center', index: 1 });
    expect(shape(l.root)).toBe('row([c,a] [b])');
  });

  it('splits a stack across its direction', () => {
    const l0 = sample();
    const right = stacksOf(l0.root)[1];
    const l = movePanel(l0, 'c', { kind: 'stack', stackId: right.id, zone: 'bottom' });
    expect(shape(l.root)).toBe('row([a] column([b] [c]))');
  });

  it('splits a stack along its parent, merging into the parent split', () => {
    const l0 = sample();
    const right = stacksOf(l0.root)[1];
    const l = movePanel(l0, 'c', { kind: 'stack', stackId: right.id, zone: 'left' });
    expect(shape(l.root)).toBe('row([a] [c] [b])');
    const sizes = (l.root as SplitNode).sizes;
    expect(sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(sizes[0]).toBeCloseTo(0.4);
    expect(sizes[1]).toBeCloseTo(0.3);
  });

  it('does nothing when a lone panel is dropped on its own stack', () => {
    const l0 = sample();
    const right = stacksOf(l0.root)[1];
    expect(movePanel(l0, 'b', { kind: 'stack', stackId: right.id, zone: 'left' })).toBe(l0);
  });

  it('docks along the root edge', () => {
    const l = movePanel(sample(), 'c', { kind: 'root', zone: 'bottom' });
    expect(shape(l.root)).toBe('column(row([a] [b]) [c])');
    expect((l.root as SplitNode).sizes[1]).toBeCloseTo(0.25);
  });

  it('floats a panel and docks the window back', () => {
    let l = movePanel(sample(), 'c', { kind: 'float', x: 10, y: 20, width: 300, height: 200 });
    expect(l.floating).toHaveLength(1);
    expect(l.floating[0]).toMatchObject({ x: 10, y: 20, width: 300, height: 200 });
    expect(shape(l.floating[0].root)).toBe('[c]');
    expect(placedPanels(l).sort()).toEqual(['a', 'b', 'c']);

    l = dockWindow(l, l.floating[0].id);
    expect(l.floating).toHaveLength(0);
    expect(shape(l.root)).toBe('row([a] [b] [c])');
  });

  it('removes a window when its last panel leaves', () => {
    let l = movePanel(sample(), 'c', { kind: 'float', x: 0, y: 0 });
    const left = stacksOf(l.root)[0];
    l = movePanel(l, 'c', { kind: 'stack', stackId: left.id, zone: 'center' });
    expect(l.floating).toHaveLength(0);
  });

  it('splits inside a floating window', () => {
    let l = movePanel(sample(), 'c', { kind: 'float', x: 0, y: 0 });
    const ws = stacksOf(l.floating[0].root)[0];
    l = movePanel(l, 'b', { kind: 'stack', stackId: ws.id, zone: 'right' });
    expect(shape(l.floating[0].root)).toBe('row([c] [b])');
    expect(shape(l.root)).toBe('[a]');
  });

  it('floats a whole stack', () => {
    const l0 = sample();
    const left = stacksOf(l0.root)[0];
    const l = floatStack(l0, left.id, 5, 5, 300, 200);
    expect(shape(l.root)).toBe('[b]');
    expect(shape(l.floating[0].root)).toBe('[a,c]');
  });

  it('resizes neighbours, keeping a minimum share', () => {
    const l0 = sample();
    const id = l0.root.id;
    let l = resizeSplit(l0, id, 0, 0.1);
    expect((l.root as SplitNode).sizes[0]).toBeCloseTo(0.5);
    expect((l.root as SplitNode).sizes[1]).toBeCloseTo(0.5);
    l = resizeSplit(l, id, 0, 5);
    expect((l.root as SplitNode).sizes[1]).toBeCloseTo(0.05);
  });

  it('clears the maximized stack when it empties', () => {
    let l = sample();
    const right = stacksOf(l.root)[1];
    l = setMaximized(l, right.id);
    expect(l.maximized).toBe(right.id);
    l = removePanel(l, 'b');
    expect(l.maximized).toBeNull();
  });

  it('normalizes nested splits, single children and stray panels', () => {
    const inner = split('row', [stack(['b']), stack(['c'])], [0.5, 0.5]);
    const l: LayoutConfig = {
      ...emptyLayout(),
      root: split('row', [split('column', [stack(['a'])]), inner, stack([])], [0.5, 0.5, 0.2]),
      panels: { a: panel(), b: panel(), c: panel(), stray: panel() },
    };
    const n = normalize(l);
    expect(shape(n.root)).toBe('row([a] [b] [c])');
    expect((n.root as SplitNode).sizes.map(s => Math.round(s * 100))).toEqual([50, 25, 25]);
    expect(Object.keys(n.panels).sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves its input unchanged', () => {
    const l0 = sample();
    const before = JSON.stringify(l0);
    movePanel(l0, 'c', { kind: 'root', zone: 'top' });
    removePanel(l0, 'a');
    addPanel(l0, 'x', panel());
    expect(JSON.stringify(l0)).toBe(before);
  });

  it('keeps unchanged subtrees', () => {
    const l0 = movePanel(sample(), 'c', { kind: 'root', zone: 'bottom' });
    const top = (l0.root as SplitNode).children[0];
    const l = removePanel(l0, 'c');
    expect(l.root).toBe(top);
    expect(allStacks(l)).toHaveLength(2);
  });
});
