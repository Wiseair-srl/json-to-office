/**
 * Document-local JSON blocks on slides.
 *
 * The PPTX adapter of the shared block contract. A definition in
 * `props.blocks` expands, at its invocation, into a transparent `group` of
 * ordinary slide content — text, shapes, images, charts, tables, nested
 * groups — with a source map from every compiled pointer back to the authored
 * invocation or slot. Geometry is the definition's: component slots take
 * their frame from the `props` merged beneath them, and a group's frame,
 * direction and grid do the distributing. Nothing here knows any block by
 * name.
 *
 * Slide effects are the one thing a block can say about its slide. A
 * definition's `slide.background` and `slide.notes` fill in what the slide
 * did not state; `slide.grid` becomes the expanded group's `gridConfig`, so
 * the body's grid placements resolve against the block's own grid. A slide
 * that states its own background keeps it.
 */

import {
  BlockEvaluationError,
  JsonBlockEvaluator,
  blockValueAt,
  composeBlocksWithPlugins,
  isBlockRecord,
  readBlockDefinitions,
  toAuthoredBlockPointer,
  type BlockEvaluatorOptions,
  type BlockSlideEffect,
} from '@json-to-office/shared';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import type { PptxThemeConfig } from '../types';

export { blockSlotBudgets, blockSlotRoles } from '@json-to-office/shared';
export type {
  BlockSlotBudget,
  BlockSlotRoleValue,
  BlockSourceMap,
  ExpandedBlocks,
} from '@json-to-office/shared';
import type { ExpandedBlocks } from '@json-to-office/shared';

type Rec = Record<string, unknown>;
export const toAuthoredPointer = toAuthoredBlockPointer;

/** Deck metadata and the slide's canvas. No slide design is registered here. */
export function pptxBlockContext(document: unknown, path = ''): Rec {
  const props =
    isBlockRecord(document) && isBlockRecord(document.props)
      ? document.props
      : {};
  const index = /^\/children\/(\d+)/.exec(path)?.[1];
  const metadata: Rec = {};
  for (const key of ['title', 'author', 'subject', 'company']) {
    if (props[key] !== undefined) metadata[key] = props[key];
  }
  return {
    document: metadata,
    slide: {
      width: typeof props.slideWidth === 'number' ? props.slideWidth : 10,
      height: typeof props.slideHeight === 'number' ? props.slideHeight : 7.5,
      ...(index !== undefined && { index: Number(index) + 1 }),
    },
  };
}

export function createPptxBlockEvaluator(
  document: unknown,
  theme: PptxThemeConfig,
  extra: Partial<BlockEvaluatorOptions> = {}
): JsonBlockEvaluator {
  return new JsonBlockEvaluator(readBlockDefinitions(document), {
    format: 'pptx',
    theme,
    contextAt: (path) => pptxBlockContext(document, path),
    contextSources: { '/document': '/props' },
    // Slide width/height, in inches by default for a format authored in them.
    measure: (axis, unit, context) =>
      Number(blockValueAt(context, `/slide/${axis}`)) *
      (unit === 'in' ? 1 : unit === 'pt' ? 72 : 1440),
    ...extra,
  });
}

export function expandPptxBlocks<T>(
  document: T,
  theme: PptxThemeConfig
): ExpandedBlocks<T> {
  const effects: BlockSlideEffect[] = [];
  const evaluator = createPptxBlockEvaluator(document, theme, {
    onSlide: (effect) => effects.push(effect),
  });
  const expanded = evaluator.expand(document) as T;
  return finishPptxBlocks(expanded, evaluator, effects);
}

function slideIndexOf(path: string): number | undefined {
  const match = /^\/children\/(\d+)\/children\/\d+/.exec(path);
  return match ? Number(match[1]) : undefined;
}

function validateEffects(document: unknown, effects: BlockSlideEffect[]): void {
  for (const effect of effects) {
    const parts = effect.path.split('/').slice(1);
    const slide = blockValueAt(document, '/' + parts.slice(0, 2).join('/'));
    let valid =
      parts.length >= 4 &&
      parts[0] === 'children' &&
      parts[2] === 'children' &&
      isBlockRecord(slide) &&
      slide.name === 'slide';
    for (let i = 4; i < parts.length; i += 2) {
      const parent = blockValueAt(document, '/' + parts.slice(0, i).join('/'));
      valid &&=
        parts[i] === 'children' &&
        isBlockRecord(parent) &&
        parent.name === 'group';
    }
    if (!valid)
      throw new BlockEvaluationError([
        {
          path: effect.environment.source,
          code: 'invalid_placement',
          message:
            'Slide effects require a block invoked directly on a slide, optionally nested in transparent groups.',
        },
      ]);
  }
}

