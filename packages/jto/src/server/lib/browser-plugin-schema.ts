/**
 * Guards on the props schemas a browser plugin sends for composition.
 *
 * The client posts plain JSON Schema objects; the server never runs plugin
 * code, but it does inline every schema into the document schema at several
 * sites per renderer, so the aggregate size and depth are what must be
 * bounded — a per-object cap multiplied by the allowed count is no bound at
 * all. TypeBox's recursive schemas also carry `$id`s from a per-process
 * counter, so two plugins can both say `T0`; namespacing them by plugin
 * keeps one from overwriting the other's definition.
 */

export interface BrowserPluginSchemaInput {
  name: string;
  versions: Array<{
    version: string;
    propsSchema: Record<string, unknown>;
    hasChildren?: boolean;
    description?: string;
  }>;
}

export const MAX_BROWSER_SCHEMA_BYTES = 256 * 1024;
export const MAX_BROWSER_SCHEMA_DEPTH = 32;

export class BrowserPluginSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserPluginSchemaError';
  }
}

/** Deepest nesting of arrays/objects, computed without recursion. */
export function jsonDepth(value: unknown): number {
  let deepest = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const { value: current, depth } = stack.pop()!;
    if (current === null || typeof current !== 'object') continue;
    if (depth > deepest) deepest = depth;
    const children = Array.isArray(current)
      ? current
      : Object.values(current as Record<string, unknown>);
    for (const child of children) {
      if (child !== null && typeof child === 'object') {
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return deepest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A copy of `schema` with every `$id` namespaced and every `$ref` to one of
 * them rewritten to match. Local `#…` refs stay; anything else is refused —
 * a remote `$ref` is a fetch the JSON language service would try to make.
 */
export function namespaceSchemaIds(
  schema: Record<string, unknown>,
  namespace: string
): Record<string, unknown> {
  const ids = new Set<string>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.$id === 'string') ids.add(node.$id);
    Object.values(node).forEach(collect);
  };
  collect(schema);
  const rename = (id: string) => `${namespace}:${id}`;

  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$id' && typeof value === 'string') {
        out[key] = rename(value);
      } else if (key === '$ref' && typeof value === 'string') {
        if (ids.has(value)) out[key] = rename(value);
        else if (value.startsWith('#')) out[key] = value;
        else {
          throw new BrowserPluginSchemaError(
            `propsSchema references "${value}"; only ids defined in the schema itself and local "#" pointers are allowed.`
          );
        }
      } else if (key === '$schema') {
        // A dialect declaration inside a props schema changes nothing the
        // composer needs and would be hoisted as a definition.
        continue;
      } else {
        out[key] = rewrite(value);
      }
    }
    return out;
  };
  return rewrite(schema) as Record<string, unknown>;
}

/**
 * Validate the aggregate and return the components with their schemas
 * namespaced. Throws `BrowserPluginSchemaError` with a message fit for a 400.
 */
export function prepareBrowserPlugins(
  components: BrowserPluginSchemaInput[]
): BrowserPluginSchemaInput[] {
  const bytes = JSON.stringify(components).length;
  if (bytes > MAX_BROWSER_SCHEMA_BYTES) {
    throw new BrowserPluginSchemaError(
      `customComponents is ${Math.round(bytes / 1024)} KB serialized; the limit is ${MAX_BROWSER_SCHEMA_BYTES / 1024} KB.`
    );
  }
  const seen = new Set<string>();
  return components.map((component) => {
    if (seen.has(component.name)) {
      throw new BrowserPluginSchemaError(
        `customComponents lists "${component.name}" more than once.`
      );
    }
    seen.add(component.name);
    return {
      ...component,
      versions: component.versions.map((version) => {
        const depth = jsonDepth(version.propsSchema);
        if (depth > MAX_BROWSER_SCHEMA_DEPTH) {
          throw new BrowserPluginSchemaError(
            `propsSchema of "${component.name}" v${version.version} nests ${depth} levels deep; the limit is ${MAX_BROWSER_SCHEMA_DEPTH}.`
          );
        }
        return {
          ...version,
          propsSchema: namespaceSchemaIds(
            version.propsSchema,
            `${component.name}@${version.version}`
          ),
        };
      }),
    };
  });
}
