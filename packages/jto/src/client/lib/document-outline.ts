/**
 * Semantic outline of a json-to-office document, built from the Monaco model
 * text. Powers the sidebar "Outline" section: every node carries the exact
 * character offsets of the JSON it represents, so the tree can reveal, track
 * the cursor, badge validation errors, and reorder siblings by text surgery.
 *
 * Built on jsonc-parser (the parser VS Code's JSON mode uses) rather than the
 * hand-rolled scanner in font-lens-scan.ts because the outline must survive
 * mid-edit states: `parseTree` is error-tolerant and still yields a partial
 * tree with correct offsets while the document is temporarily invalid.
 *
 * IMPORTANT: callers must feed the *model* text (with `§jtoc:<id>§` collapse
 * sentinels), never the storage text — offsets only match what's on screen.
 */
import { parseTree, type Node } from 'jsonc-parser';
import type { FormatName } from './env';

export interface OutlineNode {
  /** Positional tree path (e.g. "2.0.1") — unique within one outline snapshot. */
  id: string;
  /** Component name ('slide', 'heading', 'chart', …) or 'key' for theme entries. */
  kind: string;
  label: string;
  /** Secondary text: style name, chart type, table size, H-level, … */
  detail?: string;
  /** Offset range used for reveal / cursor tracking / error mapping. */
  start: number;
  end: number;
  children: OutlineNode[];
  /** Present when this node can be reordered among siblings sharing groupId. */
  reorder?: ReorderInfo;
}

export interface ReorderInfo {
  /** Identifies the underlying JSON array; siblings must share it to reorder. */
  groupId: string;
  /**
   * Offset range of the contiguous slice of array items this node owns. For a
   * DOCX heading this spans the heading item plus everything until the next
   * same-or-higher heading; for everything else it's the item's own range.
   */
  sliceStart: number;
  sliceEnd: number;
}

export interface ReorderEdit {
  start: number;
  end: number;
  text: string;
}

const LABEL_MAX = 60;
const SENTINEL_RE = /§jtoc:\d+§/g;

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function propValue(obj: Node | undefined, key: string): Node | undefined {
  if (!obj || obj.type !== 'object' || !obj.children) return undefined;
  for (const prop of obj.children) {
    if (prop.type !== 'property' || !prop.children) continue;
    const [k, v] = prop.children;
    if (k?.value === key) return v;
  }
  return undefined;
}

function stringValue(n: Node | undefined): string | undefined {
  return n?.type === 'string' && typeof n.value === 'string'
    ? n.value
    : undefined;
}

function numberValue(n: Node | undefined): number | undefined {
  return n?.type === 'number' && typeof n.value === 'number'
    ? n.value
    : undefined;
}

function arrayItems(n: Node | undefined): Node[] {
  return n?.type === 'array' && n.children ? n.children : [];
}

