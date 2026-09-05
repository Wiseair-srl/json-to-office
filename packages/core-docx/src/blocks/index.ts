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
 * One block lowers to page chrome instead of flow: `running-head` fills the
 * `header` and `footer` of its section and of every later section that
 * authors none, and lowers to an empty `children` where it stands. That is
 * still additive — a section gains a `props.header` it did not have; nothing
 * moves — and the source map covers the generated chrome too.
 *
 * Pure: the same document and theme always expand to the same tree, and no
 * authored object is mutated.
 */

import {
  COVER_BUDGET,
  KEY_TAKEAWAYS_BUDGET,
  RUNNING_HEAD_BUDGET,
  SECTION_OPENER_BUDGET,
} from '@json-to-office/shared-docx';
import type {
  CoverProps,
  KeyTakeawaysProps,
  RunningHeadProps,
  SectionOpenerProps,
} from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import type { ComponentDefinition } from '../types';
import { compileCover } from './cover';
import { compileKeyTakeaways } from './keyTakeaways';
import { compileRunningHead } from './runningHead';
import { compileSectionOpener, sectionTracker } from './sectionOpener';
import type { BlockCompilation } from './types';

type Rec = Record<string, unknown>;

export const BLOCK_NAMES = [
  'key-takeaways',
  'cover',
  'section-opener',
  'running-head',
] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

/** Blocks that lower to page chrome rather than to flow content. */
export const CHROME_BLOCK_NAMES = ['running-head'] as const;

/** A text slot's word budget, for the quality rules to check against. */
export interface BlockSlotBudget {
  block: BlockName;
  slot: string;
  /** Authored pointer of the slot value. */
  path: string;
  words: number;
  maxWords: number;
}

/** What one block kind knows how to do. Adding a block is one entry here. */
interface BlockDefinition {
  /** Lower the block to flow primitives. Absent for a chrome block. */
  compile?(props: Rec, theme: ThemeConfig): BlockCompilation;
  /** Word budgets of the block's text slots, read off the authored props. */
  budgets(props: Rec, pointer: string): BlockSlotBudget[];
}

/** One string slot counted against its budget; nothing for an absent one. */
function slotBudget(
  block: BlockName,
  props: Rec,
  pointer: string,
  slot: string,
  maxWords: number
): BlockSlotBudget[] {
  const value = props[slot];
  return typeof value === 'string'
    ? [
        {
          block,
          slot,
          path: `${pointer}/props/${slot}`,
          words: wordCount(value),
          maxWords,
        },
      ]
    : [];
}

const BLOCKS: Record<BlockName, BlockDefinition> = {
  'key-takeaways': {
    compile: (props, theme) =>
      compileKeyTakeaways(props as KeyTakeawaysProps, theme),
    budgets: (props, pointer) =>
      (Array.isArray(props.items) ? props.items : []).flatMap((item, index) =>
        typeof item === 'string'
          ? [
              {
                block: 'key-takeaways' as const,
                slot: 'items',
                path: `${pointer}/props/items/${index}`,
                words: wordCount(item),
                maxWords: KEY_TAKEAWAYS_BUDGET.items.maxWords,
              },
            ]
          : []
      ),
  },
  cover: {
    compile: (props, theme) => compileCover(props as CoverProps, theme),
    budgets: (props, pointer) =>
      (Object.keys(COVER_BUDGET) as (keyof typeof COVER_BUDGET)[]).flatMap(
        (slot) =>
          slotBudget('cover', props, pointer, slot, COVER_BUDGET[slot].maxWords)
      ),
  },
  'section-opener': {
    compile: (props, theme) =>
      compileSectionOpener(props as SectionOpenerProps, theme),
    budgets: (props, pointer) =>
      (
        Object.keys(
          SECTION_OPENER_BUDGET
        ) as (keyof typeof SECTION_OPENER_BUDGET)[]
      ).flatMap((slot) =>
        slotBudget(
          'section-opener',
          props,
          pointer,
          slot,
          SECTION_OPENER_BUDGET[slot].maxWords
        )
      ),
  },
  'running-head': {
    budgets: (props, pointer) =>
      (
        Object.keys(RUNNING_HEAD_BUDGET) as (keyof typeof RUNNING_HEAD_BUDGET)[]
      ).flatMap((slot) =>
        slotBudget(
          'running-head',
          props,
          pointer,
          slot,
          RUNNING_HEAD_BUDGET[slot].maxWords
        )
      ),
  },
};

export type { BlockCompilation } from './types';
export {
  compileKeyTakeaways,
  KEY_TAKEAWAYS_DEFAULT_LABEL,
} from './keyTakeaways';
export { compileCover } from './cover';
export { compileSectionOpener, sectionTracker } from './sectionOpener';
export { compileRunningHead, PAGE_OF_TOTAL } from './runningHead';
export type { RunningHeadCompilation, RunningHeadContext } from './runningHead';

export function isBlockName(name: unknown): name is BlockName {
  return (BLOCK_NAMES as readonly unknown[]).includes(name);
}

export function isChromeBlockName(name: unknown): boolean {
  return (CHROME_BLOCK_NAMES as readonly unknown[]).includes(name);
}

/** Emitted JSON Pointer (RFC 6901, absolute) → authored pointer. */
export type BlockSourceMap = Readonly<Record<string, string>>;

export interface ExpandedBlocks<T> {
  document: T;
  sourceMap: BlockSourceMap;
  /** Authored pointers of the blocks that were expanded. */
  blocks: readonly string[];
}

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A pointer to a direct child of a top-level section. */
const SECTION_CHILD = /^\/children\/\d+\/children\/\d+$/;
/** A pointer to a top-level section. */
const SECTION = /^\/children\/(\d+)$/;

