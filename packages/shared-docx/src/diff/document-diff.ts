/**
 * Document diff engine
 *
 * Compares two json-to-office DOCX definitions and produces a redline
 * document: a third definition (based on the new one) where text changes
 * are expressed as `revision` segments that the renderer turns into native
 * Word tracked changes (w:ins / w:del).
 *
 * Scope (v1):
 * - paragraph / heading: word-level tracked changes
 * - list: item-level alignment, word-level tracked changes per item
 * - containers (section, columns, text-box, ...): recursed into
 * - everything else (table, image, chart, ...): block replace, reported
 *   as an *untracked* change in the summary — Word has no native revision
 *   for these at the fidelity docx.js supports.
 */

import { diffWords, stripMarkdown, type DiffSegment } from './word-diff';

/** Structural view of any component node — schemas validate elsewhere. */
export interface JsonNode {
  name: string;
  props?: Record<string, unknown>;
  children?: JsonNode[];
  [key: string]: unknown;
}

export interface DiffDocumentsOptions {
  /** Revision author shown in Word (default: "json-to-office") */
  author?: string;
  /** Revision timestamp, ISO 8601 (default: deterministic epoch) */
  date?: string;
}

export interface UntrackedChange {
  /** JSON-pointer-ish location in the NEW document */
  path: string;
  kind: 'modified' | 'inserted' | 'deleted';
  component: string;
  detail: string;
}

export interface DiffSummary {
  /** Blocks rendered with native tracked changes */
  tracked: {
    modified: number;
    inserted: number;
    deleted: number;
  };
  /** Changes the redline cannot express as native revisions */
  untracked: UntrackedChange[];
  unchangedBlocks: number;
  /** Aggregate fidelity caveats about the redline */
  notes: string[];
}

export interface DiffDocumentsResult {
  /** Redline document definition (renderable as-is) */
  document: JsonNode;
  summary: DiffSummary;
}

const TEXT_COMPONENTS = new Set(['paragraph', 'heading']);

type ListItem = string | { text: string; level?: number };

interface NormalizedListItem {
  /** Original item text (markdown intact) — emitted for unchanged items */
  raw: string;
  /** NFC-normalized, markdown-stripped text — used for alignment and diffing */
  text: string;
  level: number;
}

interface DiffContext {
  author?: string;
  date?: string;
  summary: DiffSummary;
}

// Key-order sensitive: props objects with the same entries in a different
// order compare unequal. Acceptable — inputs are machine-generated and a
// false "changed" only adds a spurious untracked summary entry.
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function makeRevision(ctx: DiffContext, segments: DiffSegment[]) {
  return {
    ...(ctx.author && { author: ctx.author }),
    ...(ctx.date && { date: ctx.date }),
    segments,
  };
}

/** Raw text prop, NFC-normalized (matching the renderer's normalization). */
function rawText(node: JsonNode): string {
  const text = node.props?.text;
  return typeof text === 'string' ? text.normalize('NFC') : '';
}

/** Text of a text component as it renders: NFC-normalized, markdown stripped. */
function plainText(node: JsonNode): string {
  return stripMarkdown(rawText(node));
}

const PLACEHOLDER_PATTERN = /\{[^}]+\}/;

/** A node is rendered unless it explicitly opts out with enabled: false. */
function isEnabled(node: JsonNode): boolean {
  return node.enabled !== false;
}

function notePlaceholdersInChanges(
  segments: DiffSegment[],
  path: string,
  component: string,
  ctx: DiffContext
): void {
  if (
    segments.some((s) => s.type !== 'equal' && PLACEHOLDER_PATTERN.test(s.text))
  ) {
    ctx.summary.untracked.push({
      path,
      kind: 'modified',
      component,
      detail:
        'placeholder (e.g. {DATE}) inside inserted/deleted text renders literally in the redline',
    });
  }
}

function propsWithout(
  props: Record<string, unknown> | undefined,
  ...keys: string[]
): Record<string, unknown> {
  const copy = { ...(props || {}) };
  for (const key of keys) delete copy[key];
  return copy;
}

