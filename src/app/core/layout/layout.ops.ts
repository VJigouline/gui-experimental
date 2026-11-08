import {
  DropTarget,
  FloatingWindow,
  LayoutConfig,
  LayoutNode,
  PanelConfig,
  SplitDirection,
  SplitNode,
  StackNode,
  newId,
  split,
  stack,
} from './layout.model';

/**
 * Pure operations on layouts. Each returns a new layout and leaves its input
 * unchanged, copying only the nodes on the path to what changed.
 */

/** The smallest share a split gives one child. */
export const MIN_SIZE = 0.05;

// ---------------------------------------------------------------- queries

/** Every stack in a tree, in document order. */
export function stacksOf(node: LayoutNode): StackNode[] {
  return node.type === 'stack' ? [node] : node.children.flatMap(stacksOf);
}

/** Every stack in the layout: docked first, then floating windows. */
export function allStacks(layout: LayoutConfig): StackNode[] {
  return [...stacksOf(layout.root), ...layout.floating.flatMap(w => stacksOf(w.root))];
}

export function findStack(layout: LayoutConfig, stackId: string): StackNode | undefined {
  return allStacks(layout).find(s => s.id === stackId);
}

/** The stack showing a panel. */
export function stackOfPanel(layout: LayoutConfig, panelId: string): StackNode | undefined {
  return allStacks(layout).find(s => s.panels.includes(panelId));
}

/** The floating window holding a node, or `undefined` if it is docked. */
export function windowOfNode(layout: LayoutConfig, nodeId: string): FloatingWindow | undefined {
  return layout.floating.find(w => containsNode(w.root, nodeId));
}

function containsNode(node: LayoutNode, nodeId: string): boolean {
  return node.id === nodeId || (node.type === 'split' && node.children.some(c => containsNode(c, nodeId)));
}

/** Panels placed in the layout, in document order. */
export function placedPanels(layout: LayoutConfig): string[] {
  return allStacks(layout).flatMap(s => s.panels);
}

// ---------------------------------------------------------------- tree rewriting

/** Rewrites every tree in the layout, docked and floating, bottom up. */
function mapTrees(layout: LayoutConfig, fn: (node: LayoutNode) => LayoutNode): LayoutConfig {
  const root = mapNode(layout.root, fn);
  let floatingChanged = false;
  const floating = layout.floating.map(w => {
    const r = mapNode(w.root, fn);
    if (r === w.root) return w;
    floatingChanged = true;
    return { ...w, root: r };
  });
  if (root === layout.root && !floatingChanged) return layout;
  return { ...layout, root, floating: floatingChanged ? floating : layout.floating };
}

function mapNode(node: LayoutNode, fn: (node: LayoutNode) => LayoutNode): LayoutNode {
  if (node.type === 'split') {
    let changed = false;
    const children = node.children.map(c => {
      const m = mapNode(c, fn);
      if (m !== c) changed = true;
      return m;
    });
    if (changed) node = { ...node, children };
  }
  return fn(node);
}

function updateStack(layout: LayoutConfig, stackId: string, fn: (s: StackNode) => StackNode): LayoutConfig {
  return mapTrees(layout, n => (n.type === 'stack' && n.id === stackId ? fn(n) : n));
}

/**
 * Tidies a tree:
 * - removes empty stacks, except a lone root stack;
 * - replaces splits of one child by the child;
 * - merges a split into its parent when both run the same way;
 * - rescales sizes to sum to 1.
 */
