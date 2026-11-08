import {
  FloatingWindow,
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  LayoutConfig,
  LayoutNode,
  PanelConfig,
  newId,
} from './layout.model';
import { normalize, placedPanels } from './layout.ops';

/** A layout that can't be read, with the place in it, such as `root.children[1].panels[0]`. */
export class LayoutError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'LayoutError';
  }
}

export interface ParseOptions {
  /** Whether a panel type exists. Panels of unknown types are an error. */
  isKnownType?: (type: string) => boolean;
  /** The title for a panel that doesn't give one. */
  defaultTitle?: (type: string) => string;
  /** The channel for a panel that doesn't give one. */
  defaultChannel?: string;
}

/**
 * Reads a layout from JSON text or a parsed object, checking it as it goes.
 *
 * Besides the form written by `layoutToJson`, it accepts layouts written by
 * hand, where:
 * - node and window ids may be left out;
 * - `sizes` may be left out, or not sum to 1;
 * - a stack's `panels` may hold panel objects (`{ "type": "viewport" }`)
 *   instead of ids into the top-level `panels`;
 * - a panel's `title`, `channel` and `state` may be left out.
 *
 * @throws LayoutError
 */
export function parseLayout(input: string | unknown, options: ParseOptions = {}): LayoutConfig {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new LayoutError(`not valid JSON (${(e as Error).message})`, '');
    }
  }
  return new Parser(options).layout(data);
}

type Json = Record<string, unknown>;

class Parser {
  private readonly panels: Record<string, PanelConfig> = {};
  private readonly declared = new Map<string, unknown>();
  private readonly used = new Set<string>();

  constructor(private readonly options: ParseOptions) {}

  layout(data: unknown): LayoutConfig {
    const o = this.object(data, '');
    if (o['format'] !== undefined && o['format'] !== LAYOUT_FORMAT) {
      throw new LayoutError(`format must be "${LAYOUT_FORMAT}"`, 'format');
    }
    if (o['version'] !== undefined && o['version'] !== LAYOUT_VERSION) {
      throw new LayoutError(`version ${String(o['version'])} is not supported; this is version ${LAYOUT_VERSION}`, 'version');
    }

    if (o['panels'] !== undefined) {
      const panels = this.object(o['panels'], 'panels');
      for (const [id, p] of Object.entries(panels)) this.declared.set(id, p);
    }

    if (o['root'] === undefined) throw new LayoutError('missing', 'root');
    const root = this.node(o['root'], 'root');

    const floating: FloatingWindow[] = [];
    if (o['floating'] !== undefined) {
      this.array(o['floating'], 'floating').forEach((w, i) => floating.push(this.window(w, `floating[${i}]`)));
    }

    const maximized = o['maximized'];
    if (maximized !== undefined && maximized !== null && typeof maximized !== 'string') {
      throw new LayoutError('must be a stack id or null', 'maximized');
    }

    const name = o['name'];
    const layout: LayoutConfig = {
      format: LAYOUT_FORMAT,
      version: LAYOUT_VERSION,
      ...(typeof name === 'string' && name ? { name } : {}),
      root,
      floating,
      panels: this.panels,
      maximized: typeof maximized === 'string' ? maximized : null,
    };
    const result = normalize(layout);
    if (placedPanels(result).length !== new Set(placedPanels(result)).size) {
      throw new LayoutError('a panel is placed more than once', 'root');
    }
    return result;
  }

  private node(data: unknown, path: string): LayoutNode {
    const o = this.object(data, path);
    const id = this.optionalString(o['id'], `${path}.id`);
    switch (o['type']) {
      case 'split': {
        const direction = o['direction'];
        if (direction !== 'row' && direction !== 'column') {
          throw new LayoutError('must be "row" or "column"', `${path}.direction`);
        }
        const children = this.array(o['children'], `${path}.children`).map((c, i) => this.node(c, `${path}.children[${i}]`));
        if (children.length === 0) throw new LayoutError('a split needs at least one child', `${path}.children`);
        let sizes = children.map(() => 1);
        if (o['sizes'] !== undefined) {
          const s = this.array(o['sizes'], `${path}.sizes`);
          if (s.length !== children.length || !s.every(v => typeof v === 'number' && v > 0 && Number.isFinite(v))) {
            throw new LayoutError(`must be ${children.length} positive numbers, one per child`, `${path}.sizes`);
          }
          sizes = s as number[];
        }
        const total = sizes.reduce((a, b) => a + b, 0);
        return { type: 'split', id: id ?? newId('split'), direction, children, sizes: sizes.map(v => v / total) };
      }
      case 'stack': {
        const panels = this.array(o['panels'] ?? [], `${path}.panels`).map((p, i) => this.panelRef(p, `${path}.panels[${i}]`));
        let active: string | null = panels[0] ?? null;
        if (o['active'] !== undefined && o['active'] !== null) {
          if (typeof o['active'] === 'number' && Number.isInteger(o['active']) && panels[o['active']]) {
            active = panels[o['active']];
          } else if (typeof o['active'] === 'string' && panels.includes(o['active'])) {
            active = o['active'];
          } else {
            throw new LayoutError("must be one of the stack's panel ids, or its index", `${path}.active`);
          }
        }
        return { type: 'stack', id: id ?? newId('stack'), panels, active };
      }
      default:
        throw new LayoutError('type must be "split" or "stack"', `${path}.type`);
    }
  }