// ---------------------------------------------------------------------------
// Generic LCS alignment over arrays
// ---------------------------------------------------------------------------

type AlignOp<T> =
  | { op: 'equal'; oldItem: T; newItem: T }
  | { op: 'delete'; oldItem: T }
  | { op: 'insert'; newItem: T };

/**
 * Above this many DP cells the LCS table is not worth its memory (an
 * Int32Array table lives off the V8 heap). Typical edits touch few blocks,
 * so the prefix/suffix trim below makes the table tiny in practice.
 */
const MAX_ALIGN_CELLS = 4_000_000;

/** LCS alignment of two arrays under a stable key function. */
function alignByLcs<T>(
  oldItems: T[],
  newItems: T[],
  key: (item: T) => string
): AlignOp<T>[] {
  const oldKeys = oldItems.map(key);
  const newKeys = newItems.map(key);

  // Trim the common prefix and suffix — emitted as equal ops directly
  let start = 0;
  while (
    start < oldItems.length &&
    start < newItems.length &&
    oldKeys[start] === newKeys[start]
  ) {
    start++;
  }
  let oldEnd = oldItems.length;
  let newEnd = newItems.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldKeys[oldEnd - 1] === newKeys[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  const prefix: AlignOp<T>[] = [];
  for (let k = 0; k < start; k++) {
    prefix.push({ op: 'equal', oldItem: oldItems[k], newItem: newItems[k] });
  }
  const suffix: AlignOp<T>[] = [];
  for (let k = 0; k < oldItems.length - oldEnd; k++) {
    suffix.push({
      op: 'equal',
      oldItem: oldItems[oldEnd + k],
      newItem: newItems[newEnd + k],
    });
  }

  const n = oldEnd - start;
  const m = newEnd - start;
  const middle: AlignOp<T>[] = [];

  if (n * m > MAX_ALIGN_CELLS) {
    // Degenerate fallback: replace the whole middle
    for (let k = 0; k < n; k++) {
      middle.push({ op: 'delete', oldItem: oldItems[start + k] });
    }
    for (let k = 0; k < m; k++) {
      middle.push({ op: 'insert', newItem: newItems[start + k] });
    }
    return [...prefix, ...middle, ...suffix];
  }

  const lcs: Int32Array[] = Array.from(
    { length: n + 1 },
    () => new Int32Array(m + 1)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        oldKeys[start + i] === newKeys[start + j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldKeys[start + i] === newKeys[start + j]) {
      middle.push({
        op: 'equal',
        oldItem: oldItems[start + i],
        newItem: newItems[start + j],
      });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      middle.push({ op: 'delete', oldItem: oldItems[start + i] });
      i++;
    } else {
      middle.push({ op: 'insert', newItem: newItems[start + j] });
      j++;
    }
  }
  while (i < n) middle.push({ op: 'delete', oldItem: oldItems[start + i++] });
  while (j < m) middle.push({ op: 'insert', newItem: newItems[start + j++] });

  return [...prefix, ...middle, ...suffix];
}

/**
 * Within a run of deletes+inserts between two equal anchors, pair removed
 * and added nodes that share the same component name ("modified" instead of
 * "deleted + inserted"). Pairing is greedy and order-preserving.
 */
interface GapPairing<T> {
  pairs: { oldItem: T; newItem: T }[];
  /** Emission plan preserving relative order */
  plan: (
    | { kind: 'deleted'; oldItem: T }
    | { kind: 'inserted'; newItem: T }
    | { kind: 'paired'; oldItem: T; newItem: T }
  )[];
}

function pairGap<T>(
  deleted: T[],
  inserted: T[],
  pairable: (oldItem: T, newItem: T) => boolean
): GapPairing<T> {
  const usedOld = new Array<boolean>(deleted.length).fill(false);
  const pairing = new Array<number>(inserted.length).fill(-1);

  let searchFrom = 0;
  for (let j = 0; j < inserted.length; j++) {
    for (let i = searchFrom; i < deleted.length; i++) {
      if (!usedOld[i] && pairable(deleted[i], inserted[j])) {
        usedOld[i] = true;
        pairing[j] = i;
        searchFrom = i + 1; // keep pairs order-preserving
        break;
      }
    }
  }

  const plan: GapPairing<T>['plan'] = [];
  const pairs: GapPairing<T>['pairs'] = [];
  let emittedOld = 0;
  for (let j = 0; j < inserted.length; j++) {
    const i = pairing[j];
    if (i >= 0) {
      // Old nodes before this pair that were never matched: emit as deleted
      while (emittedOld < i) {
        if (!usedOld[emittedOld]) {
          plan.push({ kind: 'deleted', oldItem: deleted[emittedOld] });
        }
        emittedOld++;
      }
      emittedOld = i + 1;
      plan.push({ kind: 'paired', oldItem: deleted[i], newItem: inserted[j] });
      pairs.push({ oldItem: deleted[i], newItem: inserted[j] });
    } else {
      plan.push({ kind: 'inserted', newItem: inserted[j] });
    }
  }
  for (let i = emittedOld; i < deleted.length; i++) {
    if (!usedOld[i]) plan.push({ kind: 'deleted', oldItem: deleted[i] });
  }
  return { pairs, plan };
}

// ---------------------------------------------------------------------------
// Component-level diff
// ---------------------------------------------------------------------------

/** Modified text component → new node carrying revision segments. */
function diffTextComponent(
  oldNode: JsonNode,
  newNode: JsonNode,
  path: string,
  ctx: DiffContext
): JsonNode {
  const oldText = plainText(oldNode);
  const newText = plainText(newNode);

  const propsChanged = !deepEqual(
    propsWithout(oldNode.props, 'text', 'revision'),
    propsWithout(newNode.props, 'text', 'revision')
  );
  if (propsChanged) {
    ctx.summary.untracked.push({
      path,
      kind: 'modified',
      component: newNode.name,
      detail:
        'formatting/props changed (not expressible as a tracked change); new version rendered',
    });
  }

  if (oldText === newText) {
    // Same rendered text, but markdown-only differences (bold markers,
    // hyperlink targets) are invisible after stripping — surface them.
    if (rawText(oldNode) !== rawText(newNode)) {
      ctx.summary.untracked.push({
        path,
        kind: 'modified',
        component: newNode.name,
        detail:
          'inline formatting or link target changed (markdown-only); new version rendered without a tracked change',
      });
    } else if (!propsChanged) {
      ctx.summary.unchangedBlocks++;
    }
    return newNode;
  }

  ctx.summary.tracked.modified++;
  const segments = diffWords(oldText, newText);
  notePlaceholdersInChanges(segments, path, newNode.name, ctx);
  // Revision segments render literally, so markdown anywhere in a modified
  // block — including its unchanged portions — is flattened to plain text
  if (rawText(oldNode) !== oldText || rawText(newNode) !== newText) {
    ctx.summary.untracked.push({
      path,
      kind: 'modified',
      component: newNode.name,
      detail:
        'inline formatting or links flattened to plain text in the redline (revision segments render literally)',
    });
  }
  return {
    ...newNode,
    props: {
      ...newNode.props,
      text: newText,
      revision: makeRevision(ctx, segments),
    },
  };
}

/** Whole text component inserted/deleted → fully tracked block. */
function insertedTextComponent(
  node: JsonNode,
  path: string,
  ctx: DiffContext
): JsonNode {
  ctx.summary.tracked.inserted++;
  const text = plainText(node);
  const segments: DiffSegment[] = [{ type: 'insert', text }];
  notePlaceholdersInChanges(segments, path, node.name, ctx);
  return {
    ...node,
    props: {
      ...node.props,
      text,
      revision: makeRevision(ctx, segments),
    },
  };
}

function deletedTextComponent(
  node: JsonNode,
  path: string,
  ctx: DiffContext
): JsonNode {
  ctx.summary.tracked.deleted++;
  const text = plainText(node);
  const segments: DiffSegment[] = [{ type: 'delete', text }];
  notePlaceholdersInChanges(segments, path, node.name, ctx);
  return {
    ...node,
    props: {
      ...node.props,
      text: '',
      revision: makeRevision(ctx, segments),
    },
  };
}

// ---------------------------------------------------------------------------
// List diff
// ---------------------------------------------------------------------------

function normalizeListItems(node: JsonNode): NormalizedListItem[] {
  const items = (node.props?.items as ListItem[] | undefined) || [];
  return items.map((item) => {
    const raw = typeof item === 'string' ? item : item.text;
    const level = typeof item === 'string' ? 0 : item.level || 0;
    return { raw, text: stripMarkdown(raw.normalize('NFC')), level };
  });
}

function diffListComponent(
  oldNode: JsonNode,
  newNode: JsonNode,
  path: string,
  ctx: DiffContext
): JsonNode {
  const propsChanged = !deepEqual(
    propsWithout(oldNode.props, 'items'),
    propsWithout(newNode.props, 'items')
  );
  if (propsChanged) {
    ctx.summary.untracked.push({
      path,
      kind: 'modified',
      component: 'list',
      detail:
        'list configuration changed (format/levels/spacing); new version rendered',
    });
  }

  const oldItems = normalizeListItems(oldNode);
  const newItems = normalizeListItems(newNode);

  const stripped = (items: NormalizedListItem[]) =>
    items.map((i) => ({ text: i.text, level: i.level }));
  if (deepEqual(stripped(oldItems), stripped(newItems))) {
    if (
      !deepEqual(
        oldItems.map((i) => i.raw),
        newItems.map((i) => i.raw)
      )
    ) {
      ctx.summary.untracked.push({
        path,
        kind: 'modified',
        component: 'list',
        detail:
          'inline formatting or link target changed in list items (markdown-only); new version rendered without a tracked change',
      });
    } else if (!propsChanged) {
      ctx.summary.unchangedBlocks++;
    }
    return newNode;
  }

  const ops = alignByLcs(
    oldItems,
    newItems,
    (item) => `${item.level}:${item.text}`
  );

  // Collapse delete/insert runs into modified pairs (same level)
  const outItems: Array<{
    text: string;
    level?: number;
    revision?: ReturnType<typeof makeRevision>;
  }> = [];
  let changed = false;

  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.op === 'equal') {
      // Unchanged item: keep the raw text so markdown/hyperlinks survive
      outItems.push({ text: op.newItem.raw, level: op.newItem.level });
      k++;
      continue;
    }
    // Collect the full delete/insert run
    const deleted: NormalizedListItem[] = [];
    const inserted: NormalizedListItem[] = [];
    while (k < ops.length && ops[k].op !== 'equal') {
      const gapOp = ops[k];
      if (gapOp.op === 'delete') deleted.push(gapOp.oldItem);
      else if (gapOp.op === 'insert') inserted.push(gapOp.newItem);
      k++;
    }
    const { plan } = pairGap(
      deleted,
      inserted,
      (oldItem, newItem) => oldItem.level === newItem.level
    );
    for (const step of plan) {
      changed = true;
      if (step.kind === 'paired') {
        const segments = diffWords(step.oldItem.text, step.newItem.text);
        notePlaceholdersInChanges(segments, path, 'list', ctx);
        outItems.push({
          text: step.newItem.text,
          level: step.newItem.level,
          revision: makeRevision(ctx, segments),
        });
      } else if (step.kind === 'inserted') {
        outItems.push({
          text: step.newItem.text,
          level: step.newItem.level,
          revision: makeRevision(ctx, [
            { type: 'insert', text: step.newItem.text },
          ]),
        });
      } else {
        outItems.push({
          text: '',
          level: step.oldItem.level,
          revision: makeRevision(ctx, [
            { type: 'delete', text: step.oldItem.text },
          ]),
        });
      }
    }
  }

  if (changed) ctx.summary.tracked.modified++;
  return {
    ...newNode,
    props: { ...newNode.props, items: outItems },
  };
}