export function normalizeNode(node: LayoutNode, keepEmpty: boolean): LayoutNode | null {
  if (node.type === 'stack') {
    const panels = [...new Set(node.panels)];
    const active = node.active && panels.includes(node.active) ? node.active : (panels[0] ?? null);
    if (panels.length === 0 && !keepEmpty) return null;
    if (panels.length === node.panels.length && active === node.active) return node;
    return { ...node, panels, active };
  }

  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const n = normalizeNode(child, false);
    if (!n) return;
    const size = node.sizes[i] > 0 ? node.sizes[i] : 1 / node.children.length;
    if (n.type === 'split' && n.direction === node.direction) {
      n.children.forEach((c, j) => {
        children.push(c);
        sizes.push(size * n.sizes[j]);
      });
    } else {
      children.push(n);
      sizes.push(size);
    }
  });

  if (children.length === 0) return keepEmpty ? stack([]) : null;
  if (children.length === 1) return children[0];

  const total = sizes.reduce((a, b) => a + b, 0);
  const scaled = sizes.map(s => s / total);
  const same =
    children.length === node.children.length &&
    children.every((c, i) => c === node.children[i]) &&
    scaled.every((s, i) => Math.abs(s - node.sizes[i]) < 1e-9);
  return same ? node : { ...node, children, sizes: scaled };
}

/** Tidies all trees, drops empty windows and panels that are not placed. */
export function normalize(layout: LayoutConfig): LayoutConfig {
  const root = normalizeNode(layout.root, true)!;
  const floating: FloatingWindow[] = [];
  for (const w of layout.floating) {
    const r = normalizeNode(w.root, false);
    if (r) floating.push(r === w.root ? w : { ...w, root: r });
  }
  const placed = new Set([...stacksOf(root), ...floating.flatMap(w => stacksOf(w.root))].flatMap(s => s.panels));
  const panelIds = Object.keys(layout.panels);
  const panels =
    panelIds.every(id => placed.has(id)) && placed.size === panelIds.length
      ? layout.panels
      : Object.fromEntries(panelIds.filter(id => placed.has(id)).map(id => [id, layout.panels[id]]));
  const maximized =
    layout.maximized && stacksOf(root).some(s => s.id === layout.maximized && s.panels.length) ? layout.maximized : null;

  const floatingSame = floating.length === layout.floating.length && floating.every((w, i) => w === layout.floating[i]);
  if (root === layout.root && floatingSame && panels === layout.panels && maximized === layout.maximized) return layout;
  return { ...layout, root, floating: floatingSame ? layout.floating : floating, panels, maximized };
}

// ---------------------------------------------------------------- panels

/**
 * Adds a panel to the layout at a target. Without a target, it goes into the
 * largest docked stack, or the first one.
 */
export function addPanel(layout: LayoutConfig, id: string, panel: PanelConfig, target?: DropTarget): LayoutConfig {
  const withPanel = { ...layout, panels: { ...layout.panels, [id]: panel } };
  return normalize(insertPanel(withPanel, id, target ?? defaultTarget(withPanel)));
}

function defaultTarget(layout: LayoutConfig): DropTarget {
  const stacks = stacksOf(layout.root);
  const largest = largestStack(layout.root) ?? stacks[0];
  return { kind: 'stack', stackId: largest.id, zone: 'center' };
}

/** The stack with the largest share of the area. */
function largestStack(root: LayoutNode): StackNode | undefined {
  let best: { s: StackNode; share: number } | undefined;
  const visit = (node: LayoutNode, share: number) => {
    if (node.type === 'stack') {
      if (!best || share > best.share + 1e-9) best = { s: node, share };
    } else {
      node.children.forEach((c, i) => visit(c, share * node.sizes[i]));
    }
  };
  visit(root, 1);
  return best?.s;
}

/** Removes a panel and its configuration. */
export function removePanel(layout: LayoutConfig, panelId: string): LayoutConfig {
  const { [panelId]: _, ...panels } = layout.panels;
  return normalize({ ...detachPanel(layout, panelId), panels });
}