function truncate(raw: string, max = LABEL_MAX): string {
  const clean = raw.replace(SENTINEL_RE, '…').split('\n')[0].trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// ---------------------------------------------------------------------------
// Component labels
// ---------------------------------------------------------------------------

/** `columns: [{header, cells}]` (DOCX) or `rows: [[…]]` / `rows: [{cells}]` (PPTX). */
function tableDetail(props: Node | undefined): string | undefined {
  const columns = arrayItems(propValue(props, 'columns'));
  if (columns.length > 0) {
    const rows = Math.max(
      0,
      ...columns.map((c) => arrayItems(propValue(c, 'cells')).length)
    );
    return `${rows}×${columns.length}`;
  }
  const rows = arrayItems(propValue(props, 'rows'));
  if (rows.length > 0) {
    const first = rows[0];
    const cols =
      first?.type === 'array'
        ? arrayItems(first).length
        : arrayItems(propValue(first, 'cells')).length;
    return cols > 0 ? `${rows.length}×${cols}` : `${rows.length} rows`;
  }
  return undefined;
}

function imageLabel(props: Node | undefined): string {
  const alt = stringValue(propValue(props, 'alt'));
  if (alt) return truncate(alt);
  const src = stringValue(propValue(props, 'src'));
  if (src) {
    if (src.startsWith('data:')) {
      const mime = src.slice(5).split(/[;,]/)[0];
      return mime ? `image (${mime.split('/').pop()})` : 'image';
    }
    const base = src.split(/[?#]/)[0].split('/').pop();
    if (base) return truncate(base, 40);
  }
  return 'image';
}

function componentLabel(
  name: string,
  props: Node | undefined
): { label: string; detail?: string } {
  const text = stringValue(propValue(props, 'text'));
  switch (name) {
    case 'heading': {
      const level = numberValue(propValue(props, 'level')) ?? 1;
      return { label: text ? truncate(text) : 'heading', detail: `H${level}` };
    }
    case 'text':
      return {
        label: text ? truncate(text) : 'text',
        detail: stringValue(propValue(props, 'style')),
      };
    case 'paragraph':
      return { label: text ? truncate(text) : 'paragraph' };
    case 'chart':
    case 'highcharts': {
      const title =
        stringValue(propValue(props, 'title')) ??
        stringValue(propValue(propValue(props, 'options'), 'title'));
      return {
        label: title ? truncate(title) : name,
        detail: stringValue(propValue(props, 'type')),
      };
    }
    case 'table':
      return { label: 'table', detail: tableDetail(props) };
    case 'image':
      return { label: imageLabel(props) };
    case 'shape':
      return {
        label: stringValue(propValue(props, 'type')) ?? 'shape',
      };
    case 'list': {
      const items = arrayItems(propValue(props, 'items'));
      return {
        label: 'list',
        detail: items.length > 0 ? `${items.length} items` : undefined,
      };
    }
    case 'section': {
      // meta.title is the authoring label (never rendered); bare `title` is
      // the pre-meta spelling, still honored so old documents stay navigable.
      const title =
        stringValue(propValue(propValue(props, 'meta'), 'title')) ??
        stringValue(propValue(props, 'title'));
      return { label: title ? truncate(title) : 'section' };
    }
    case 'statistic': {
      const value =
        stringValue(propValue(props, 'value')) ??
        numberValue(propValue(props, 'value'))?.toString();
      const label = stringValue(propValue(props, 'label'));
      return { label: truncate(label ?? value ?? 'statistic'), detail: value };
    }
    default:
      return { label: text ? truncate(text) : name };
  }
}

// ---------------------------------------------------------------------------
// Document outlines
// ---------------------------------------------------------------------------

interface ComponentInfo {
  name: string;
  props: Node | undefined;
  childrenArr: Node | undefined;
}

function componentInfo(el: Node): ComponentInfo | null {
  if (el.type !== 'object') return null;
  const name = stringValue(propValue(el, 'name'));
  if (!name) return null;
  return {
    name,
    props: propValue(el, 'props'),
    childrenArr: propValue(el, 'children'),
  };
}

/**
 * First textual content inside a container, for label fallback. Headings and
 * styled text win over plain paragraphs (a cover section's first paragraph is
 * usually its display title, so paragraphs still make a decent fallback).
 */
function firstTextLabel(childrenArr: Node | undefined): string | undefined {
  let paragraph: string | undefined;
  for (const el of arrayItems(childrenArr)) {
    const info = componentInfo(el);
    if (!info) continue;
    const text = stringValue(propValue(info.props, 'text'));
    if (!text) continue;
    if (info.name === 'heading' || info.name === 'text') {
      return truncate(text, 48);
    }
    if (info.name === 'paragraph' && paragraph === undefined) {
      paragraph = truncate(text, 48);
    }
  }
  return paragraph;
}

function makeNode(
  el: Node,
  info: ComponentInfo,
  reorder: ReorderInfo | undefined
): OutlineNode {
  let { label, detail } = componentLabel(info.name, info.props);
  // Untitled containers borrow their first heading so a section-based
  // document doesn't outline as a wall of identical "section" rows.
  if (label === info.name && info.childrenArr) {
    label = firstTextLabel(info.childrenArr) ?? label;
  }
  return {
    id: '',
    kind: info.name,
    label,
    detail,
    start: el.offset,
    end: el.offset + el.length,
    children: buildChildren(info.childrenArr),
    reorder,
  };
}

/** Generic recursion into a `children` array (used inside slides/containers). */
function buildChildren(childrenArr: Node | undefined): OutlineNode[] {
  if (!childrenArr || childrenArr.type !== 'array') return [];
  const groupId = `arr@${childrenArr.offset}`;
  const out: OutlineNode[] = [];
  for (const el of arrayItems(childrenArr)) {
    const info = componentInfo(el);
    if (!info) continue;
    out.push(
      makeNode(el, info, {
        groupId,
        sliceStart: el.offset,
        sliceEnd: el.offset + el.length,
      })
    );
  }
  return out;
}

/**
 * Best slide title: first `text` child styled 'title', else the first
 * 'heading*' style, else the first text at all. Looks one container level
 * deep so grouped layouts still label their slide.
 */
function slideLabel(slideEl: Node): string | undefined {
  let best: { rank: number; text: string } | undefined;
  const consider = (el: Node, depth: number) => {
    const info = componentInfo(el);
    if (!info) return;
    if (info.name === 'text' || info.name === 'heading') {
      const text = stringValue(propValue(info.props, 'text'));
      if (text) {
        const style = stringValue(propValue(info.props, 'style')) ?? '';
        const rank =
          style === 'title' ? 0 : style.startsWith('heading') ? 1 : 2;
        if (!best || rank < best.rank) best = { rank, text };
      }
    }
    if (depth < 1) {
      for (const child of arrayItems(info.childrenArr))
        consider(child, depth + 1);
    }
  };
  for (const el of arrayItems(propValue(slideEl, 'children'))) consider(el, 0);
  return best ? truncate(best.text, 48) : undefined;
}

function buildPptxOutline(root: Node): OutlineNode[] {
  const childrenArr = propValue(root, 'children');
  if (!childrenArr || childrenArr.type !== 'array') return [];
  const groupId = `arr@${childrenArr.offset}`;
  const out: OutlineNode[] = [];
  let slideNumber = 0;
  for (const el of arrayItems(childrenArr)) {
    const info = componentInfo(el);
    if (!info) continue;
    const reorder: ReorderInfo = {
      groupId,
      sliceStart: el.offset,
      sliceEnd: el.offset + el.length,
    };
    if (info.name === 'slide') {
      slideNumber += 1;
      out.push({
        id: '',
        kind: 'slide',
        label: slideLabel(el) ?? `Slide ${slideNumber}`,
        detail: `${slideNumber}`,
        start: el.offset,
        end: el.offset + el.length,
        children: buildChildren(info.childrenArr),
        reorder,
      });
    } else {
      out.push(makeNode(el, info, reorder));
    }
  }
  return out;
}

/**
 * DOCX: headings structure the flat root `children` array into a tree. A
 * heading node owns everything after it up to the next heading of the same or
 * a higher level — both in the tree and in its reorder slice, so dragging a
 * section moves its whole content.
 */
function buildDocxOutline(root: Node): OutlineNode[] {
  const childrenArr = propValue(root, 'children');
  if (!childrenArr || childrenArr.type !== 'array') return [];
  const groupId = `arr@${childrenArr.offset}`;
  const rootNodes: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];

  for (const el of arrayItems(childrenArr)) {
    const info = componentInfo(el);
    if (!info) continue;
    const reorder: ReorderInfo = {
      groupId,
      sliceStart: el.offset,
      sliceEnd: el.offset + el.length,
    };
    const target = () =>
      stack.length ? stack[stack.length - 1].node.children : rootNodes;

    if (info.name === 'heading') {
      const level = numberValue(propValue(info.props, 'level')) ?? 1;
      while (stack.length && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const node = makeNode(el, info, reorder);
      target().push(node);
      stack.push({ level, node });
    } else {
      target().push(makeNode(el, info, reorder));
    }
  }

  // A heading's range/slice extends over its children so cursor tracking and
  // drag both treat the section as one unit.
  const extend = (node: OutlineNode): void => {
    node.children.forEach(extend);
    const last = node.children[node.children.length - 1];
    if (node.kind === 'heading' && last) {
      node.end = Math.max(node.end, last.end);
      if (node.reorder && last.reorder) {
        node.reorder.sliceEnd = Math.max(
          node.reorder.sliceEnd,
          last.reorder.sliceEnd
        );
      }
    }
  };
  rootNodes.forEach(extend);
  return rootNodes;
}

// ---------------------------------------------------------------------------
// Theme outline
// ---------------------------------------------------------------------------

function themeLeafDetail(value: Node): string | undefined {
  switch (value.type) {
    case 'string':
      return truncate(String(value.value ?? ''), 24);
    case 'number':
    case 'boolean':
      return String(value.value);
    case 'array':
      return `${arrayItems(value).length} items`;
    case 'object':
      return undefined;
    default:
      return undefined;
  }
}

function buildThemeOutline(root: Node): OutlineNode[] {
  if (root.type !== 'object' || !root.children) return [];
  const out: OutlineNode[] = [];
  for (const prop of root.children) {
    if (prop.type !== 'property' || !prop.children) continue;
    const [key, value] = prop.children;
    const keyName = typeof key?.value === 'string' ? key.value : undefined;
    if (!keyName || keyName === '$schema' || !value) continue;
    const children: OutlineNode[] = [];
    if (value.type === 'object' && value.children) {
      for (const sub of value.children) {
        if (sub.type !== 'property' || !sub.children) continue;
        const [subKey, subValue] = sub.children;
        const subName =
          typeof subKey?.value === 'string' ? subKey.value : undefined;
        if (!subName || !subValue) continue;
        children.push({
          id: '',
          kind: 'key',
          label: subName,
          detail: themeLeafDetail(subValue),
          start: sub.offset,
          end: sub.offset + sub.length,
          children: [],
        });
      }
    }
    out.push({
      id: '',
      kind: 'key',
      label: keyName,
      detail: children.length === 0 ? themeLeafDetail(value) : undefined,
      start: prop.offset,
      end: prop.offset + prop.length,
      children,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type OutlineDocType = 'document' | 'theme';

export function buildOutline(
  text: string,
  format: FormatName,
  docType: OutlineDocType
): OutlineNode[] {
  if (!text.trim()) return [];
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (!root) return [];
  const nodes =
    docType === 'theme'
      ? buildThemeOutline(root)
      : format === 'pptx'
        ? buildPptxOutline(root)
        : buildDocxOutline(root);
  assignIds(nodes, '');
  return nodes;
}

function assignIds(nodes: OutlineNode[], prefix: string): void {
  nodes.forEach((node, i) => {
    node.id = prefix ? `${prefix}.${i}` : `${i}`;
    assignIds(node.children, node.id);
  });
}

/** Deepest node whose range contains `offset` (ranges are strictly nested). */
export function findDeepestNodeAt(
  nodes: OutlineNode[],
  offset: number
): OutlineNode | null {
  for (const node of nodes) {
    if (offset >= node.start && offset < node.end) {
      return findDeepestNodeAt(node.children, offset) ?? node;
    }
  }
  return null;
}

/** Ids of the node containing `offset` at each depth (root-first). */
export function pathToOffset(nodes: OutlineNode[], offset: number): string[] {
  const path: string[] = [];
  let list = nodes;
  for (;;) {
    const hit = list.find((n) => offset >= n.start && offset < n.end);
    if (!hit) return path;
    path.push(hit.id);
    list = hit.children;
  }
}

/** Every node id whose range contains at least one of the given offsets. */
export function collectErrorNodeIds(
  nodes: OutlineNode[],
  offsets: number[]
): Set<string> {
  const out = new Set<string>();
  for (const offset of offsets) {
    for (const id of pathToOffset(nodes, offset)) out.add(id);
  }
  return out;
}

/**
 * Text edit that moves `siblings[from]` so it lands at index `to` (indices in
 * the current sibling order). Preserves every inter-item separator verbatim,
 * so formatting survives untouched. Returns null when the move is invalid —
 * slices overlapping, or a separator that doesn't hold exactly one comma
 * (mid-edit text) — rather than risk corrupting the document.
 */
export function computeReorderEdit(
  text: string,
  siblings: OutlineNode[],
  from: number,
  to: number
): ReorderEdit | null {
  if (from === to) return null;
  if (from < 0 || to < 0 || from >= siblings.length || to >= siblings.length) {
    return null;
  }
  const slices = siblings.map((s) => s.reorder);
  if (slices.some((s) => !s)) return null;
  const groupId = slices[0]!.groupId;
  if (slices.some((s) => s!.groupId !== groupId)) return null;
  for (let i = 1; i < slices.length; i++) {
    if (slices[i]!.sliceStart < slices[i - 1]!.sliceEnd) return null;
  }

  const pieces = slices.map((s) => text.slice(s!.sliceStart, s!.sliceEnd));
  const separators: string[] = [];
  for (let i = 1; i < slices.length; i++) {
    const sep = text.slice(slices[i - 1]!.sliceEnd, slices[i]!.sliceStart);
    if ((sep.match(/,/g) ?? []).length !== 1) return null;
    separators.push(sep);
  }

  const order = pieces.map((_, i) => i);
  order.splice(to, 0, order.splice(from, 1)[0]);

  let out = '';
  order.forEach((idx, pos) => {
    out += pieces[idx];
    if (pos < separators.length) out += separators[pos];
  });
  return {
    start: slices[0]!.sliceStart,
    end: slices[slices.length - 1]!.sliceEnd,
    text: out,
  };
}
