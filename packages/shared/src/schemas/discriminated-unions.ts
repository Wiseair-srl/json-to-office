/**
 * Canonical `if/then` restructuring for name-discriminated component unions.
 *
 * The generators export component unions as a flat `anyOf`. Schema-driven
 * editors (Monaco, VS Code — vscode-json-languageservice) resolve a partially
 * typed node against an `anyOf` by picking the single best-matching branch:
 * while typing `{ "name": | }`, every branch requiring `props` fails
 * validation, so its name const never reached autocomplete, and diagnostics
 * reported one arbitrary branch's complaints ("Value must be \"heading\"",
 * "Missing property \"props\"") instead of the real problem.
 *
 * This transform rewrites each such union — at JSON-Schema export time only,
 * the runtime TypeBox validators are untouched — into the standard
 * discriminated-union dispatch:
 *
 *   {
 *     type: "object",
 *     required: ["name"],
 *     properties: { name: { anyOf: [{ const, description }, …] } },
 *     allOf: [
 *       { if: { properties: { name: { const } }, required: ["name"] },
 *         then: <branch> },
 *       …
 *     ]
 *   }
 *
 * The accepted set of documents is exactly the same — `properties.name` is
 * the enum the branches already imply, and each `then` is the original
 * branch — but editors now behave deterministically:
 * - completing `name` offers every component, with its description
 * - an empty object reports only `Missing property "name"`
 * - a wrong name reports only `Value is not accepted. Valid values: …`
 * - a valid name activates exactly its branch for keys, props and errors
 *
 * Standard draft-07 keywords only, so ajv and every schema-aware editor
 * agree. Versioned plugin branches share a name; they stay grouped in a
 * small `anyOf` inside their `then`, containing best-match ambiguity to the
 * component's own versions.
 */

interface SchemaNode {
  [key: string]: unknown;
}

interface NameConstEntry {
  const: string;
  type: 'string';
  description?: string;
}

/** A union branch shaped `{ properties: { name: { const: "..." } } }`. */
function branchNameConst(branch: unknown): string | undefined {
  if (typeof branch !== 'object' || branch === null || Array.isArray(branch))
    return undefined;
  const name = ((branch as SchemaNode).properties as SchemaNode | undefined)
    ?.name as SchemaNode | undefined;
  return typeof name?.const === 'string' ? name.const : undefined;
}

/** True when the branch also discriminates on a `version` const (plugins). */
function isVersionedBranch(branch: SchemaNode): boolean {
  const version = (branch.properties as SchemaNode | undefined)?.version as
    | SchemaNode
    | undefined;
  return typeof version?.const === 'string';
}

function branchRequiresName(branch: SchemaNode): boolean {
  return Array.isArray(branch.required) && branch.required.includes('name');
}

/** Group branches by their name const, preserving union order. */
function groupByName(branches: SchemaNode[]): Map<string, SchemaNode[]> {
  const groups = new Map<string, SchemaNode[]>();
  for (const branch of branches) {
    const name = branchNameConst(branch)!;
    const group = groups.get(name);
    if (group) group.push(branch);
    else groups.set(name, [branch]);
  }
  return groups;
}

function nameEntry(name: string, group: SchemaNode[]): NameConstEntry {
  // Versioned plugins repeat the same name across version branches; the
  // un-versioned fallback carries the cleanest component description.
  const source =
    group.find(
      (b) => !isVersionedBranch(b) && typeof b.description === 'string'
    ) ?? group.find((b) => typeof b.description === 'string');
  return {
    const: name,
    type: 'string',
    ...(source ? { description: source.description as string } : {}),
  };
}

/**
 * Walk a JSON Schema and restructure every `anyOf` union whose branches are
 * all name-discriminated objects into the `if/then` dispatch shape above.
 *
 * Mutates in place. Conservative by design — a union is only restructured
 * when the rewrite is provably equivalent:
 * - every branch is an object with a `name` const that lists `name` as
 *   required (unions containing `$ref` or free-form branches are left alone;
 *   a `$ref`'s target union is restructured where it is defined)
 * - the node declares no `properties`, `allOf`, `if`, `required` or `type`
 *   of its own that the rewrite would have to merge with
 * - at least two distinct names; single-name unions (a versioned plugin's
 *   variants) validate and complete fine as a plain anyOf
 */
export function restructureNameDiscriminatedUnions(schema: unknown): void {
  const visited = new WeakSet<object>();

  function walk(node: unknown): void {
    if (typeof node !== 'object' || node === null) return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const obj = node as SchemaNode;
    const anyOf = obj.anyOf;
    const isCandidate =
      Array.isArray(anyOf) &&
      anyOf.length >= 2 &&
      anyOf.every(
        (b) => branchNameConst(b) !== undefined && branchRequiresName(b)
      ) &&
      obj.properties === undefined &&
      obj.allOf === undefined &&
      obj.if === undefined &&
      obj.required === undefined &&
      (obj.type === undefined || obj.type === 'object');
    // Dispatch needs at least two distinct names. Same-name groups (a
    // versioned plugin's variants) stay a plain anyOf — restructuring them
    // would recurse forever on the group it just created.
    const groups = isCandidate ? groupByName(anyOf as SchemaNode[]) : undefined;
    if (groups && groups.size >= 2) {
      obj.type = 'object';
      obj.required = ['name'];
      obj.properties = {
        name: {
          anyOf: [...groups.entries()].map(([name, group]) =>
            nameEntry(name, group)
          ),
        },
      };
      obj.allOf = [...groups.entries()].map(([name, group]) => ({
        if: {
          properties: { name: { const: name } },
          required: ['name'],
        },
        then: group.length === 1 ? group[0] : { anyOf: group },
      }));
      delete obj.anyOf;
    }

    for (const value of Object.values(obj)) walk(value);
  }

  walk(schema);
}

/**
 * Iterate the component branches of an exported union, whichever shape it is
 * in — the flat `anyOf` the generators emit, or the `if/then` dispatch this
 * module rewrites it into. For consumers that post-process branch objects
 * (description enhancement, theme-name injection, …).
 */
export function unionBranches(schema: unknown): SchemaNode[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const obj = schema as SchemaNode;
  if (Array.isArray(obj.anyOf)) {
    return obj.anyOf.filter(
      (b): b is SchemaNode => typeof b === 'object' && b !== null
    );
  }
  if (Array.isArray(obj.allOf)) {
    return obj.allOf.flatMap((entry): SchemaNode[] => {
      const then = (entry as SchemaNode | null)?.then;
      if (typeof then !== 'object' || then === null) return [];
      const inner = (then as SchemaNode).anyOf;
      return Array.isArray(inner)
        ? inner.filter(
            (b): b is SchemaNode => typeof b === 'object' && b !== null
          )
        : [then as SchemaNode];
    });
  }
  return [];
}
