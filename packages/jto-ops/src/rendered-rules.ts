/**
 * The rendered pass as a quality rule pack (#344).
 *
 * `draftRenderedFindings` measures; these rules are how the measurement
 * enters the quality contract. Each rule owns one code, one description the
 * design guide prints, and the defaults a profile or policy can move. All of
 * them read a single `rendered/geometry` fact — the PDF's word boxes, its
 * embedded fonts and the document's text inventory — and share one matching
 * pass over it, memoised per fact, so eight rules cost one search.
 */

import {
  QUALITY_CODES,
  type QualityRule,
  type QualityRuleFinding,
  type QualityRulePack,
} from '@json-to-office/quality';
import { isRenderedGeometryFact, renderedDraftFor } from './rendered-analysis';

export type RenderedRuleId =
  | 'rendered/clip'
  | 'rendered/spill'
  | 'rendered/overlap'
  | 'rendered/text-missing'
  | 'rendered/font-substituted'
  | 'rendered/empty-page'
  | 'rendered/heading-stranded'
  | 'rendered/paragraph-split'
  | 'rendered/page-underfilled';

interface RenderedRuleSpec {
  id: RenderedRuleId;
  code: string;
  description: string;
  category: QualityRule['category'];
  defaultSeverity: QualityRule['defaultSeverity'];
  formats?: readonly ('docx' | 'pptx')[];
}

function renderedRule(spec: RenderedRuleSpec): QualityRule {
  return {
    id: spec.id,
    code: spec.code,
    description: spec.description,
    category: spec.category,
    defaultSeverity: spec.defaultSeverity,
    defaultCertainty: 'rendered',
    ...(spec.formats && { formats: spec.formats }),
    evaluate({ facts }): readonly QualityRuleFinding[] {
      const fact = facts.find(isRenderedGeometryFact);
      if (!fact) return [];
      // A draft is a rule finding with one extra key the engine never reads.
      return renderedDraftFor(fact).byRule.get(spec.id) ?? [];
    },
  };
}

export const RENDERED_QUALITY_RULES: QualityRulePack = {
  id: 'rendered',
  rules: [
    renderedRule({
      id: 'rendered/clip',
      code: QUALITY_CODES.RENDERED_CLIP,
      description:
        'Words rendered past the page edge by more than 2 pt, or an authored string of which only a leading part rendered (`kind: truncated`, with the share found).',
      category: 'integrity',
      defaultSeverity: 'warning',
    }),
    renderedRule({
      id: 'rendered/spill',
      code: QUALITY_CODES.RENDERED_SPILL,
      description:
        'A framed paragraph or slide text box drawn wider (DOCX) or larger (PPTX) than the box it declared.',
      category: 'integrity',
      defaultSeverity: 'warning',
    }),
    renderedRule({
      id: 'rendered/overlap',
      code: QUALITY_CODES.RENDERED_OVERLAP,
      description:
        'Two words from different lines whose boxes intersect by more than 30% of the smaller.',
      category: 'integrity',
      defaultSeverity: 'warning',
    }),
    renderedRule({
      id: 'rendered/text-missing',
      code: QUALITY_CODES.RENDERED_TEXT_MISSING,
      description:
        'An authored string that appears nowhere in the PDF: fully clipped, hidden, or dropped by the renderer.',
      category: 'integrity',
      defaultSeverity: 'warning',
    }),
    renderedRule({
      id: 'rendered/font-substituted',
      code: QUALITY_CODES.RENDERED_FONT_SUBSTITUTED,
      description:
        'A requested family the PDF embeds no face of; a warning when the document declared a source for it, information when the host simply lacks it.',
      category: 'brand',
      defaultSeverity: 'info',
    }),
    renderedRule({
      id: 'rendered/empty-page',
      code: QUALITY_CODES.RENDERED_EMPTY_PAGE,
      description:
        'A wordless page (`kind: blank`), or in docx one whose only words are its running head or footer (`kind: chrome-only`): a full-page figure is fine, a blank page from a stray break or an empty section is not.',
      category: 'integrity',
      defaultSeverity: 'info',
    }),
    renderedRule({
      id: 'rendered/page-underfilled',
      code: QUALITY_CODES.RENDERED_PAGE_UNDERFILLED,
      description:
        'A docx page whose ink stops well above the footer: a middle page less than half filled before the next page begins (`kind: middle-page`), or a last page less than a quarter filled that holds only the tail of the document (`kind: last-page`); `context.fill` is the share used. The first page is never judged.',
      category: 'composition',
      defaultSeverity: 'info',
      formats: ['docx'],
    }),
    renderedRule({
      id: 'rendered/heading-stranded',
      code: QUALITY_CODES.RENDERED_HEADING_STRANDED,
      description: 'A heading that is the last body line on its page.',
      category: 'composition',
      defaultSeverity: 'warning',
      formats: ['docx'],
    }),
    renderedRule({
      id: 'rendered/paragraph-split',
      code: QUALITY_CODES.RENDERED_PARAGRAPH_SPLIT,
      description:
        'A paragraph leaving one line alone on either side of a page break (`kind: orphan` or `widow`).',
      category: 'composition',
      defaultSeverity: 'info',
      formats: ['docx'],
    }),
  ],
};
