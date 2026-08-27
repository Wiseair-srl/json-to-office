import {
  QUALITY_CODES,
  QualityEngine,
  type QualityProfile,
  type QualityRule,
  type QualityRulePack,
} from '@json-to-office/quality';
import type {
  DocxHeadingFact,
  DocxQualityFact,
  DocxQualityModel,
  DocxTableWidthFact,
} from './facts';

/** Half a point: enough to absorb integer-twip rounding. */
const WIDTH_TOLERANCE_TWIPS = 10;

function numberParameter(
  parameters: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number
): number {
  const value = parameters[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const docxTableWidthRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/table-width',
  code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultParameters: { toleranceTwips: WIDTH_TOLERANCE_TWIPS },
  evaluate: ({ facts, configuration }) => {
    const toleranceTwips = numberParameter(
      configuration.parameters,
      'toleranceTwips',
      WIDTH_TOLERANCE_TWIPS
    );
    return facts
      .filter(
        (fact): fact is DocxTableWidthFact => fact.kind === 'docx/table-width'
      )
      .filter(
        (fact) =>
          fact.hasExplicitWidth &&
          fact.totalWidthTwips > fact.availableWidthTwips + toleranceTwips
      )
      .map((fact) => {
        const totalPt = Math.round((fact.totalWidthTwips / 20) * 10) / 10;
        const availablePt =
          Math.round((fact.availableWidthTwips / 20) * 10) / 10;
        return {
          message: `Column widths use ${totalPt}pt, but this section has ${availablePt}pt available — the table will spill off the right edge.`,
          path: fact.path,
          suggestion:
            'Reduce fixed/percentage widths, widen the page, or leave columns unsized so they share the remainder.',
          context: {
            totalWidthPt: totalPt,
            availableWidthPt: availablePt,
            pointSum: fact.pointSum,
            percentSum: fact.percentSum,
          },
          evidence: {
            actual: totalPt,
            expected: availablePt,
            unit: 'pt',
          },
        };
      });
  },
};

export const docxHeadingHierarchyRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/heading-hierarchy',
  code: QUALITY_CODES.HEADING_SKIP,
  category: 'hierarchy',
  defaultSeverity: 'info',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  evaluate: ({ facts }) =>
    facts
      .filter((fact): fact is DocxHeadingFact => fact.kind === 'docx/heading')
      .flatMap((fact) => {
        const previousLevel = fact.previousLevel;
        if (previousLevel === undefined || fact.level <= previousLevel + 1) {
          return [];
        }
        return [
          {
            message: `Heading level ${fact.level} follows level ${previousLevel} — the skipped level breaks the document outline.`,
            path: fact.path,
            suggestion: `Use level ${previousLevel + 1}, or promote this heading's section.`,
            context: { level: fact.level, previousLevel },
            evidence: {
              actual: fact.level,
              expected: previousLevel + 1,
            },
          },
        ];
      }),
};

export const DOCX_QUALITY_RULES: QualityRulePack<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/default',
  rules: [docxTableWidthRule, docxHeadingHierarchyRule],
};

export const DOCX_QUALITY_PROFILES = {
  'executive-report': {
    id: 'executive-report',
    formats: ['docx'],
    description: 'Short decision document with strict outline continuity.',
    rules: {
      'docx/heading-hierarchy': { severity: 'warning' },
    },
  },
  'technical-report': {
    id: 'technical-report',
    formats: ['docx'],
    description: 'Portable professional report defaults.',
  },
  'legal-appendix': {
    id: 'legal-appendix',
    formats: ['docx'],
    description: 'Dense appendix: preserve integrity without editorial taste.',
  },
} as const satisfies Record<string, QualityProfile>;

export const DOCX_DEFAULT_QUALITY_PROFILE: QualityProfile =
  DOCX_QUALITY_PROFILES['technical-report'];

const DOCX_PROFILES_BY_ID: Readonly<Record<string, QualityProfile>> =
  DOCX_QUALITY_PROFILES;

/**
 * Callers name a shipped profile by id — `{ id: 'executive-report', formats: ['docx'] }`.
 * Without this lookup that request reaches the engine carrying nothing but its id,
 * so the analysis runs on defaults while stamping the requested profileId.
 */
export function resolveDocxQualityProfile(
  requested: QualityProfile | undefined
): QualityProfile | undefined {
  if (!requested) return undefined;
  const registered = DOCX_PROFILES_BY_ID[requested.id];
  if (!registered) return requested;
  return {
    ...registered,
    ...requested,
    rules: { ...registered.rules, ...requested.rules },
    parameters: { ...registered.parameters, ...requested.parameters },
  };
}

export const docxQualityEngine = new QualityEngine(DOCX_QUALITY_RULES.rules);
