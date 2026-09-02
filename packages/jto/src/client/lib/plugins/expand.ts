import type { PluginRenderWarning } from './types';

/**
 * Client-side expansion of browser plugins into standard components.
 *
 * This is the same walk `createDocumentGenerator` (core-docx) and
 * `createPresentationGenerator` (core-pptx) perform for disk plugins, run in
 * the page before a document is sent anywhere: authored children are expanded
 * first and handed to `render` as `children`, the render output is expanded
 * again because it may name further custom components, and nesting is capped
 * at the same depth the cores use. Rendering itself is injected — it happens
 * in the plugin's sandbox — so this module stays pure and testable.
 *
 * Expansion moves nodes: everything after a plugin node shifts by however
 * many components the plugin produced. The result therefore carries a path
 * map, so a diagnostic the server reports against the expanded tree can be
 * pointed back at the node the author wrote.
 */

export interface ExpandablePlugin {
  name: string;
  /** Semver keys the component defines, for pin validation. */
  versions: string[];
}

export interface PluginRenderRequest {
  name: string;
  version?: string;
  props: unknown;
  theme: unknown;
  children?: unknown[];
}

export interface PluginRenderResult {
  components: unknown[];
  warnings: PluginRenderWarning[];
}

export type PluginRenderer = (
  request: PluginRenderRequest,
  signal?: AbortSignal
) => Promise<PluginRenderResult>;

/** The shape the playground's warnings bar and the server both speak. */
export interface ExpandWarning {
  component: string;
  message: string;
  severity: 'warning' | 'info';
  context?: Record<string, unknown>;
}

export interface ExpandOptions {
  plugins: ReadonlyMap<string, ExpandablePlugin>;
  /** The resolved theme handed to every render, as the cores hand it. */
  theme: unknown;
  render: PluginRenderer;
  maxDepth?: number;
  /** Emitted-node ceiling; a plugin that fans out without end is stopped here. */
  maxNodes?: number;
  signal?: AbortSignal;
}

/** Where a node of the expanded tree came from. */
export interface ExpandedOrigin {
  /** JSON pointer of the authored node: the node itself, or the plugin node that produced it. */
  authored: string;
  /** True for nodes a plugin emitted; there is no authored counterpart. */
  synthetic: boolean;
}

/** Expanded JSON pointer → origin, for every node that moved or was produced. */
export type ExpandPathMap = ReadonlyMap<string, ExpandedOrigin>;

export interface ExpandResult {
  document: unknown;
  warnings: ExpandWarning[];
  pathMap: ExpandPathMap;
}

export class PluginExpansionError extends Error {
  readonly pluginName: string | undefined;
  readonly path: string | undefined;

  constructor(message: string, pluginName?: string, path?: string) {
    super(message);
    this.name = 'PluginExpansionError';
    this.pluginName = pluginName;
    this.path = path;
  }
}

const MAX_DEPTH = 20;
const MAX_NODES = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether any node in the tree names one of `names`. */
export function documentReferencesPlugins(
  document: unknown,
  names: ReadonlySet<string>
): boolean {
  return referencedPluginNames(document, names).size > 0;
}

/** The subset of `names` the tree actually uses. */
export function referencedPluginNames(
  document: unknown,
  names: ReadonlySet<string>
): Set<string> {
  const found = new Set<string>();
  if (names.size === 0) return found;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.name === 'string' && names.has(node.name)) {
      found.add(node.name);
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  if (isRecord(document) && Array.isArray(document.children)) {
    document.children.forEach(visit);
  }
  return found;
}

const REMOTE_URL = /^https?:\/\/\S+/i;