/** The chrome one section receives from the running head in force. */
interface ChromePlan {
  header: ComponentDefinition[];
  footer: ComponentDefinition[];
  /** Pointer under the section's `props` → absolute authored pointer. */
  sourceMap: Readonly<Record<string, string>>;
}

/**
 * Which section gets which chrome. A `running-head` takes effect from its own
 * section onward, until a later one replaces it; every section in its reach
 * is planned here, whether or not it ends up using the plan — a section that
 * authored a part keeps it, and that decision is made when the section is
 * visited, part by part.
 */
function planChrome(
  document: unknown,
  theme: ThemeConfig
): Map<number, ChromePlan> {
  const plans = new Map<number, ChromePlan>();
  if (
    !isRecord(document) ||
    document.name !== 'docx' ||
    !Array.isArray(document.children)
  ) {
    return plans;
  }
  const metadata = isRecord(document.props)
    ? (document.props.metadata as Rec | undefined)
    : undefined;
  const documentTitle =
    isRecord(metadata) && typeof metadata.title === 'string'
      ? metadata.title
      : undefined;

  let inForce: { pointer: string; props: RunningHeadProps } | undefined;
  document.children.forEach((section, index) => {
    if (
      !isRecord(section) ||
      section.name !== 'section' ||
      section.enabled === false
    ) {
      return;
    }
    const sectionPointer = `/children/${index}`;
    const children = Array.isArray(section.children) ? section.children : [];
    children.forEach((child, childIndex) => {
      if (
        isRecord(child) &&
        child.name === 'running-head' &&
        child.enabled !== false
      ) {
        inForce = {
          pointer: `${sectionPointer}/children/${childIndex}`,
          props: (isRecord(child.props) ? child.props : {}) as RunningHeadProps,
        };
      }
    });
    if (!inForce) return;

    const block = inForce.pointer;
    const opener = sectionTracker(section);
    const { title, tracker, confidentiality, date } = inForce.props;
    const compiled = compileRunningHead(
      inForce.props,
      theme,
      {
        title: title ?? documentTitle,
        tracker: opener?.text ?? tracker,
      },
      {
        self: block,
        ...(title !== undefined && { title: `${block}/props/title` }),
        ...(opener
          ? { tracker: `${sectionPointer}${opener.slot}` }
          : tracker !== undefined && { tracker: `${block}/props/tracker` }),
        ...(confidentiality !== undefined && {
          confidentiality: `${block}/props/confidentiality`,
        }),
        ...(date !== undefined && { date: `${block}/props/date` }),
      }
    );
    const sourceMap: Record<string, string> = {
      '/header': block,
      '/footer': block,
    };
    for (const [emitted, authored] of Object.entries(compiled.headerMap)) {
      sourceMap[`/header${emitted}`] = authored;
    }
    for (const [emitted, authored] of Object.entries(compiled.footerMap)) {
      sourceMap[`/footer${emitted}`] = authored;
    }
    plans.set(index, {
      header: compiled.header,
      footer: compiled.footer,
      sourceMap,
    });
  });
  return plans;
}

/**
 * Expand every enabled block in `document`. A disabled block is left as it
 * is: it renders nothing, so it has nothing to lower to. A chrome block
 * anywhere but directly under a top-level section is left as it is too, so
 * the compiler reports it rather than the page silently losing its chrome.
 */
export function expandBlocks<T>(
  document: T,
  theme: ThemeConfig
): ExpandedBlocks<T> {
  const sourceMap: Record<string, string> = {};
  const blocks: string[] = [];
  const chrome = planChrome(document, theme);

  const walk = (node: unknown, pointer: string): unknown => {
    if (Array.isArray(node)) {
      return node.map((child, index) => walk(child, `${pointer}/${index}`));
    }
    if (!isRecord(node)) return node;

    if (typeof node.name === 'string' && node.enabled !== false) {
      if (isChromeBlockName(node.name)) {
        if (!SECTION_CHILD.test(pointer)) return node;
        blocks.push(pointer);
        return { ...node, children: [] };
      }
      if (isBlockName(node.name) && isRecord(node.props)) {
        const compiled = BLOCKS[node.name].compile!(node.props, theme);
        blocks.push(pointer);
        for (const [emitted, authored] of Object.entries(compiled.sourceMap)) {
          sourceMap[`${pointer}${emitted}`] = `${pointer}${authored}`;
        }
        return { ...node, children: compiled.children };
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

    // A section in a running head's reach takes the parts it did not author,
    // and starts on a new page unless it said otherwise: a header belongs to
    // the section a page *starts* in, so a section that flowed on from the
    // previous one would show that one's tracker for its first page.
    const section = SECTION.exec(pointer);
    if (section && node.name === 'section' && node.enabled !== false) {
      const plan = chrome.get(Number(section[1]));
      if (plan) {
        const props: Rec = isRecord(next.props) ? { ...next.props } : {};
        let changed = false;
        for (const part of ['header', 'footer'] as const) {
          if (props[part] !== undefined || plan[part].length === 0) continue;
          props[part] = plan[part];
          changed = true;
          for (const [emitted, authored] of Object.entries(plan.sourceMap)) {
            if (emitted === `/${part}` || emitted.startsWith(`/${part}/`)) {
              sourceMap[`${pointer}/props${emitted}`] = authored;
            }
          }
        }
        if (props.pageBreak === undefined) {
          props.pageBreak = true;
          changed = true;
        }
        if (changed) next.props = props;
      }
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
  return blocks.flatMap((pointer) => {
    const node = nodeAt(document, pointer);
    if (!isRecord(node) || !isRecord(node.props) || !isBlockName(node.name)) {
      return [];
    }
    return BLOCKS[node.name].budgets(node.props, pointer);
  });
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