/**
 * Background and notes fill in what the slide did not state; among blocks the
 * last declaration on a slide wins, as a section's last tracker does in DOCX.
 * The grid becomes the expanded group's `gridConfig`, scoped to the body.
 */
function applySlideEffects(
  expanded: unknown,
  evaluator: JsonBlockEvaluator,
  effects: BlockSlideEffect[]
): void {
  if (!isBlockRecord(expanded) || !Array.isArray(expanded.children)) return;
  const supplied = new Set<string>();
  for (const effect of effects) {
    const index = slideIndexOf(effect.path);
    const slide = index === undefined ? undefined : expanded.children[index];
    if (!isBlockRecord(slide) || slide.name !== 'slide') continue;
    const slidePath = `/children/${index}`;
    const props: Rec = isBlockRecord(slide.props) ? { ...slide.props } : {};
    for (const key of ['background', 'notes'] as const) {
      const declared = effect.settings[key];
      if (declared === undefined) continue;
      const claim = `${slidePath}/${key}`;
      if (props[key] !== undefined && !supplied.has(claim)) continue;
      const value = evaluator.evaluate(
        declared,
        effect.environment,
        `${slidePath}/props/${key}`,
        `${effect.environment.definition}/slide/${key}`
      );
      if (value === undefined) continue;
      props[key] = value;
      supplied.add(claim);
    }
    slide.props = props;
    if (effect.settings.grid !== undefined) {
      const group = blockValueAt(expanded, effect.path);
      if (isBlockRecord(group) && group.name === 'group') {
        const grid = evaluator.evaluate(
          effect.settings.grid,
          effect.environment,
          `${effect.path}/props/gridConfig`,
          `${effect.environment.definition}/slide/grid`
        );
        if (grid !== undefined)
          group.props = {
            ...(isBlockRecord(group.props) ? group.props : {}),
            gridConfig: grid,
          };
      }
    }
  }
}

function finishPptxBlocks<T>(
  expanded: T,
  evaluator: JsonBlockEvaluator,
  effects: BlockSlideEffect[]
): ExpandedBlocks<T> {
  applySlideEffects(expanded, evaluator, effects);
  validateEffects(expanded, effects);
  if (evaluator.blocks.length) {
    const result = validatePresentationDocument(expanded);
    if (!result.valid)
      throw new BlockEvaluationError(
        result.errors.map((issue) => ({
          path: toAuthoredPointer(evaluator.sourceMap, issue.path),
          code: issue.code ?? 'block_invalid_output',
          message: issue.message,
        }))
      );
  }
  return {
    document: expanded,
    sourceMap: evaluator.sourceMap,
    blocks: evaluator.blocks,
  };
}

/**
 * Registered code and document-local JSON share one bounded expansion: a
 * plugin can emit a block, a block body or component slot can name a plugin,
 * and either can nest. The host supplies the registered code; JSON never
 * loads any. The caller validates the finished tree under its own validation
 * options; block output is validated here regardless, because a definition
 * that emits invalid primitives is a definition error.
 */
export async function expandPptxBlocksWithPlugins<T>(
  document: T,
  theme: PptxThemeConfig,
  plugins: ReadonlySet<string>,
  render: (component: Rec, path: string) => Promise<unknown[]>,
  preserve: ReadonlySet<string> = new Set()
): Promise<ExpandedBlocks<T> & { preserved: T }> {
  const effects: BlockSlideEffect[] = [];
  const evaluator = createPptxBlockEvaluator(document, theme, {
    reservedNames: [...plugins],
    onSlide: (effect) => effects.push(effect),
  });
  const composed = await composeBlocksWithPlugins(evaluator, document, {
    plugins,
    render,
    preserve,
  });
  const finished = finishPptxBlocks(composed.standard as T, evaluator, effects);
  return { ...finished, preserved: composed.preserved as T };
}