function listWithAllItems(
  node: JsonNode,
  type: 'insert' | 'delete',
  ctx: DiffContext
): JsonNode {
  if (type === 'insert') ctx.summary.tracked.inserted++;
  else ctx.summary.tracked.deleted++;
  const items = normalizeListItems(node).map((item) => ({
    text: type === 'insert' ? item.text : '',
    level: item.level,
    revision: makeRevision(ctx, [{ type, text: item.text }]),
  }));
  return { ...node, props: { ...node.props, items } };
}

// ---------------------------------------------------------------------------
// Tree diff
// ---------------------------------------------------------------------------

function isContainer(node: JsonNode): boolean {
  return Array.isArray(node.children);
}

function nodesPairable(oldNode: JsonNode, newNode: JsonNode): boolean {
  return oldNode.name === newNode.name;
}

function diffPairedNode(
  oldNode: JsonNode,
  newNode: JsonNode,
  path: string,
  ctx: DiffContext
): JsonNode {
  // `enabled` flips change what renders without touching props: treat them
  // as content appearing (insertion) or disappearing (deletion).
  const oldEnabled = isEnabled(oldNode);
  const newEnabled = isEnabled(newNode);
  if (!oldEnabled && !newEnabled) {
    ctx.summary.unchangedBlocks++;
    return newNode;
  }
  if (!oldEnabled && newEnabled) {
    return emitInserted(newNode, path, ctx);
  }
  if (oldEnabled && !newEnabled) {
    // The disabled new node would be filtered at render; emit the old
    // content as a tracked deletion instead (where supported).
    const deletedNode = emitDeleted(oldNode, path, ctx);
    return deletedNode ?? newNode;
  }

  if (TEXT_COMPONENTS.has(newNode.name)) {
    return diffTextComponent(oldNode, newNode, path, ctx);
  }
  if (newNode.name === 'list') {
    return diffListComponent(oldNode, newNode, path, ctx);
  }
  if (isContainer(newNode) || isContainer(oldNode)) {
    const propsChanged = !deepEqual(oldNode.props, newNode.props);
    if (propsChanged) {
      ctx.summary.untracked.push({
        path,
        kind: 'modified',
        component: newNode.name,
        detail: 'container props changed; new version rendered',
      });
    }
    return {
      ...newNode,
      children: diffChildren(
        oldNode.children || [],
        newNode.children || [],
        `${path}/children`,
        ctx
      ),
    };
  }
  // Opaque component (table, image, chart, ...): block replace
  ctx.summary.untracked.push({
    path,
    kind: 'modified',
    component: newNode.name,
    detail: `"${newNode.name}" changed (no native tracked-change support); new version rendered`,
  });
  return newNode;
}

