/**
 * Detection of per-instance annotation props anywhere in a component subtree.
 *
 * `revision` and `comment` both render as document-scoped OOXML ids allocated
 * from a per-render counter. A component carrying either must never be served
 * from the cross-document component cache, or a cached subtree replays dead ids
 * into a later document.
 *
 * The walk has to reach every place a component can hide: list items, table
 * cells (the table model is column-major, so cells are only reachable through
 * `props.columns[]`), components nested in a cell's `content`, and ordinary
 * children.
 */

export type MaybeComponent = { props?: unknown; children?: unknown[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True when `value` is an object with a truthy `key`. */
function hasKey(value: unknown, key: string): boolean {
  return isRecord(value) && Boolean(value[key]);
}

/** A table cell annotated directly, or holding an annotated component. */
function cellHasAnnotation(cell: unknown, key: string): boolean {
  if (!isRecord(cell)) return false;
  if (hasKey(cell, key)) return true;
  const content = cell.content;
  return (
    isRecord(content) && componentHasAnnotation(content as MaybeComponent, key)
  );
}

/**
 * True when `key` appears anywhere in the component subtree: its own props,
 * list items, row-parallel structural entries, table cells, or any descendant.
 */
export function componentHasAnnotation(
  component: MaybeComponent,
  key: string
): boolean {
  const props = component.props as Record<string, unknown> | undefined;
  if (props) {
    if (props[key]) return true;

    const items = props.items;
    if (Array.isArray(items) && items.some((item) => hasKey(item, key))) {
      return true;
    }

    // Row-parallel structural entries live outside the column-major cell grid.
    const rows = props.rows;
    if (Array.isArray(rows) && rows.some((row) => hasKey(row, key))) {
      return true;
    }

    const columns = props.columns;
    if (
      Array.isArray(columns) &&
      columns.some((column) => {
        if (!isRecord(column)) return false;
        if (cellHasAnnotation(column.header, key)) return true;
        const cells = column.cells;
        return (
          Array.isArray(cells) &&
          cells.some((cell) => cellHasAnnotation(cell, key))
        );
      })
    ) {
      return true;
    }
  }

  const children = component.children;
  if (Array.isArray(children)) {
    return children.some(
      (child) =>
        isRecord(child) && componentHasAnnotation(child as MaybeComponent, key)
    );
  }
  return false;
}
