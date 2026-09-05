/**
 * Walk a document tree and replace components.
 *
 * The docx model holds child components in more places than `children`: a
 * section's `header` and `footer`, and a table's `columns[].header.content` and
 * `columns[].cells[].content`. Any transform that misses one of those quietly
 * leaves part of the document behind, which is exactly the kind of bug that
 * only shows up in the one template that puts a chart in a table cell.
 *
 * So the walk lives here, once, and transforms supply only the decision about
 * what to replace.
 */

/**
 * Decide what one component becomes.
 *
 * Return a replacement node to substitute it — the walk does not descend into
 * a replacement — or `undefined` to leave the node alone and keep walking.
 */
export type ComponentReplacer = (
  node: Record<string, unknown>
) => Promise<Record<string, unknown> | undefined>;

/** Return a deep copy of `doc` with `replace` applied to every component. */
export async function transformComponents<T>(
  doc: T,
  replace: ComponentReplacer
): Promise<T> {
  return (await walk(doc, replace)) as T;
}

async function walk(
  node: unknown,
  replace: ComponentReplacer
): Promise<unknown> {
  if (Array.isArray(node)) {
    return Promise.all(node.map((child) => walk(child, replace)));
  }
  if (!node || typeof node !== 'object') return node;

  const obj = node as Record<string, unknown>;
  if (typeof obj.name === 'string' && obj.props) {
    const replacement = await replace(obj);
    if (replacement) return replacement;
  }

  const next: Record<string, unknown> = { ...obj };

  if (Array.isArray(obj.children)) {
    next.children = await walk(obj.children, replace);
  }

  if (obj.props && typeof obj.props === 'object') {
    const props = obj.props as Record<string, unknown>;
    let changed = false;
    const nextProps: Record<string, unknown> = { ...props };

    // Section header/footer: arrays of component definitions, or the literal
    // `'linkToPrevious'`, which the walk returns unchanged.
    for (const key of ['header', 'footer'] as const) {
      if (Array.isArray(props[key])) {
        nextProps[key] = await walk(props[key], replace);
        changed = true;
      }
    }

    // Table columns: a cell's `content` and the column header's `content` each
    // hold a component definition (or a string).
    if (Array.isArray(props.columns)) {
      nextProps.columns = await Promise.all(
        (props.columns as unknown[]).map((column) =>
          walkColumn(column, replace)
        )
      );
      changed = true;
    }

    if (changed) next.props = nextProps;
  }

  return next;
}

async function walkColumn(
  column: unknown,
  replace: ComponentReplacer
): Promise<unknown> {
  if (!column || typeof column !== 'object') return column;
  const source = column as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };

  const header = source.header as Record<string, unknown> | undefined;
  if (header && typeof header === 'object' && 'content' in header) {
    next.header = { ...header, content: await walk(header.content, replace) };
  }

  if (Array.isArray(source.cells)) {
    next.cells = await Promise.all(
      (source.cells as unknown[]).map(async (cell) => {
        if (cell && typeof cell === 'object' && 'content' in cell) {
          const source = cell as Record<string, unknown>;
          return { ...source, content: await walk(source.content, replace) };
        }
        return cell;
      })
    );
  }

  return next;
}

/**
 * Carry a node's identity and visibility onto its replacement.
 *
 * A desugared node is still the component the author wrote: an `id` other
 * things link to, and an `enabled` flag something downstream may act on, both
 * have to survive the substitution.
 */
export function withNodeIdentity(
  original: Record<string, unknown>,
  replacement: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...replacement };
  if (original.id !== undefined) out.id = original.id;
  if (original.enabled !== undefined) out.enabled = original.enabled;
  return out;
}

/**
 * Whether any enabled component in `root` is named `name`. Walks the same
 * places the transform does — children, section header/footer, table cell
 * content — by looking at every object rather than enumerating them, which is
 * cheaper than a transform and cannot fall out of step with it. A disabled
 * subtree never renders, so nothing inside it counts.
 */
export function containsComponent(root: unknown, name: string): boolean {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some(visit);
    const obj = node as Record<string, unknown>;
    if (typeof obj.name === 'string' && obj.enabled === false) return false;
    if (obj.name === name && obj.props !== undefined) return true;
    return Object.values(obj).some(visit);
  };
  return visit(root);
}