function emitInserted(
  node: JsonNode,
  path: string,
  ctx: DiffContext
): JsonNode {
  // A disabled node renders nothing — keep it, but track nothing
  if (!isEnabled(node)) {
    return node;
  }
  if (TEXT_COMPONENTS.has(node.name)) {
    return insertedTextComponent(node, path, ctx);
  }
  if (node.name === 'list') {
    return listWithAllItems(node, 'insert', ctx);
  }
  if (isContainer(node)) {
    if (typeof node.props?.title === 'string') {
      ctx.summary.untracked.push({
        path,
        kind: 'inserted',
        component: node.name,
        detail: `"${node.name}" title rendered without insertion mark (titles are props, not text blocks)`,
      });
    }
    return {
      ...node,
      children: diffChildren([], node.children || [], `${path}/children`, ctx),
    };
  }
  ctx.summary.untracked.push({
    path,
    kind: 'inserted',
    component: node.name,
    detail: `"${node.name}" added (rendered, but not marked as a tracked insertion)`,
  });
  return node;
}

/** Returns the redline node for a deleted block, or null if it must be dropped. */
function emitDeleted(
  node: JsonNode,
  path: string,
  ctx: DiffContext
): JsonNode | null {
  // A disabled node never rendered — drop it silently
  if (!isEnabled(node)) {
    return null;
  }
  if (TEXT_COMPONENTS.has(node.name)) {
    return deletedTextComponent(node, path, ctx);
  }
  if (node.name === 'list') {
    return listWithAllItems(node, 'delete', ctx);
  }
  if (isContainer(node)) {
    if (typeof node.props?.title === 'string') {
      ctx.summary.untracked.push({
        path,
        kind: 'deleted',
        component: node.name,
        detail: `"${node.name}" title still rendered without deletion mark (titles are props, not text blocks)`,
      });
    }
    const children = diffChildren(
      node.children || [],
      [],
      `${path}/children`,
      ctx
    );
    return { ...node, children };
  }
  ctx.summary.untracked.push({
    path,
    kind: 'deleted',
    component: node.name,
    detail: `"${node.name}" removed (dropped from the redline; Word cannot mark it as a tracked deletion)`,
  });
  return null;
}

