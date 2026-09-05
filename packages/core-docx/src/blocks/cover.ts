/**
 * The `cover` block, lowered to primitives.
 *
 * A logo where the theme's `logoSlot` puts it, the cover rule from the
 * `chrome.cover` recipe a third of the way down the page, the client as an
 * eyebrow, the title in the recipe's type role, the subtitle in the theme's
 * subtitle style, and a meta line — date and confidentiality — under it. The
 * drop to the title is a proportion of the page the theme declares, never a
 * coordinate; every colour and weight is the recipe's, with fallbacks that
 * hold on a theme that declares no recipe at all.
 *
 * The block does not break the page after itself: a paragraph can only break
 * before, and a break before the first paragraph of a new section is a blank
 * page. Put the cover in a section of its own and the report proper starts
 * on a fresh page with its own running head.
 */

import type { CoverProps } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import type { ComponentDefinition } from '../types';
import { getAvailableHeightTwips } from '../utils/widthUtils';
import { clampRule, hasStyle, roleProps } from './recipe';
import type { BlockCompilation } from './types';

/** How far down the page the cover rule sits, as a share of the measure. */
const DROP_SHARE = 0.3;
/** With a logo above the rule, the drop leaves room for it. */
const DROP_SHARE_WITH_LOGO = 0.22;
/** A logo with no stated width takes a quarter of the measure. */
const DEFAULT_LOGO_WIDTH = '25%';

const FALLBACK = {
  ruleWeightPt: 3,
  ruleColor: 'accent',
  padPt: 12,
  eyebrowFont: { size: 9, bold: true, color: 'accent', case: 'upper' },
  metaFont: { size: 9, color: 'textSecondary' },
} as const;

export function compileCover(
  props: CoverProps,
  theme: ThemeConfig
): BlockCompilation {
  const recipe = theme.chrome?.cover;
  const ruleWeightPt = recipe?.rule?.weightPt ?? FALLBACK.ruleWeightPt;
  const padPt = recipe?.padPt ?? FALLBACK.padPt;
  const heightPt = getAvailableHeightTwips(theme) / 20;
  const dropPt = Math.round(
    heightPt * (props.logo ? DROP_SHARE_WITH_LOGO : DROP_SHARE)
  );

  const children: ComponentDefinition[] = [];
  const sourceMap: Record<string, string> = {};
  const emit = (child: ComponentDefinition, slots: Record<string, string>) => {
    const index = children.push(child) - 1;
    sourceMap[`/children/${index}`] = '';
    for (const [emitted, authored] of Object.entries(slots)) {
      sourceMap[`/children/${index}${emitted}`] = authored;
    }
  };

  if (props.logo) {
    const { width, height, ...source } = props.logo;
    emit(
      {
        name: 'image',
        props: {
          ...source,
          width: width ?? DEFAULT_LOGO_WIDTH,
          ...(height !== undefined && { height }),
          alignment: theme.chrome?.logoSlot?.alignment ?? 'left',
          spacing: { before: 0, after: 0 },
        },
      } as ComponentDefinition,
      { '/props': '/props/logo' }
    );
  }

  // The rule carries the drop: a rule of weight zero is a recipe's way of
  // saying "no rule", and the drop then rides on the eyebrow or the title.
  const drawsRule = ruleWeightPt > 0;
  if (drawsRule) {
    emit(
      {
        name: 'divider',
        props: {
          thickness: clampRule(ruleWeightPt),
          color: recipe?.rule?.color ?? FALLBACK.ruleColor,
          spacing: { before: dropPt, after: padPt },
        },
      },
      {}
    );
  }
  let dropPending = !drawsRule;
  const before = (): { spacing: { before: number } } | Record<never, never> => {
    if (!dropPending) return {};
    dropPending = false;
    return { spacing: { before: dropPt } };
  };

  if (props.client) {
    emit(
      {
        name: 'paragraph',
        props: {
          text: props.client,
          keepNext: true,
          spacing: { after: 4 },
          ...roleProps(theme, 'eyebrow', FALLBACK.eyebrowFont),
          ...before(),
        },
      },
      { '/props/text': '/props/client' }
    );
  }

  const titleRole =
    recipe?.type && hasStyle(theme, recipe.type) ? recipe.type : 'title';
  emit(
    {
      name: 'paragraph',
      props: {
        text: props.title,
        keepNext: true,
        ...roleProps(theme, titleRole, { size: 26, bold: true }, recipe?.color),
        ...before(),
      },
    },
    { '/props/text': '/props/title' }
  );

  if (props.subtitle) {
    emit(
      {
        name: 'paragraph',
        props: {
          text: props.subtitle,
          keepNext: true,
          ...roleProps(theme, 'subtitle', { size: 13, color: 'textSecondary' }),
        },
      },
      { '/props/text': '/props/subtitle' }
    );
  }

  const meta = [props.date, props.confidentiality].filter(
    (part): part is string => typeof part === 'string' && part !== ''
  );
  if (meta.length > 0) {
    emit(
      {
        name: 'paragraph',
        props: {
          text: meta.join('  ·  '),
          spacing: { before: padPt, after: 0 },
          ...roleProps(theme, 'label', FALLBACK.metaFont),
        },
      },
      {
        '/props/text': props.date ? '/props/date' : '/props/confidentiality',
      }
    );
  }

  return { children, sourceMap };
}
