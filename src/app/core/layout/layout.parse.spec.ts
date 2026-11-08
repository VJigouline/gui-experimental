import { LAYOUT_FORMAT, SplitNode, StackNode } from './layout.model';
import { LayoutError, layoutToJson, parseLayout } from './layout.parse';
import { stacksOf } from './layout.ops';

const options = {
  isKnownType: (t: string) => ['view', 'tree'].includes(t),
  defaultTitle: (t: string) => t.toUpperCase(),
};

describe('parseLayout', () => {
  it('reads the short hand-written form', () => {
    const l = parseLayout(
      {
        root: {
          type: 'split',
          direction: 'row',
          sizes: [1, 3],
          children: [
            { type: 'stack', panels: [{ type: 'tree' }] },
            { type: 'stack', panels: [{ id: 'main', type: 'view', title: 'Main', channel: 'B', state: { grid: false } }] },
          ],
        },
      },
      options,
    );
    expect(l.format).toBe(LAYOUT_FORMAT);
    const root = l.root as SplitNode;
    expect(root.sizes).toEqual([0.25, 0.75]);
    const [tree, view] = stacksOf(root);
    expect(l.panels[tree.panels[0]]).toEqual({ type: 'tree', title: 'TREE', channel: 'A', state: {} });
    expect(view.panels).toEqual(['main']);
    expect(l.panels['main']).toEqual({ type: 'view', title: 'Main', channel: 'B', state: { grid: false } });
  });

  it('reads panels by id from the panels map, with active by id or index', () => {
    const l = parseLayout(
      {
        root: { type: 'stack', panels: ['p1', 'p2'], active: 1 },
        panels: { p1: { type: 'view' }, p2: { type: 'tree' } },
      },
      options,
    );
    expect((l.root as StackNode).active).toBe('p2');
  });

  it('round-trips through layoutToJson', () => {
    const l = parseLayout(
      {
        name: 'Test',
        root: {
          type: 'split',
          direction: 'column',
          children: [{ type: 'stack', panels: [{ id: 'a', type: 'view' }] }, { type: 'stack', panels: [{ id: 'b', type: 'tree' }] }],
        },
        floating: [{ x: 10, y: 20, width: 300, height: 200, root: { type: 'stack', panels: [{ id: 'c', type: 'view' }] } }],
      },
      options,
    );
    const again = parseLayout(layoutToJson(l), options);
    const strip = (x: unknown) => JSON.parse(layoutToJson(x as never));
    expect(strip(again)).toEqual(strip(l));
    expect(again.name).toBe('Test');
    expect(again.floating[0]).toMatchObject({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('keeps node ids only when asked', () => {
    const l = parseLayout({ root: { type: 'stack', id: 's1', panels: [{ type: 'view' }] } }, options);
    expect(layoutToJson(l)).not.toContain('"s1"');
    expect(layoutToJson(l, true)).toContain('"s1"');
  });

  it.each([
    ['not JSON', '{root:', /not valid JSON/],
    ['no root', {}, /^root: missing/],
    ['bad node type', { root: { type: 'box' } }, /root.type: type must be/],
    ['bad direction', { root: { type: 'split', direction: 'diagonal', children: [] } }, /root.direction/],
    ['empty split', { root: { type: 'split', direction: 'row', children: [] } }, /at least one child/],
    ['sizes count', { root: { type: 'split', direction: 'row', sizes: [1], children: [{ type: 'stack' }, { type: 'stack' }] } }, /root.sizes/],
    ['unknown type', { root: { type: 'stack', panels: [{ type: 'nope' }] } }, /root.panels\[0\].type: unknown panel type "nope"/],
    ['missing panel id', { root: { type: 'stack', panels: ['x'] } }, /no panel "x"/],
    ['panel twice', { root: { type: 'stack', panels: ['x', 'x'] }, panels: { x: { type: 'view' } } }, /placed more than once/],
    ['bad active', { root: { type: 'stack', panels: [{ type: 'view' }], active: 'zz' } }, /root.active/],
    ['wrong version', { version: 9, root: { type: 'stack' } }, /version 9 is not supported/],
    ['wrong format', { format: 'other', root: { type: 'stack' } }, /^format:/],
    ['bad window', { root: { type: 'stack' }, floating: [{ x: 'left', root: { type: 'stack' } }] }, /floating\[0\].x: must be a number/],
  ])('reports %s', (_, input, message) => {
    expect(() => parseLayout(input, options)).toThrow(LayoutError);
    expect(() => parseLayout(input, options)).toThrow(message);
  });

  it('accepts an empty root stack', () => {
    const l = parseLayout({ root: { type: 'stack' } }, options);
    expect((l.root as StackNode).panels).toEqual([]);
  });
});