export function diffChildren(
  oldChildren: JsonNode[],
  newChildren: JsonNode[],
  path: string,
  ctx: DiffContext
): JsonNode[] {
  const ops = alignByLcs(oldChildren, newChildren, (node) =>
    JSON.stringify(node)
  );

  const out: JsonNode[] = [];
  let k = 0;
  let newIndex = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.op === 'equal') {
      ctx.summary.unchangedBlocks++;
      out.push(op.newItem);
      k++;
      newIndex++;
      continue;
    }

    // Collect the full delete/insert run between equal anchors
    const deleted: JsonNode[] = [];
    const inserted: JsonNode[] = [];
    while (k < ops.length && ops[k].op !== 'equal') {
      const gapOp = ops[k];
      if (gapOp.op === 'delete') deleted.push(gapOp.oldItem);
      else if (gapOp.op === 'insert') inserted.push(gapOp.newItem);
      k++;
    }

    const { plan } = pairGap(deleted, inserted, nodesPairable);
    for (const step of plan) {
      if (step.kind === 'paired') {
        out.push(
          diffPairedNode(step.oldItem, step.newItem, `${path}/${newIndex}`, ctx)
        );
        newIndex++;
      } else if (step.kind === 'inserted') {
        out.push(emitInserted(step.newItem, `${path}/${newIndex}`, ctx));
        newIndex++;
      } else {
        const deletedNode = emitDeleted(
          step.oldItem,
          `${path}/${newIndex}`,
          ctx
        );
        if (deletedNode) out.push(deletedNode);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Diff two DOCX definitions into a renderable redline document.
 *
 * Both inputs must be json-to-office DOCX definitions (root `name: "docx"`).
 * The result is based on the NEW document; the root gains
 * `trackRevisions: true` so Word opens it in review mode.
 */
export function diffDocuments(
  oldDoc: JsonNode,
  newDoc: JsonNode,
  options: DiffDocumentsOptions = {}
): DiffDocumentsResult {
  if (!oldDoc || oldDoc.name !== 'docx') {
    throw new Error('Old document: top-level component must be "docx"');
  }
  if (!newDoc || newDoc.name !== 'docx') {
    throw new Error('New document: top-level component must be "docx"');
  }

  const summary: DiffSummary = {
    tracked: { modified: 0, inserted: 0, deleted: 0 },
    untracked: [],
    unchangedBlocks: 0,
    notes: [],
  };
  const ctx: DiffContext = {
    author: options.author,
    date: options.date,
    summary,
  };

  const rootPropsChanged = !deepEqual(
    propsWithout(oldDoc.props, 'trackRevisions'),
    propsWithout(newDoc.props, 'trackRevisions')
  );
  if (rootPropsChanged) {
    summary.untracked.push({
      path: '/props',
      kind: 'modified',
      component: 'docx',
      detail:
        'document props changed (theme/metadata/defaults); new version used',
    });
  }

  const children = diffChildren(
    oldDoc.children || [],
    newDoc.children || [],
    '/children',
    ctx
  );

  if (summary.tracked.deleted > 0) {
    summary.notes.push(
      `${summary.tracked.deleted} fully deleted block(s): accepting all changes leaves an empty paragraph behind (OOXML paragraph-mark deletion is not supported by the renderer)`
    );
  }

  const document: JsonNode = {
    ...newDoc,
    props: { ...newDoc.props, trackRevisions: true },
    children,
  };

  return { document, summary };
}
