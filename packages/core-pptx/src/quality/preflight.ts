/** PPTX quality analysis over renderer-aligned prepared facts. */

import {
  assertValidQualityPolicy,
  assertValidQualityProfile,
  type PreparedDocument,
  type QualityAnalysis,
  type QualityPolicy,
  type QualityProfile,
  type QualityRuleError,
} from '@json-to-office/quality';
import type {
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../types';
import { preparePptxQualityDocument } from './facts';
import type { PptxQualityFact, PptxQualityModel } from './facts';
import {
  PPTX_DEFAULT_QUALITY_PROFILE,
  pptxQualityEngine,
  declaredPptxQualityProfile,
  resolvePptxQualityProfile,
} from './rules';

/** Synthetic rule id for a failure raised before any rule could run. */
const PREPARE_RULE_ID = 'quality/prepare';

export interface PptxQualityOptions {
  customThemes?: Record<string, PptxThemeConfig>;
}

export interface PptxQualityAnalysisOptions extends PptxQualityOptions {
  renderer?: string;
  profile?: QualityProfile;
  policy?: QualityPolicy;
  prepared?: PreparedDocument<PptxQualityModel, PptxQualityFact>;
}

function emptyAnalysis(
  ruleErrors: readonly QualityRuleError[] = [],
  blocked = false
): QualityAnalysis {
  return {
    diagnostics: [],
    counts: { error: 0, warning: 0, info: 0 },
    blocked,
    truncated: false,
    suppressedCount: 0,
    evaluatedRuleIds: [],
    ruleErrors,
  };
}

export function analyzePptxQuality(
  doc: unknown,
  options: PptxQualityAnalysisOptions = {}
): QualityAnalysis {
  // Ahead of every early return: a malformed document must not be the reason a
  // caller never hears that its own policy or profile was unusable.
  assertValidQualityPolicy(options.policy);
  assertValidQualityProfile(options.profile);

  if (
    typeof doc !== 'object' ||
    doc === null ||
    Array.isArray(doc) ||
    (doc as { name?: unknown }).name !== 'pptx'
  ) {
    return emptyAnalysis();
  }

  let prepared = options.prepared;
  try {
    prepared ??= preparePptxQualityDocument(
      doc as PresentationComponentDefinition,
      options
    );
  } catch (error) {
    // Structural validation owns malformed trees; quality remains additive.
    if (options.policy?.onRuleError === 'throw') throw error;
    const gate = options.policy?.gate;
    // A gate that could never be evaluated has not been satisfied: report the
    // failure and fail closed rather than pass a document nothing inspected.
    return emptyAnalysis(
      [
        {
          ruleId: PREPARE_RULE_ID,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      gate !== undefined && gate !== 'none'
    );
  }
  return pptxQualityEngine.analyzeSync(prepared, {
    profile:
      resolvePptxQualityProfile(options.profile) ??
      declaredPptxQualityProfile(doc) ??
      PPTX_DEFAULT_QUALITY_PROFILE,
    policy: options.policy,
  });
}
