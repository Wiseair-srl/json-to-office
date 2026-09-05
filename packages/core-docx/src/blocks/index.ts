/**
 * Blocks: content components with bounded slots that lower to the existing
 * primitives, styled from the theme.
 *
 * A block stays where the author put it. Expansion fills the block node's
 * `children` with the primitives it lowers to rather than splicing them into
 * the parent, so every authored pointer — the block's own slots and every
 * sibling after it — keeps its address, and the compiled form is one tree
 * that can be inspected, validated and rendered as it is. The IR compiler
 * treats an expanded block as a transparent container.
 *
 * Pure: the same document and theme always expand to the same tree, and no
 * authored object is mutated.
 */

import { KEY_TAKEAWAYS_BUDGET } from '@json-to-office/shared-docx';
import type { KeyTakeawaysProps } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import { compileKeyTakeaways } from './keyTakeaways';
import type { BlockCompilation } from './types';

export type { BlockCompilation } from './types';
export {
  compileKeyTakeaways,
  KEY_TAKEAWAYS_DEFAULT_LABEL,
} from './keyTakeaways';

export const BLOCK_NAMES = ['key-takeaways'] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

export function isBlockName(name: unknown): name is BlockName {
  return (BLOCK_NAMES as readonly unknown[]).includes(name);
}

/** Emitted JSON Pointer (RFC 6901, absolute) → authored pointer. */
export type BlockSourceMap = Readonly<Record<string, string>>;

export interface ExpandedBlocks<T> {
  document: T;
  sourceMap: BlockSourceMap;
  /** Authored pointers of the blocks that were expanded. */
  blocks: readonly string[];
}

/** A text slot's word budget, for the quality rules to check against. */
export interface BlockSlotBudget {
  block: BlockName;
  slot: string;
  /** Authored pointer of the slot value. */
  path: string;
  words: number;
  maxWords: number;
}

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compileBlock(
  node: Rec,
  theme: ThemeConfig
): BlockCompilation | undefined {
  switch (node.name) {
    case 'key-takeaways':
      return compileKeyTakeaways(node.props as KeyTakeawaysProps, theme);
    default:
      return undefined;
  }
}

/**
 * Expand every enabled block in `document`. A disabled block is left as it
 * is: it renders nothing, so it has nothing to lower to.
 */
export function expandBlocks<T>(
  document: T,
  theme: ThemeConfig
): ExpandedBlocks<T> {
  const sourceMap: Record<string, string> = {};
  const blocks: string[] = [];

  const walk = (node: unknown, pointer: string): unknown => {
    if (Array.isArray(node)) {
      return node.map((child, index) => walk(child, `${pointer}/${index}`));
    }
    if (!isRecord(node)) return node;

    if (typeof node.name === 'string' && isRecord(node.props)) {
      if (node.enabled !== false && isBlockName(node.name)) {
        const compiled = compileBlock(node, theme);
        if (compiled) {
          blocks.push(pointer);
          for (const [emitted, authored] of Object.entries(
            compiled.sourceMap
          )) {
            sourceMap[`${pointer}${emitted}`] = `${pointer}${authored}`;
          }
          return { ...node, children: compiled.children };
        }
      }
    }

    // Props regions first — a section's header precedes its body — then the
    // children, so `blocks` lists blocks in reading order.
    const next: Rec = { ...node };
    if (isRecord(node.props)) {
      const props: Rec = { ...node.props };
      let changed = false;
      for (const key of ['header', 'footer'] as const) {
        if (Array.isArray(props[key])) {
          props[key] = walk(props[key], `${pointer}/props/${key}`);
          changed = true;
        }
      }
      if (Array.isArray(props.columns)) {
        props.columns = (props.columns as unknown[]).map((column, index) => {
          if (!isRecord(column)) return column;
          const base = `${pointer}/props/columns/${index}`;
          const out: Rec = { ...column };
          if (isRecord(column.header) && 'content' in column.header) {
            out.header = {
              ...column.header,
              content: walk(column.header.content, `${base}/header/content`),
            };
          }
          if (Array.isArray(column.cells)) {
            out.cells = column.cells.map((cell, cellIndex) =>
              isRecord(cell) && 'content' in cell
                ? {
                    ...cell,
                    content: walk(
                      cell.content,
                      `${base}/cells/${cellIndex}/content`
                    ),
                  }
                : cell
            );
          }
          return out;
        });
        changed = true;
      }
      if (changed) next.props = props;
    }
    if (Array.isArray(node.children)) {
      next.children = walk(node.children, `${pointer}/children`);
    }
    return next;
  };

  const expanded = walk(document, '') as T;
  return {
    document: blocks.length > 0 ? expanded : document,
    sourceMap,
    blocks,
  };
}

/**
 * The authored pointer a pointer into the expanded tree stands for. A pointer
 * outside any block maps to itself; one inside a block maps through the
 * longest matching source-map entry, carrying any remainder across — so
 * `/children/2/props/items/1` under a block becomes the block's
 * `/props/items/1`.
 */
export function toAuthoredPointer(
  sourceMap: BlockSourceMap,
  pointer: string
): string {
  let best: string | undefined;
  for (const emitted of Object.keys(sourceMap)) {
    if (
      (pointer === emitted || pointer.startsWith(`${emitted}/`)) &&
      (best === undefined || emitted.length > best.length)
    ) {
      best = emitted;
    }
  }
  if (best === undefined) return pointer;
  return `${sourceMap[best]}${pointer.slice(best.length)}`;
}

/**
 * Every text slot's word count against its budget, for the blocks at the
 * given authored pointers. Read off the authored props, never the compiled
 * children, so the count is what the author wrote.
 */
export function blockSlotBudgets(
  document: unknown,
  blocks: readonly string[]
): BlockSlotBudget[] {
  const budgets: BlockSlotBudget[] = [];
  for (const pointer of blocks) {
    const node = nodeAt(document, pointer);
    if (!isRecord(node) || !isRecord(node.props)) continue;
    if (node.name === 'key-takeaways') {
      const items = Array.isArray(node.props.items) ? node.props.items : [];
      items.forEach((item, index) => {
        if (typeof item !== 'string') return;
        budgets.push({
          block: 'key-takeaways',
          slot: 'items',
          path: `${pointer}/props/items/${index}`,
          words: wordCount(item),
          maxWords: KEY_TAKEAWAYS_BUDGET.items.maxWords,
        });
      });
    }
  }
  return budgets;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function nodeAt(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  let current: unknown = root;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) current = current[Number(key)];
    else if (isRecord(current)) current = current[key];
    else return undefined;
  }
  return current;
}
