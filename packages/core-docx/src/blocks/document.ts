import {
  JsonBlockEvaluator,
  BlockEvaluationError,
  composeBlocksWithPlugins,
  readBlockDefinitions,
  blockValueAt,
  isBlockRecord,
  toAuthoredBlockPointer,
  type BlockSectionEffect,
  type BlockEvaluatorOptions,
} from '@json-to-office/shared';
export { blockSlotBudgets } from '@json-to-office/shared';
export type {
  BlockSlotBudget,
  BlockSourceMap,
  ExpandedBlocks,
} from '@json-to-office/shared';
import type { ExpandedBlocks } from '@json-to-office/shared';
import { validateDocument } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import { getDocumentMargins, getPageDimensions } from '../styles';
import {
  getAvailableHeightTwips,
  getAvailableWidthTwips,
} from '../utils/widthUtils';

type Rec = Record<string, unknown>;
export const toAuthoredPointer = toAuthoredBlockPointer;

/** General document state and page geometry. No report design is registered here. */
export function docxBlockContext(
  document: unknown,
  theme: ThemeConfig,
  path = ''
): Rec {
  const index = /^\/children\/(\d+)/.exec(path)?.[1];
  const section =
    index === undefined
      ? undefined
      : blockValueAt(document, `/children/${index}`);
  const page =
    isBlockRecord(section) &&
    isBlockRecord(section.props) &&
    isBlockRecord(section.props.page)
      ? section.props.page
      : {};
  const margins = getDocumentMargins(theme);
  const dimensions = getPageDimensions(
    (page.size ?? theme.page.size) as Parameters<typeof getPageDimensions>[0]
  );
  const overrides = isBlockRecord(page.margins) ? page.margins : {};
  const width = Object.keys(page).length
    ? Math.max(
        0,
        dimensions.width -
          Number(overrides.left ?? margins.left ?? 1440) -
          Number(overrides.right ?? margins.right ?? 1440)
      )
    : getAvailableWidthTwips(theme);
  const height = Object.keys(page).length
    ? Math.max(
        0,
        dimensions.height -
          Number(overrides.top ?? margins.top ?? 1440) -
          Number(overrides.bottom ?? margins.bottom ?? 1440)
      )
    : getAvailableHeightTwips(theme);
  return {
    document: blockValueAt(document, '/props/metadata') ?? {},
    page: { width, height },
    section: {},
  };
}

export function createDocxBlockEvaluator(
  document: unknown,
  theme: ThemeConfig,
  extra: Partial<BlockEvaluatorOptions> = {}
): JsonBlockEvaluator {
  return new JsonBlockEvaluator(readBlockDefinitions(document), {
    format: 'docx',
    theme,
    contextAt: (path) => docxBlockContext(document, theme, path),
    contextSources: { '/document': '/props/metadata' },
    measure: (axis, unit, context) =>
      Number(blockValueAt(context, `/page/${axis}`)) /
      (unit === 'twip' ? 1 : unit === 'in' ? 1440 : 20),
    ...extra,
  });
}

export function expandBlocks<T>(
  document: T,
  theme: ThemeConfig
): ExpandedBlocks<T> {
  const effects: BlockSectionEffect[] = [];
  const evaluator = createDocxBlockEvaluator(document, theme, {
    onSection: (effect) => effects.push(effect),
  });
  const expanded = evaluator.expand(document) as T;
  return finishDocxBlocks(expanded, document, theme, evaluator, effects);
}

function validateEffects(
  document: unknown,
  effects: BlockSectionEffect[]
): void {
  for (const effect of effects) {
    const parts = effect.path.split('/').slice(1);
    const section = blockValueAt(document, '/' + parts.slice(0, 2).join('/'));
    let valid =
      parts.length >= 4 &&
      parts[0] === 'children' &&
      parts[2] === 'children' &&
      isBlockRecord(section) &&
      section.name === 'section';
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
            'Section effects require a block in a top-level section body, optionally nested in transparent groups.',
        },
      ]);
  }
}