/** Every http(s) URL held as a string value anywhere in the tree. */
export function collectRemoteUrls(
  value: unknown,
  into = new Set<string>()
): Set<string> {
  if (typeof value === 'string') {
    if (REMOTE_URL.test(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectRemoteUrls(item, into);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectRemoteUrls(item, into);
  }
  return into;
}

/**
 * Point a pointer into the expanded tree back at the authored tree.
 *
 * Inside a plugin's output there is no authored node to point at; the plugin
 * node itself is the nearest thing, and `insidePlugin` says so, because a fix
 * computed for the expanded node must not be applied there.
 */
export function remapExpandedPointer(
  pointer: string,
  pathMap: ExpandPathMap
): { path: string; insidePlugin: boolean } {
  if (!pointer.startsWith('/') || pathMap.size === 0) {
    return { path: pointer, insidePlugin: false };
  }
  const segments = pointer.split('/');
  for (let length = segments.length; length > 1; length--) {
    const prefix = segments.slice(0, length).join('/');
    const origin = pathMap.get(prefix);
    if (!origin) continue;
    if (origin.synthetic) return { path: origin.authored, insidePlugin: true };
    const rest = segments.slice(length).join('/');
    return {
      path: rest ? `${origin.authored}/${rest}` : origin.authored,
      insidePlugin: false,
    };
  }
  return { path: pointer, insidePlugin: false };
}

/**
 * Expand every browser-plugin component in `document`.
 *
 * Returns a new document (the input is never mutated), the warnings the
 * plugins raised through `addWarning` labelled `name@version` like the cores
 * label them, and the path map described above.
 */
export async function expandDocument(
  document: unknown,
  options: ExpandOptions
): Promise<ExpandResult> {
  const { plugins, theme, render, signal } = options;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_NODES;
  const warnings: ExpandWarning[] = [];
  const pathMap = new Map<string, ExpandedOrigin>();
  const authoredUrls = collectRemoteUrls(document);
  let emitted = 0;

  function checkAborted(path: string): void {
    if (signal?.aborted) {
      throw new PluginExpansionError(
        'Expansion was cancelled',
        undefined,
        path
      );
    }
  }

  /**
   * @param origin when set, every node at this level was produced by the
   *   plugin at `origin` and is synthetic
   */
  async function expandNodes(
    nodes: unknown[],
    depth: number,
    authoredPath: string,
    expandedPath: string,
    origin: string | undefined
  ): Promise<unknown[]> {
    if (depth > maxDepth) {
      throw new PluginExpansionError(
        `Maximum component nesting depth exceeded (${maxDepth}). Check for circular component references.`,
        undefined,
        authoredPath
      );
    }
    const out: unknown[] = [];
    const place = (node: unknown, authored: string, synthetic: boolean) => {
      const expanded = `${expandedPath}/${out.length}`;
      if (synthetic || expanded !== authored) {
        pathMap.set(expanded, { authored, synthetic });
      }
      out.push(node);
      return expanded;
    };

    for (let index = 0; index < nodes.length; index++) {
      checkAborted(authoredPath);
      const node = nodes[index];
      const nodeAuthored = origin ?? `${authoredPath}/${index}`;
      const synthetic = origin !== undefined;

      if (!isRecord(node) || typeof node.name !== 'string') {
        place(node, nodeAuthored, synthetic);
        continue;
      }
      const plugin = plugins.get(node.name);
      if (!plugin) {
        if (Array.isArray(node.children)) {
          const expanded = `${expandedPath}/${out.length}`;
          const children = await expandNodes(
            node.children,
            depth + 1,
            `${nodeAuthored}/children`,
            `${expanded}/children`,
            synthetic ? origin : undefined
          );
          place({ ...node, children }, nodeAuthored, synthetic);
        } else {
          place(node, nodeAuthored, synthetic);
        }
        continue;
      }

      // A disabled node is dropped, which is what the PPTX pipeline does with
      // `enabled: false` — expanding it would render what the author hid.
      if (node.enabled === false) continue;

      if (node.props === undefined || node.props === null) {
        throw new PluginExpansionError(
          `Custom component '${node.name}' must have a 'props' property. Use format: { name: '${node.name}', props: {...} }`,
          node.name,
          nodeAuthored
        );
      }
      const version =
        typeof node.version === 'string' ? node.version : undefined;
      if (version !== undefined && !plugin.versions.includes(version)) {
        throw new PluginExpansionError(
          `Component "${node.name}" does not have version "${version}". Available versions: ${plugin.versions.join(', ')}`,
          node.name,
          nodeAuthored
        );
      }
      // Authored children are expanded before the plugin sees them; their
      // positions inside the render output are the plugin's business, so
      // they map to the plugin node like everything it emits.
      const children = Array.isArray(node.children)
        ? await expandNodes(
            node.children,
            depth + 1,
            `${nodeAuthored}/children`,
            `${nodeAuthored}/children`,
            nodeAuthored
          )
        : undefined;
      const label = version ? `${node.name}@${version}` : node.name;

      let result: PluginRenderResult;
      try {
        result = await render(
          { name: node.name, version, props: node.props, theme, children },
          signal
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new PluginExpansionError(
          `Error processing custom component '${node.name}': ${
            error instanceof Error ? error.message : String(error)
          }`,
          node.name,
          nodeAuthored
        );
      }
      for (const warning of result.warnings ?? []) {
        warnings.push({
          component: label,
          message: warning.message,
          severity: 'warning',
          ...(warning.context ? { context: warning.context } : {}),
        });
      }
      if (!Array.isArray(result.components)) {
        throw new PluginExpansionError(
          `Custom component '${node.name}' must render an array of components.`,
          node.name,
          nodeAuthored
        );
      }
      // A remote source the author never wrote is the plugin reaching out on
      // the server's behalf; say so, because the Network switch does not
      // cover what the server fetches.
      for (const url of collectRemoteUrls(result.components)) {
        if (!authoredUrls.has(url)) {
          warnings.push({
            component: label,
            message: `Plugin output references a remote source the document did not: ${url}`,
            severity: 'warning',
            context: { code: 'PLUGIN_REMOTE_SOURCE', url, path: nodeAuthored },
          });
        }
      }
      emitted += result.components.length;
      if (emitted > maxNodes) {
        throw new PluginExpansionError(
          `Plugin expansion produced more than ${maxNodes} components; stopping at '${node.name}'.`,
          node.name,
          nodeAuthored
        );
      }
      const expandedResult = await expandNodes(
        result.components,
        depth + 1,
        nodeAuthored,
        expandedPath,
        nodeAuthored
      );
      // `expandNodes` placed nothing: its `out` is local. Place the pieces
      // here so their expanded positions are the ones in this array.
      for (const produced of expandedResult) {
        place(produced, nodeAuthored, true);
      }
    }
    return out;
  }

  if (!isRecord(document) || !Array.isArray(document.children)) {
    return { document, warnings, pathMap };
  }
  const children = await expandNodes(
    document.children,
    0,
    '/children',
    '/children',
    undefined
  );
  return { document: { ...document, children }, warnings, pathMap };
}
