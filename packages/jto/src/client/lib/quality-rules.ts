/**
 * The shipped quality rules, as the playground knows them.
 *
 * The engine owns the real registry, but it lives behind the server and the
 * client never receives it — findings carry a `ruleId` and nothing else. A
 * policy editor that cannot name the rules is a text box for guessing, so the
 * ids, their defaults and their tunable parameters are mirrored here and fed to
 * the editor's schema for validation and completion.
 *
 * Keep in step with `core-docx/src/quality/rules.ts` and
 * `core-pptx/src/quality/rules.ts` — each list below is in its rule pack's own
 * order, so the two read side by side.
 *
 * A *wrong* entry costs a wrong hint and nothing more: the server validates
 * the policy it is actually sent. A *missing* one costs more than that, which
 * is what this file used to get wrong about itself. `parseQualityPolicy`
 * refuses any rule id it cannot find here, so nine rules shipping without an
 * entry did not merely go uncompleted — a policy naming one was rejected in
 * the editor and never reached the server at all.
 *
 * `__tests__/quality-rules.test.ts` now compares this table against the packs
 * and fails when they disagree, because asking in a comment was not enough.
 */

import { FORMAT, type FormatName } from './env';
import type { QualitySeverity } from './quality-findings';

export type QualityRuleParameter =
  | {
      name: string;
      type: 'number';
      default: number;
      description: string;
    }
  | {
      name: string;
      /** A list of names, e.g. the slot roles a profile requires. */
      type: 'string-list';
      default: readonly string[];
      description: string;
    };

export interface QualityRuleInfo {
  id: string;
  label: string;
  category: string;
  defaultSeverity: QualitySeverity;
  description: string;
  parameters: readonly QualityRuleParameter[];
}