function finishDocxBlocks<T>(
  expanded: T,
  document: T,
  theme: ThemeConfig,
  evaluator: JsonBlockEvaluator,
  effects: BlockSectionEffect[],
  validate = true
): ExpandedBlocks<T> {
  // Section effects are evaluated separately from flow so header content sees
  // the current section tracker even when its defining block occurs later.
  if (isBlockRecord(expanded) && Array.isArray(expanded.children)) {
    let inherited: BlockSectionEffect | undefined;
    expanded.children.forEach((section, index) => {
      if (
        !isBlockRecord(section) ||
        section.name !== 'section' ||
        section.enabled === false
      )
        return;
      const path = `/children/${index}`;
      const local = effects.filter((e) =>
        e.path.startsWith(`${path}/children/`)
      );
      let tracker: unknown;
      let trackerSource = path;
      for (const effect of local) {
        if (effect.settings.tracker !== undefined) {
          tracker = evaluator.evaluate(
            effect.settings.tracker,
            effect.environment,
            `${path}/props/tracker`,
            `${effect.environment.definition}/section/tracker`
          );
          trackerSource = toAuthoredPointer(
            evaluator.sourceMap,
            `${path}/props/tracker`
          );
        }
      }
      let chrome = inherited;
      for (const effect of local) {
        if (
          effect.settings.header !== undefined ||
          effect.settings.footer !== undefined
        ) {
          chrome = effect;
          if (effect.settings.scope === 'following') inherited = effect;
        }
      }
      const props: Rec = isBlockRecord(section.props)
        ? { ...section.props }
        : {};
      if (chrome) {
        const environment = {
          ...chrome.environment,
          context: {
            ...docxBlockContext(document, theme, path),
            section: { tracker },
          },
          contextSources: {
            '/document': '/props/metadata',
            '/section/tracker': trackerSource,
          },
        };
        for (const part of ['header', 'footer'] as const) {
          if (props[part] !== undefined || chrome.settings[part] === undefined)
            continue;
          const compiled = evaluator.evaluate(
            chrome.settings[part],
            environment,
            `${path}/props/${part}`,
            `${environment.definition}/section/${part}`
          );
          props[part] = evaluator.expand(compiled, `${path}/props/${part}`);
        }
        if (props.pageBreak === undefined)
          props.pageBreak = chrome.settings.pageBreak ?? true;
      }
      // A local explicit state-setting page break is useful without any chrome.
      for (const effect of local)
        if (
          effect.settings.pageBreak !== undefined &&
          props.pageBreak === undefined
        )
          props.pageBreak = effect.settings.pageBreak;
      section.props = props;
    });
  }
  validateEffects(expanded, effects);
  if (evaluator.blocks.length && validate) {
    const result = validateDocument(expanded);
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

/** The plugin host supplies registered code; JSON itself never loads code. */
export async function expandBlocksWithPlugins<T>(
  document: T,
  theme: ThemeConfig,
  plugins: ReadonlySet<string>,
  render: (component: Rec, path: string) => Promise<unknown[]>,
  preserve: ReadonlySet<string> = new Set()
): Promise<ExpandedBlocks<T> & { preserved: T }> {
  const effects: BlockSectionEffect[] = [];
  const evaluator = createDocxBlockEvaluator(document, theme, {
    reservedNames: [...plugins],
    onSection: (effect) => effects.push(effect),
  });
  const walk = (value: unknown) =>
    composeBlocksWithPlugins(evaluator, value, {
      plugins,
      render,
      preserve,
    });
  const first = await walk(document);
  const finished = finishDocxBlocks(
    first.standard as T,
    document,
    theme,
    evaluator,
    effects,
    false
  );
  // Inherited header/footer definitions can themselves contain registered
  // plugin components. Expand them before the same final validation gate.
  const second = await walk(finished.document);
  validateEffects(second.standard, effects);
  const result = validateDocument(second.standard);
  if (!result.valid)
    throw new BlockEvaluationError(
      result.errors.map((issue) => ({
        path: toAuthoredPointer(evaluator.sourceMap, issue.path),
        code: issue.code ?? 'block_invalid_output',
        message: issue.message,
      }))
    );
  return {
    document: second.standard as T,
    preserved: first.preserved as T,
    sourceMap: evaluator.sourceMap,
    blocks: evaluator.blocks,
  };
}