  private panelRef(data: unknown, path: string): string {
    let id: string;
    let config: unknown;
    if (typeof data === 'string') {
      id = data;
      if (!this.declared.has(id)) throw new LayoutError(`no panel "${id}" in panels`, path);
      config = this.declared.get(id);
      path = `panels.${id}`;
    } else {
      const o = this.object(data, path);
      id = this.optionalString(o['id'], `${path}.id`) ?? newId('panel');
      config = o;
    }
    if (this.used.has(id)) throw new LayoutError(`panel "${id}" is placed more than once`, path);
    this.used.add(id);
    this.panels[id] = this.panel(config, path);
    return id;
  }

  private panel(data: unknown, path: string): PanelConfig {
    const o = this.object(data, path);
    const type = o['type'];
    if (typeof type !== 'string' || !type) throw new LayoutError('missing panel type', `${path}.type`);
    if (this.options.isKnownType && !this.options.isKnownType(type)) {
      throw new LayoutError(`unknown panel type "${type}"`, `${path}.type`);
    }
    const title = this.optionalString(o['title'], `${path}.title`) ?? this.options.defaultTitle?.(type) ?? type;
    const channel = this.optionalString(o['channel'], `${path}.channel`) ?? this.options.defaultChannel ?? 'A';
    const state = o['state'] === undefined ? {} : this.object(o['state'], `${path}.state`);
    return { type, title, channel, state: structuredClone(state) };
  }

  private window(data: unknown, path: string): FloatingWindow {
    const o = this.object(data, path);
    const num = (key: string, fallback: number, min: number) => {
      const v = o[key];
      if (v === undefined) return fallback;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new LayoutError('must be a number', `${path}.${key}`);
      return Math.max(min, Math.round(v));
    };
    if (o['root'] === undefined) throw new LayoutError('missing', `${path}.root`);
    return {
      id: this.optionalString(o['id'], `${path}.id`) ?? newId('window'),
      x: num('x', 80, -10000),
      y: num('y', 80, -10000),
      width: num('width', 420, 120),
      height: num('height', 320, 80),
      root: this.node(o['root'], `${path}.root`),
    };
  }

  private object(data: unknown, path: string): Json {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new LayoutError('must be an object', path);
    return data as Json;
  }

  private array(data: unknown, path: string): unknown[] {
    if (!Array.isArray(data)) throw new LayoutError('must be an array', path);
    return data;
  }

  private optionalString(data: unknown, path: string): string | undefined {
    if (data === undefined || data === null) return undefined;
    if (typeof data !== 'string' || !data) throw new LayoutError('must be a non-empty string', path);
    return data;
  }
}

/**
 * The layout as JSON text, for saving or editing. Node and window ids are
 * left out, as they are only needed while the layout is shown, unless
 * `keepIds` is set. The maximized stack is not kept without them.
 */
export function layoutToJson(layout: LayoutConfig, keepIds = false): string {
  const node = (n: LayoutNode): unknown =>
    n.type === 'stack'
      ? { type: 'stack', ...(keepIds ? { id: n.id } : {}), panels: n.panels, active: n.active }
      : {
          type: 'split',
          ...(keepIds ? { id: n.id } : {}),
          direction: n.direction,
          sizes: n.sizes.map(s => Math.round(s * 10000) / 10000),
          children: n.children.map(node),
        };
  const data = {
    format: layout.format,
    version: layout.version,
    ...(layout.name ? { name: layout.name } : {}),
    root: node(layout.root),
    floating: layout.floating.map(w => ({
      ...(keepIds ? { id: w.id } : {}),
      x: w.x,
      y: w.y,
      width: w.width,
      height: w.height,
      root: node(w.root),
    })),
    panels: layout.panels,
    ...(keepIds && layout.maximized ? { maximized: layout.maximized } : {}),
  };
  return JSON.stringify(data, null, 2);
}
