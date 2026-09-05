/**
 * The `key-takeaways` block, lowered to primitives.
 *
 * A rule in the theme's accent, a label in the theme's label role, the
 * takeaways as a list the theme's list defaults already style, and a hairline
 * to close the box. Nothing here is a coordinate or a colour of its own:
 * every value is read from the resolved theme's `chrome.keyTakeaways` recipe,
 * with defaults that hold on a theme that declares none, so the same block
 * looks like the house on `consulting` and like itself on any other theme.
 *
 * The compiled children carry a source map back to the slots — the label to
 * `/props/label`, the list items to `/props/items` — so a finding on a
 * compiled paragraph is reported at the takeaway the author can patch.
 */

import type { KeyTakeawaysProps } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import type { ComponentDefinition } from '../types';
import { clampRule, hasStyle } from './recipe';
import type { BlockCompilation } from './types';

export const KEY_TAKEAWAYS_DEFAULT_LABEL = 'Key takeaways';

/** The recipe a theme without one gets: an accent rule, a bold label, a pad. */
const FALLBACK_RECIPE = {
  ruleWeightPt: 1.5,
  ruleColor: 'accent',
  padPt: 6,
  type: 'label',
} as const;

export function compileKeyTakeaways(
  props: KeyTakeawaysProps,
  theme: ThemeConfig
): BlockCompilation {
  const recipe = theme.chrome?.keyTakeaways;
  const labelRole = recipe?.type ?? FALLBACK_RECIPE.type;
  const labelStyle = hasStyle(theme, labelRole);
  const ruleWeightPt = clampRule(
    recipe?.rule?.weightPt ?? FALLBACK_RECIPE.ruleWeightPt
  );
  const ruleColor =
    recipe?.rule?.color ?? recipe?.color ?? FALLBACK_RECIPE.ruleColor;
  const padPt = recipe?.padPt ?? FALLBACK_RECIPE.padPt;

  const children: ComponentDefinition[] = [
    {
      name: 'divider',
      props: {
        thickness: ruleWeightPt,
        color: ruleColor,
        spacing: { before: 12, after: padPt },
      },
    },
    {
      name: 'paragraph',
      props: {
        text: props.label ?? KEY_TAKEAWAYS_DEFAULT_LABEL,
        keepNext: true,
        spacing: { after: 4 },
        // The label role when the theme resolves one; a bold run in the
        // recipe's colour otherwise, so the label still reads as a label.
        ...(labelStyle
          ? { themeStyle: labelRole }
          : {
              font: {
                bold: true,
                ...(recipe?.color !== undefined && { color: recipe.color }),
              },
            }),
      },
    },
    {
      name: 'list',
      props: { items: [...props.items] },
    },
    {
      name: 'divider',
      props: {
        thickness: 0.5,
        color: 'borderPrimary',
        spacing: { before: padPt, after: 12 },
      },
    },
  ];

  return {
    children,
    sourceMap: {
      '/children/0': '',
      '/children/1': '',
      '/children/1/props/text': '/props/label',
      '/children/2': '',
      '/children/2/props/items': '/props/items',
      '/children/3': '',
    },
  };
}