/** Moves a panel to a target. Dropping a panel beside or into its own lone stack changes nothing. */
export function movePanel(layout: LayoutConfig, panelId: string, target: DropTarget): LayoutConfig {
  const from = stackOfPanel(layout, panelId);
  if (!from) return layout;
  if (target.kind === 'stack' && target.stackId === from.id) {
    if (from.panels.length === 1) return layout;
    if (target.zone === 'center') {
      const panels = from.panels.filter(p => p !== panelId);
      const index = Math.min(target.index ?? panels.length, panels.length);
      panels.splice(index, 0, panelId);
      return updateStack(layout, from.id, s => ({ ...s, panels, active: panelId }));
    }
  }
  return normalize(insertPanel(detachPanel(layout, panelId), panelId, target));
}

/** Takes a panel out of its stack, leaving the stack in place even if empty. */
function detachPanel(layout: LayoutConfig, panelId: string): LayoutConfig {
  const from = stackOfPanel(layout, panelId);
  if (!from) return layout;
  return updateStack(layout, from.id, s => {
    const index = s.panels.indexOf(panelId);
    const panels = s.panels.filter(p => p !== panelId);
    const active = s.active === panelId ? (panels[Math.min(index, panels.length - 1)] ?? null) : s.active;
    return { ...s, panels, active };
  });
}

function insertPanel(layout: LayoutConfig, panelId: string, target: DropTarget): LayoutConfig {
  switch (target.kind) {
    case 'float': {
      const w: FloatingWindow = {
        id: newId('window'),
        x: Math.round(target.x),
        y: Math.round(target.y),
        width: Math.round(target.width ?? 420),
        height: Math.round(target.height ?? 320),
        root: stack([panelId]),
      };
      return { ...layout, floating: [...layout.floating, w] };
    }
    case 'root': {
      const root = layout.root;
      if (root.type === 'stack' && root.panels.length === 0) {
        return { ...layout, root: { ...root, panels: [panelId], active: panelId } };
      }
      return { ...layout, root: beside(root, stack([panelId]), target.zone, 0.25) };
    }
    case 'stack': {
      const target_ = findStack(layout, target.stackId);
      if (!target_) return insertPanel(layout, panelId, defaultTarget(layout));
      if (target.zone === 'center' || target_.panels.length === 0) {
        return updateStack(layout, target.stackId, s => {
          const panels = [...s.panels];
          panels.splice(Math.min(target.index ?? panels.length, panels.length), 0, panelId);
          return { ...s, panels, active: panelId };
        });
      }
      const added = stack([panelId]);
      const zone = target.zone;
      return mapTrees(layout, n => (n.type === 'stack' && n.id === target.stackId ? beside(n, added, zone) : n));
    }
  }
}

/** A split holding `node` and `added`, with `added` on the side given and taking `share` of it. */
function beside(node: LayoutNode, added: LayoutNode, zone: 'left' | 'right' | 'top' | 'bottom', share = 0.5): SplitNode {
  const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'row' : 'column';
  const first = zone === 'left' || zone === 'top';
  return split(direction, first ? [added, node] : [node, added], first ? [share, 1 - share] : [1 - share, share]);
}

/** Shows a panel in its stack. */
export function activatePanel(layout: LayoutConfig, panelId: string): LayoutConfig {
  const s = stackOfPanel(layout, panelId);
  if (!s || s.active === panelId) return layout;
  return updateStack(layout, s.id, n => ({ ...n, active: panelId }));
}

export function updatePanel(layout: LayoutConfig, panelId: string, patch: Partial<PanelConfig>): LayoutConfig {
  const panel = layout.panels[panelId];
  if (!panel) return layout;
  return { ...layout, panels: { ...layout.panels, [panelId]: { ...panel, ...patch } } };
}

export function patchPanelState(layout: LayoutConfig, panelId: string, patch: Record<string, unknown>): LayoutConfig {
  const panel = layout.panels[panelId];
  if (!panel) return layout;
  return updatePanel(layout, panelId, { state: { ...panel.state, ...patch } });
}

// ---------------------------------------------------------------- splits and windows

/**
 * Moves the boundary after child `index` of a split by `delta`, a share of the
 * split's length. Both neighbours keep at least `MIN_SIZE`.
 */
