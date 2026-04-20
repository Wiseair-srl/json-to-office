/**
 * Write a value to an arbitrary path in a parsed JSON document.
 *
 * Used by the FontPickerDialog's contextual mode (opened via Monaco CodeLens)
 * and anywhere else we need to update a leaf without knowing the surrounding
 * shape. Intermediate objects/arrays are materialized when missing, so calling
 * with a path like ['slides', 0, 'components', 2, 'props', 'font', 'family']
 * works on empty or partial trees.
 */
export function mutateDocumentAtPath(
  doc: unknown,
  pathArray: (string | number)[],
  newValue: unknown
): unknown {
  if (pathArray.length === 0) return newValue;

  const root = cloneContainer(doc, pathArray[0]);
  let current: any = root;

  for (let i = 0; i < pathArray.length - 1; i++) {
    const key = pathArray[i];
    const nextKey = pathArray[i + 1];
    const existing = current[key as any];
    // Always clone one level down so we don't mutate the caller's object graph.
    const cloned = cloneContainer(existing, nextKey);
    current[key as any] = cloned;
    current = cloned;
  }

  current[pathArray[pathArray.length - 1] as any] = newValue;
  return root;
}

/**
 * Shallow-clone `value` if it's already the right container type for `childKey`;
 * otherwise create a fresh object/array. `childKey` being a number → array,
 * string → object.
 */
function cloneContainer(value: unknown, childKey: string | number): unknown {
  const wantArray = typeof childKey === 'number';
  if (wantArray) {
    if (Array.isArray(value)) return [...value];
    return [];
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