export const QUALITY_RULES: Record<FormatName, readonly QualityRuleInfo[]> = {
  docx: [
    {
      id: 'docx/table-width',
      label: 'Table width',
      category: 'integrity',
      defaultSeverity: 'warning',
      description:
        'Explicit column widths that sum past the usable width of their section.',
      parameters: [
        {
          name: 'toleranceTwips',
          type: 'number',
          default: 10,
          description: 'Slack before an overflow counts, in twips (20 = 1pt).',
        },
      ],
    },
    {
      id: 'docx/heading-hierarchy',
      label: 'Heading hierarchy',
      category: 'hierarchy',
      defaultSeverity: 'info',
      description: 'A heading that skips a level and breaks the outline.',
      parameters: [],
    },
    {
      id: 'docx/text-fit',
      label: 'Text fit',
      category: 'integrity',
      defaultSeverity: 'warning',
      description:
        'A word too wide for its floating frame, or a frame whose wrapped text runs off the sheet.',
      parameters: [
        {
          name: 'widthTolerance',
          type: 'number',
          default: 1.08,
          description:
            'How far past the frame the estimate must reach before it counts — 1.08 is the measured error of the width model.',
        },
      ],
    },
    {
      id: 'docx/frame-collision',
      label: 'Frame collision',
      category: 'integrity',
      defaultSeverity: 'warning',
      description:
        'Two page-anchored frames whose estimated text lands on the same region of a page.',
      parameters: [
        {
          name: 'minOverlapWidthTwips',
          type: 'number',
          default: 240,
          description:
            'Shared width before an overlap counts, in twips (240 = 12pt).',
        },
        {
          name: 'minOverlapLines',
          type: 'number',
          default: 1,
          description:
            'Shared height, in lines of text. Below one line the overlap costs no words.',
        },
      ],
    },
    {
      id: 'docx/svg-text-bounds',
      label: 'SVG text bounds',
      category: 'integrity',
      defaultSeverity: 'warning',
      description:
        'A text baseline outside an inline SVG’s viewBox, so the words are never painted.',
      parameters: [],
    },
    {
      id: 'docx/line-box',
      label: 'Line box',
      category: 'legibility',
      defaultSeverity: 'warning',
      description:
        'An `exactly` line box shorter than the capitals it has to hold.',
      parameters: [
        {
          name: 'minimumLineBoxRatio',
          type: 'number',
          default: 0.7,
          description:
            'Smallest line box as a fraction of font size. 0.7 em is cap height on the faces the stock templates use.',
        },
      ],
    },
    {
      id: 'docx/placeholder-text',
      label: 'Placeholder text',
      category: 'integrity',
      defaultSeverity: 'warning',
      description: 'An unfilled scaffold slot, or leftover filler copy.',
      parameters: [],
    },
    {
      id: 'docx/slot-budget',
      label: 'Slot budget',
      category: 'composition',
      defaultSeverity: 'warning',
      description:
        'A block slot holding more words than its budget allows — a takeaway past the word count the block sets.',
      parameters: [],
    },
    {
      id: 'docx/chart-design',
      label: 'Chart design',
      category: 'information-design',
      defaultSeverity: 'warning',
      description:
        'What a chart claims about its numbers: the comparison, the palette, the unit and the caption.',
      parameters: [
        {
          name: 'maximumSeries',
          type: 'number',
          default: 4,
          description:
            'Series before the reader spends the chart on its legend.',
        },
        {
          name: 'maximumSlices',
          type: 'number',
          default: 6,
          description:
            'Slices before a pie’s wedges are too close in angle to rank by eye.',
        },
      ],
    },
    {
      id: 'docx/table-design',
      label: 'Table design',
      category: 'information-design',
      defaultSeverity: 'warning',
      description:
        'How a table lays its numbers out: alignment, rounding, rules and length.',
      parameters: [
        {
          name: 'maximumRows',
          type: 'number',
          default: 25,
          description:
            'Rows before a table is a data dump rather than something read in place.',
        },
      ],
    },
    {
      id: 'docx/font-count',
      label: 'Font count',
      category: 'brand',
      defaultSeverity: 'warning',
      description: 'Distinct font families the document can paint.',
      parameters: [
        {
          name: 'maximumFamilies',
          type: 'number',
          default: 3,
          description:
            'Families before a document reads as assembled rather than designed.',
        },
      ],
    },
    {
      id: 'docx/palette-adherence',
      label: 'Palette adherence',
      category: 'brand',
      defaultSeverity: 'info',
      description: 'A literal colour the resolved theme does not define.',
      parameters: [],
    },
  ],
  pptx: [
    {
      id: 'pptx/canvas',
      label: 'Canvas',
      category: 'composition',
      defaultSeverity: 'info',
      description:
        'Slide dimensions: legacy 4:3, or a partially declared size.',
      parameters: [],
    },
    {
      id: 'pptx/minimum-font-size',
      label: 'Minimum font size',
      category: 'legibility',
      defaultSeverity: 'warning',
      description: 'Text below the size a projected slide can carry.',
      parameters: [
        {
          name: 'minimumFontPt',
          type: 'number',
          default: 7,
          description:
            'Smallest acceptable point size. The executive profile raises this to 14.',
        },
      ],
    },
    {
      id: 'pptx/text-fit',
      label: 'Text fit',
      category: 'integrity',
      defaultSeverity: 'info',
      description:
        'Estimated text height against its box. An estimate, not a measurement.',
      parameters: [
        {
          name: 'characterWidthFactor',
          type: 'number',
          default: 0.46,
          description:
            'Average glyph width as a fraction of point size. Tuned against rendered ground truth — changing it moves both detection and false alarms.',
        },
        {
          name: 'safetyBufferPt',
          type: 'number',
          default: 8,
          description: 'Slack before a tight fit is called an overflow.',
        },
      ],
    },
    {
      id: 'pptx/slide-density',
      label: 'Slide density',
      category: 'information-design',
      defaultSeverity: 'warning',
      description: 'Body word count per slide.',
      parameters: [
        {
          name: 'maximumBodyWords',
          type: 'number',
          default: 130,
          description:
            'Words before a slide reads as dense. The executive profile lowers this to 70.',
        },
      ],
    },
    {
      id: 'pptx/text-contrast',
      label: 'Text contrast',
      category: 'accessibility',
      defaultSeverity: 'warning',
      description:
        'Text against the surface behind it, judged by WCAG AA. Text over an image or a chart is skipped.',
      parameters: [
        {
          name: 'normalRatio',
          type: 'number',
          default: 4.5,
          description: 'Contrast ratio normal text has to clear.',
        },
        {
          name: 'largeRatio',
          type: 'number',
          default: 3,
          description: 'Contrast ratio large text has to clear.',
        },
        {
          name: 'largeTextPt',
          type: 'number',
          default: 18,
          description: 'Point size from which text counts as large.',
        },
        {
          name: 'largeBoldTextPt',
          type: 'number',
          default: 14,
          description: 'Point size from which bold text counts as large.',
        },
      ],
    },
    {
      id: 'pptx/placeholder-text',
      label: 'Placeholder text',
      category: 'integrity',
      defaultSeverity: 'warning',
      description: 'An unfilled scaffold slot, or leftover filler copy.',
      parameters: [],
    },
    {
      id: 'pptx/box-overlap',
      label: 'Box overlap',
      category: 'integrity',
      defaultSeverity: 'info',
      description:
        'Two opaque boxes on one slide that land on each other. A duplicate, or anything covering data, is a warning.',
      parameters: [
        {
          name: 'minimumOverlapPt',
          type: 'number',
          default: 4,
          description:
            'Overlap on both axes before two boxes count as colliding, in points.',
        },
        {
          name: 'minimumAreaRatio',
          type: 'number',
          default: 0.15,
          description:
            'Overlap as a fraction of the smaller box before it is reported.',
        },
      ],
    },
    {
      id: 'pptx/chart-design',
      label: 'Chart design',
      category: 'information-design',
      defaultSeverity: 'warning',
      description:
        'What a chart claims about its numbers: the comparison, the scale, the palette and the unit.',
      parameters: [
        {
          name: 'maximumSeries',
          type: 'number',
          default: 4,
          description:
            'Series before the reader spends the chart on its legend.',
        },
        {
          name: 'maximumSlices',
          type: 'number',
          default: 6,
          description:
            'Slices before a pie’s wedges are too close in angle to rank by eye.',
        },
      ],
    },
    {
      id: 'pptx/table-design',
      label: 'Table design',
      category: 'information-design',
      defaultSeverity: 'warning',
      description:
        'How a table lays its numbers out: alignment, rounding, rules and length.',
      parameters: [
        {
          name: 'maximumRows',
          type: 'number',
          default: 12,
          description:
            'Rows a slide table can carry at a size an audience can read.',
        },
      ],
    },
    {
      id: 'pptx/font-count',
      label: 'Font count',
      category: 'brand',
      defaultSeverity: 'warning',
      description: 'Distinct font families the deck can paint.',
      parameters: [
        {
          name: 'maximumFamilies',
          type: 'number',
          default: 3,
          description:
            'Families before a deck reads as assembled rather than designed.',
        },
      ],
    },
    {
      id: 'pptx/palette-adherence',
      label: 'Palette adherence',
      category: 'brand',
      defaultSeverity: 'info',
      description: 'A literal colour the resolved theme does not define.',
      parameters: [],
    },
    {
      id: 'pptx/slot-budget',
      label: 'Slot budget',
      category: 'composition',
      defaultSeverity: 'warning',
      description: 'A block slot over the word budget its definition declares.',
      parameters: [],
    },
    {
      id: 'pptx/required-chrome',
      label: 'Required chrome',
      category: 'consistency',
      defaultSeverity: 'warning',
      description:
        'A block slot with a role the profile requires — a takeaway, a source — left empty. Off unless a profile names roles.',
      parameters: [
        {
          name: 'required',
          type: 'string-list',
          default: [],
          description:
            'Slot roles every block that declares them must fill: actionTitle, takeaway, source, tracker, footer.',
        },
      ],
    },
    {
      id: 'pptx/action-title',
      label: 'Action title length',
      category: 'hierarchy',
      defaultSeverity: 'warning',
      description:
        'An action-title slot that wraps past the lines the profile allows. Off at 0.',
      parameters: [
        {
          name: 'maxLines',
          type: 'number',
          default: 0,
          description:
            'Lines an action title may take in the box its definition drew; 0 disables the rule.',
        },
      ],
    },
  ],
};

/** The rules that can appear in this playground's policy. */
export function rulesForFormat(): readonly QualityRuleInfo[] {
  return QUALITY_RULES[FORMAT];
}