export function resizeSplit(layout: LayoutConfig, splitId: string, index: number, delta: number): LayoutConfig {
  return mapTrees(layout, n => {
    if (n.type !== 'split' || n.id !== splitId || index < 0 || index >= n.children.length - 1) return n;
    const sizes = [...n.sizes];
    const pair = sizes[index] + sizes[index + 1];
    const a = Math.min(Math.max(sizes[index] + delta, MIN_SIZE), pair - MIN_SIZE);
    sizes[index] = a;
    sizes[index + 1] = pair - a;
    return { ...n, sizes };
  });
}

/** Sets the sizes of a split, as given or equal. */
export function setSplitSizes(layout: LayoutConfig, splitId: string, sizes?: number[]): LayoutConfig {
  return mapTrees(layout, n => {
    if (n.type !== 'split' || n.id !== splitId) return n;
    const s = sizes && sizes.length === n.children.length ? sizes : n.children.map(() => 1 / n.children.length);
    const total = s.reduce((a, b) => a + b, 0);
    return { ...n, sizes: s.map(v => v / total) };
  });
}

export function updateWindow(
  layout: LayoutConfig,
  windowId: string,
  patch: Partial<Pick<FloatingWindow, 'x' | 'y' | 'width' | 'height'>>,
): LayoutConfig {
  let changed = false;
  const floating = layout.floating.map(w => {
    if (w.id !== windowId) return w;
    changed = true;
    return { ...w, ...patch };
  });
  return changed ? { ...layout, floating } : layout;
}

/** Puts a window last, so it is drawn on top. */
export function raiseWindow(layout: LayoutConfig, windowId: string): LayoutConfig {
  const i = layout.floating.findIndex(w => w.id === windowId);
  if (i < 0 || i === layout.floating.length - 1) return layout;
  const floating = [...layout.floating];
  const [w] = floating.splice(i, 1);
  floating.push(w);
  return { ...layout, floating };
}

/** Docks a floating window's content along the right edge of the docked area, or another edge. */
export function dockWindow(
  layout: LayoutConfig,
  windowId: string,
  zone: 'left' | 'right' | 'top' | 'bottom' = 'right',
): LayoutConfig {
  const w = layout.floating.find(f => f.id === windowId);
  if (!w) return layout;
  const floating = layout.floating.filter(f => f !== w);
  const root = layout.root;
  const docked =
    root.type === 'stack' && root.panels.length === 0
      ? w.root
      : beside(root, w.root, zone, 0.3);
  return normalize({ ...layout, root: docked, floating });
}

/** Moves a whole stack into a new floating window. */
export function floatStack(layout: LayoutConfig, stackId: string, x: number, y: number, width: number, height: number): LayoutConfig {
  const s = findStack(layout, stackId);
  if (!s || s.panels.length === 0) return layout;
  const owner = windowOfNode(layout, stackId);
  if (owner && owner.root.id === stackId) return layout;
  const emptied = updateStack(layout, stackId, n => ({ ...n, panels: [], active: null }));
  const w: FloatingWindow = {
    id: newId('window'),
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    root: { ...s, id: newId('stack') },
  };
  return normalize({ ...emptied, floating: [...emptied.floating, w], maximized: null });
}

export function setMaximized(layout: LayoutConfig, stackId: string | null): LayoutConfig {
  if (layout.maximized === stackId) return layout;
  return normalize({ ...layout, maximized: stackId });
}

/** A copy of the layout with new node and window ids. Panel ids are kept. */
export function withFreshIds(layout: LayoutConfig): LayoutConfig {
  const renew = (node: LayoutNode): LayoutNode =>
    node.type === 'stack'
      ? { ...node, id: newId('stack') }
      : { ...node, id: newId('split'), children: node.children.map(renew) };
  return {
    ...layout,
    root: renew(layout.root),
    floating: layout.floating.map(w => ({ ...w, id: newId('window'), root: renew(w.root) })),
    maximized: null,
  };
}
