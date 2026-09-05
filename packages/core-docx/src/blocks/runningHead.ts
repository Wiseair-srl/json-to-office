/**
 * The `running-head` block, lowered to page chrome.
 *
 * Unlike the flow blocks, this one lowers to nothing where it stands: its
 * output is a header and a footer for the section it sits in and every later
 * section that authors no chrome of its own. The header is the document
 * title on the left and the section tracker on the right, set in the
 * `chrome.runningHead` recipe's role with a rule beneath; the footer is a
 * rule, then the confidentiality line, the page as `n / N` and the date, set
 * in the `chrome.confidentialFooter` recipe's role. Two or three parts sit
 * on tab stops at the section's measure, so the tracker is flush with the
 * right margin and the page number centred whatever the text around it. A
 * lone page number stays centred; a lone text part takes the recipe's
 * `alignment`.
 *
 * `{PAGE}` and `{TOTAL_PAGES}` are the pipeline's own placeholders: they
 * lower to Word fields, which is the only way a page can know its number.
 * Word counts from the first page of the document, cover included.
 */

import type { RunningHeadProps } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import { getDocumentMargins, getPageDimensions } from '../styles';
import type { ComponentDefinition } from '../types';
import { getAvailableWidthTwips } from '../utils/widthUtils';
import { clampRule, roleProps } from './recipe';
import type { BlockCompilation } from './types';

/** What one section tells the running head about itself. */
export interface RunningHeadScope {
  /** Authored pointer of the block, where chrome findings land by default. */
  block: string;
  /** The document's `metadata.title`, the header's left text by default. */
  documentTitle?: string;
  /**
   * The section's own tracker, from its `section-opener`, with the absolute
   * authored pointer of the slot it came from.
   */
  opener?: { text: string; slot: string };
  /** The section's `props.page` override, if it has one. */
  page?: SectionPage;
}

/** The part of a section's `props.page` the measure depends on. */
export interface SectionPage {
  size?: 'A4' | 'A3' | 'LETTER' | 'LEGAL' | { width: number; height: number };
  margins?: { left?: number; right?: number };
}

/** Header and footer, each as a compilation relative to its own array. */
export interface RunningHeadCompilation {
  header: BlockCompilation;
  footer: BlockCompilation;
}

const FALLBACK = {
  headFont: { size: 8, color: 'textMuted', case: 'upper' },
  footFont: { size: 8, color: 'textMuted' },
  ruleWeightPt: 0.5,
  ruleColor: 'border',
} as const;

export const PAGE_OF_TOTAL = '{PAGE} / {TOTAL_PAGES}';

/**
 * The text measure a section's chrome is laid out on: the theme's page,
 * unless the section overrides its size or side margins.
 */
export function sectionMeasureTwips(
  theme: ThemeConfig,
  page?: SectionPage
): number {
  if (!page || (page.size === undefined && page.margins === undefined)) {
    return getAvailableWidthTwips(theme);
  }
  const width = page.size
    ? getPageDimensions(page.size).width
    : getPageDimensions(theme.page.size).width;
  const margins = getDocumentMargins(theme);
  const left = page.margins?.left ?? margins.left ?? 1440;
  const right = page.margins?.right ?? margins.right ?? 1440;
  return Math.max(0, width - left - right);
}

/**
 * Lower a running head for one section. Every emitted pointer maps to the
 * slot whose text it carries — the opener's tracker when one set it, else
 * this block's own slot — so a finding on the compiled chrome lands where the
 * author can patch it.
 */
export function compileRunningHead(
  props: RunningHeadProps,
  theme: ThemeConfig,
  scope: RunningHeadScope
): RunningHeadCompilation {
  const measure = sectionMeasureTwips(theme, scope.page);
  const head = theme.chrome?.runningHead;
  const foot = theme.chrome?.confidentialFooter;
  const slot = (name: keyof RunningHeadProps): string | undefined =>
    props[name] !== undefined ? `${scope.block}/props/${name}` : undefined;

  const header: ComponentDefinition[] = [];
  const headerMap: Record<string, string> = {};
  const title = props.title ?? scope.documentTitle ?? '';
  const tracker = scope.opener?.text ?? props.tracker ?? '';
  if (title !== '' || tracker !== '') {
    const both = title !== '' && tracker !== '';
    header.push({
      name: 'paragraph',
      props: {
        text: both ? `${title}\t${tracker}` : title || tracker,
        ...(both
          ? { tabStops: [{ type: 'right', position: measure }] }
          : { alignment: title !== '' ? 'left' : head?.alignment ?? 'right' }),
        spacing: { before: 0, after: 0 },
        ...roleProps(
          theme,
          head?.type ?? 'tracker',
          FALLBACK.headFont,
          head?.color
        ),
      },
    } as ComponentDefinition);
    headerMap['/0'] = scope.block;
    headerMap['/0/props/text'] =
      (tracker !== ''
        ? scope.opener?.slot ?? slot('tracker')
        : slot('title')) ?? scope.block;
  }
  const headRule = head?.rule?.weightPt ?? FALLBACK.ruleWeightPt;
  if (headRule > 0) {
    header.push({
      name: 'divider',
      props: {
        thickness: clampRule(headRule),
        color: head?.rule?.color ?? FALLBACK.ruleColor,
        spacing: { before: 2, after: 0 },
      },
    });
    headerMap[`/${header.length - 1}`] = scope.block;
  }

  const footer: ComponentDefinition[] = [];
  const footerMap: Record<string, string> = {};
  const footRule = foot?.rule?.weightPt ?? FALLBACK.ruleWeightPt;
  if (footRule > 0) {
    footer.push({
      name: 'divider',
      props: {
        thickness: clampRule(footRule),
        color: foot?.rule?.color ?? FALLBACK.ruleColor,
        spacing: { before: 0, after: 4 },
      },
    });
    footerMap['/0'] = scope.block;
  }
  const parts = [
    props.confidentiality ?? '',
    props.pageNumbers === false ? '' : PAGE_OF_TOTAL,
    props.date ?? '',
  ];
  const present = parts.filter((part) => part !== '');
  if (present.length > 0) {
    // Two or three parts keep their places on the tab stops, so `n / N`
    // stays centred when the confidentiality line or the date is absent. A
    // lone page number is centred too; a lone text part sits where the
    // recipe's `alignment` says.
    const single = present.length === 1;
    const alignment =
      present[0] === PAGE_OF_TOTAL ? 'center' : foot?.alignment ?? 'left';
    footer.push({
      name: 'paragraph',
      props: {
        text: single ? present[0] : parts.join('\t').replace(/\t+$/, ''),
        ...(single
          ? { alignment }
          : {
              tabStops: [
                { type: 'center', position: Math.round(measure / 2) },
                { type: 'right', position: measure },
              ],
            }),
        spacing: { before: 0, after: 0 },
        ...roleProps(
          theme,
          foot?.type ?? 'footer',
          FALLBACK.footFont,
          foot?.color
        ),
      },
    } as ComponentDefinition);
    const index = footer.length - 1;
    footerMap[`/${index}`] = scope.block;
    footerMap[`/${index}/props/text`] =
      slot('confidentiality') ?? slot('date') ?? scope.block;
  }

  return {
    header: { children: header, sourceMap: headerMap },
    footer: { children: footer, sourceMap: footerMap },
  };
}
