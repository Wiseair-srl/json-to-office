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
 * `core-pptx/src/quality/rules.ts`. A drifted entry costs a wrong hint, never a
 * wrong analysis: the server validates the policy it is actually sent.
 */

import { FORMAT, type FormatName } from './env';
import type { QualitySeverity } from './quality-findings';

export interface QualityRuleParameter {
  name: string;
  type: 'number';
  default: number;
  description: string;
}

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
  ],
};

/** The rules that can appear in this playground's policy. */
export function rulesForFormat(): readonly QualityRuleInfo[] {
  return QUALITY_RULES[FORMAT];
}
