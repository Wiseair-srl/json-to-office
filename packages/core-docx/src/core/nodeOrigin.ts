/**
 * Where a component sits in the standard definition, carried to the compiler.
 *
 * Between `standardDefinition` and the IR the tree is copied many times —
 * defaults resolved, charts and visuals desugared, sections flattened, laid
 * out — and none of those copies keeps a path. The render manifest has to say
 * which node of the returned tree each embedded image came from, so the path
 * rides on the node itself under a symbol key: an object spread copies it,
 * while `JSON.stringify`, `Object.keys` and every cache key built from them
 * never see it. That is what keeps the document bytes unchanged.
 *
 * The tag goes on a copy, never on the caller's objects: one object reused at
 * two places in a document would otherwise carry a single path for both.
 */

export interface NodeOrigin {
  /** Dot path of the node in the standard definition, e.g. `children.4.children.2`. */
  standardPath: string;
  /** The standard component's name at that path. */
  kind: string;
}

const NODE_ORIGIN: unique symbol = Symbol('json-to-office.nodeOrigin');

type Rec = Record<string | symbol, unknown>;

function isComponentNode(value: Rec): boolean {
  return typeof value.name === 'string' && 'props' in value;
}

function isPlainRecord(value: unknown): value is Rec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Copy `root`, tagging every component node with its path from `root`.
 *
 * Plain objects and arrays are copied; anything else — strings, buffers,
 * dates — is shared, so the copy costs a walk and not the image bytes.
 */
export function tagNodeOrigins<T>(root: T): T {
  const visit = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((item, index) => visit(item, join(path, index)));
    }
    if (!isPlainRecord(value)) return value;
    const out: Rec = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = visit(item, join(path, key));
    }
    if (path !== '' && isComponentNode(value)) {
      out[NODE_ORIGIN] = {
        standardPath: path,
        kind: value.name as string,
      } satisfies NodeOrigin;
    }
    return out;
  };
  return visit(root, '') as T;
}

function join(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

/** The origin a node was tagged with, if any. */
export function nodeOrigin(node: unknown): NodeOrigin | undefined {
  if (!node || typeof node !== 'object') return undefined;
  return (node as Rec)[NODE_ORIGIN] as NodeOrigin | undefined;
}

/**
 * Carry `original`'s origin onto a node built to replace it. A desugared chart
 * is still the node the author placed: its image comes from that path.
 */
export function withNodeOrigin<T extends object>(original: object, next: T): T {
  const origin = nodeOrigin(original);
  if (origin) (next as Rec)[NODE_ORIGIN] = origin;
  return next;
}
