/**
 * The `running-head` block, lowered to page chrome.
 *
 * Unlike the flow blocks, this one lowers to nothing where it stands: its
 * output is a header and a footer for the section it sits in and every later
 * section that authors no chrome of its own. The header is the document
 * title on the left and the section tracker on the right, set in the
 * `chrome.runningHead` recipe's role with a rule beneath; the footer is a
 * rule, then the confidentiality line, the page as `n / N` and the date, set
 * in the `chrome.confidentialFooter` recipe's role. Positions are tab stops
 * on the theme's measure, so the tracker sits flush with the right margin and
 * the page number is centred whatever the text around it.
 *
 * `{PAGE}` and `{TOTAL_PAGES}` are the pipeline's own placeholders: they
 * lower to Word fields, which is the only way a page can know its number.
 */

import type { RunningHeadProps } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import type { ComponentDefinition } from '../types';
import { getAvailableWidthTwips } from '../utils/widthUtils';
import { clampRule, roleProps } from './recipe';

/** What a running head resolves to for one section. */
export interface RunningHeadContext {
  /** Header left: the authored title or the document's. */
  title?: string;
  /** Header right: the section's tracker. */
  tracker?: string;
}

export interface RunningHeadCompilation {
  header: ComponentDefinition[];
  footer: ComponentDefinition[];
  /** Emitted pointer under the header array → authored pointer. */
  headerMap: Readonly<Record<string, string>>;
  footerMap: Readonly<Record<string, string>>;
}

/**
 * Where each slot's text came from, as absolute authored pointers. `self` is
 * the block; the others are absent when that slot holds no authored text.
 */
export interface RunningHeadSlots {
  self: string;
  title?: string;
  tracker?: string;
  confidentiality?: string;
  date?: string;
}

const FALLBACK = {
  headFont: { size: 8, color: 'textMuted', case: 'upper' },
  footFont: { size: 8, color: 'textMuted' },
  ruleWeightPt: 0.5,
  ruleColor: 'border',
} as const;

export const PAGE_OF_TOTAL = '{PAGE} / {TOTAL_PAGES}';

/**
 * Lower a running head for one section. `slots` names, per slot, the authored
 * pointer the text came from, so a finding on the compiled header lands on
 * the slot that produced it — the tracker may come from a section-opener
 * rather than from this block.
 */
export function compileRunningHead(
  props: RunningHeadProps,
  theme: ThemeConfig,
  context: RunningHeadContext,
  slots: RunningHeadSlots = { self: '' }
): RunningHeadCompilation {
  const measure = getAvailableWidthTwips(theme);
  const head = theme.chrome?.runningHead;
  const foot = theme.chrome?.confidentialFooter;

  const header: ComponentDefinition[] = [];
  const headerMap: Record<string, string> = {};
  const title = context.title ?? '';
  const tracker = context.tracker ?? '';
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
    headerMap['/0'] = slots.self;
    headerMap['/0/props/text'] =
      (tracker !== '' ? slots.tracker : slots.title) ?? slots.self;
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
    headerMap[`/${header.length - 1}`] = slots.self;
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
    footerMap['/0'] = slots.self;
  }
  const parts = [
    props.confidentiality ?? '',
    props.pageNumbers === false ? '' : PAGE_OF_TOTAL,
    props.date ?? '',
  ];
  const text = parts.join('\t').replace(/\t+$/, '');
  if (text !== '') {
    footer.push({
      name: 'paragraph',
      props: {
        text,
        tabStops: [
          { type: 'center', position: Math.round(measure / 2) },
          { type: 'right', position: measure },
        ],
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
    footerMap[`/${index}`] = slots.self;
    footerMap[`/${index}/props/text`] =
      slots.confidentiality ?? slots.date ?? slots.self;
  }

  return { header, footer, headerMap, footerMap };
}
