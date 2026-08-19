/**
 * Revision (tracked-change) rendering utilities
 *
 * Turns `revision.segments` from the JSON definition into native Word
 * revision runs (w:ins / w:del) via docx.js InsertedTextRun / DeletedTextRun.
 */

import { TextRun, InsertedTextRun, DeletedTextRun } from 'docx';
import type { IRunOptions, ParagraphChild } from 'docx';
import type { Revision } from '@json-to-office/shared-docx';
import { normalizeUnicodeText } from './unicode';
import { processTextWithPlaceholders } from './placeholderProcessor';
import type { TextStyle } from './textParser';
import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_REVISION_AUTHOR = 'json-to-office';
// Deterministic fallback so identical inputs produce byte-identical XML
export const DEFAULT_REVISION_DATE = '1970-01-01T00:00:00Z';

/**
 * OOXML requires a numeric id on every w:ins / w:del element, unique within
 * one document. Async-local state gives each render its own deterministic
 * counter without collisions when documents render concurrently.
 */
class RevisionIdRegistry {
  private fallbackCounter = 0;
  private readonly scopes = new AsyncLocalStorage<{ counter: number }>();

  runScoped<T>(callback: () => T): T {
    return this.scopes.run({ counter: 0 }, callback);
  }

  next(): number {
    const state = this.scopes.getStore();
    if (state) {
      state.counter += 1;
      return state.counter;
    }
    this.fallbackCounter += 1;
    return this.fallbackCounter;
  }

  /** Test-only: deterministic ids for snapshot assertions. */
  clear(): void {
    const state = this.scopes.getStore();
    if (state) {
      state.counter = 0;
    } else {
      this.fallbackCounter = 0;
    }
  }
}

export const globalRevisionIdRegistry = new RevisionIdRegistry();

export type RevisionRun = TextRun | InsertedTextRun | DeletedTextRun;

const PLACEHOLDER_PATTERN = /\{[^}]+\}/;

type RevisionBaseStyle = Omit<IRunOptions, 'text' | 'children'>;

/**
 * Build the runs for one segment, splitting on '\n' so line breaks render
 * as <w:br/> (mirroring createTextRunsWithNewlines on the normal path).
 */
function segmentRuns(
  text: string,
  makeRun: (options: IRunOptions) => RevisionRun
): RevisionRun[] {
  const lines = text.split('\n');
  return lines.map((line, index) =>
    makeRun(index === 0 ? { text: line } : { text: line, break: 1 })
  );
}

/**
 * Build paragraph children from revision segments.
 *
 * Segment text is rendered literally (no markdown parsing): a `**` opened in
 * one segment could close in another, so decorator parsing cannot work
 * per-segment. The diff engine strips markdown before diffing for this
 * reason. Placeholders ({DATE}, {PAGE}, ...) are resolved for unchanged
 * segments; inside inserted/deleted text they render literally (the diff
 * summary reports those).
 */
export function createRevisionRuns(
  revision: Revision,
  baseStyle: RevisionBaseStyle
): ParagraphChild[] {
  const author = revision.author || DEFAULT_REVISION_AUTHOR;
  const date = revision.date || DEFAULT_REVISION_DATE;

  const runs: ParagraphChild[] = [];
  for (const segment of revision.segments) {
    if (!segment.text) continue;
    const text = normalizeUnicodeText(segment.text);

    if (segment.type === 'insert') {
      runs.push(
        ...segmentRuns(
          text,
          (options) =>
            new InsertedTextRun({
              ...options,
              ...baseStyle,
              id: globalRevisionIdRegistry.next(),
              author,
              date,
            })
        )
      );
    } else if (segment.type === 'delete') {
      runs.push(
        ...segmentRuns(
          text,
          (options) =>
            new DeletedTextRun({
              ...options,
              ...baseStyle,
              id: globalRevisionIdRegistry.next(),
              author,
              date,
            })
        )
      );
    } else if (PLACEHOLDER_PATTERN.test(text)) {
      // Unchanged text keeps full placeholder fidelity ({DATE}, {PAGE}, ...)
      runs.push(
        ...processTextWithPlaceholders(text, baseStyle as TextStyle, {})
      );
    } else {
      runs.push(
        ...segmentRuns(
          text,
          (options) => new TextRun({ ...options, ...baseStyle })
        )
      );
    }
  }
  return runs;
}

type MaybeComponent = { props?: unknown; children?: unknown[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True when `value` is an object carrying a truthy `revision`. */
function hasOwnRevision(value: unknown): boolean {
  return isRecord(value) && Boolean(value.revision);
}

/**
 * True when a table cell (or header cell) carries a revision, either on the
 * cell itself or on a component nested in its `content`.
 */
function cellHasRevision(cell: unknown): boolean {
  if (!isRecord(cell)) return false;
  if (hasOwnRevision(cell)) return true;
  const content = cell.content;
  return isRecord(content) && componentHasRevision(content as MaybeComponent);
}

/**
 * True when a component carries revision data anywhere in its subtree
 * (own props, list items, table cells, or any descendant), meaning its render
 * output embeds document-scoped revision ids and must not be served from the
 * cross-document component cache.
 *
 * Tables are cacheable, and the table model is column-major, so cells reached
 * only through `props.columns[]` need an explicit descent: without it a cached
 * table would replay dead w:ins/w:del ids into later documents.
 */
export function componentHasRevision(component: MaybeComponent): boolean {
  const props = component.props as Record<string, unknown> | undefined;
  if (props) {
    if (props.revision) return true;
    const items = props.items;
    if (Array.isArray(items) && items.some(hasOwnRevision)) return true;
    // Row-parallel structural revisions (row insert/delete) live outside the
    // column-major cell grid.
    const rows = props.rows;
    if (Array.isArray(rows) && rows.some(hasOwnRevision)) return true;
    const columns = props.columns;
    if (Array.isArray(columns)) {
      const columnHasRevision = columns.some((column) => {
        if (!isRecord(column)) return false;
        if (cellHasRevision(column.header)) return true;
        const cells = column.cells;
        return Array.isArray(cells) && cells.some(cellHasRevision);
      });
      if (columnHasRevision) return true;
    }
  }
  const children = component.children;
  if (Array.isArray(children)) {
    return children.some(
      (child) =>
        isRecord(child) && componentHasRevision(child as MaybeComponent)
    );
  }
  return false;
}
