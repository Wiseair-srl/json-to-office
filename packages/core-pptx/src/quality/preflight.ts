/** PPTX quality analysis over renderer-aligned prepared facts. */

import type {
  PreparedDocument,
  QualityAnalysis,
  QualityPolicy,
  QualityProfile,
} from '@json-to-office/quality';
import type {
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../types';
import { preparePptxQualityDocument } from './facts';
import type { PptxQualityFact, PptxQualityModel } from './facts';
import { PPTX_DEFAULT_QUALITY_PROFILE, pptxQualityEngine } from './rules';

export interface PptxQualityOptions {
  customThemes?: Record<string, PptxThemeConfig>;
}

export interface PptxQualityAnalysisOptions extends PptxQualityOptions {
  renderer?: string;
  profile?: QualityProfile;
  policy?: QualityPolicy;
  prepared?: PreparedDocument<PptxQualityModel, PptxQualityFact>;
}

function emptyAnalysis(): QualityAnalysis {
  return {
    diagnostics: [],
    counts: { error: 0, warning: 0, info: 0 },
    blocked: false,
    truncated: false,
    suppressedCount: 0,
    evaluatedRuleIds: [],
    ruleErrors: [],
  };
}

export function analyzePptxQuality(
  doc: unknown,
  options: PptxQualityAnalysisOptions = {}
): QualityAnalysis {
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
  } catch {
    // Structural validation owns malformed trees; quality remains additive.
    return emptyAnalysis();
  }
  return pptxQualityEngine.analyzeSync(prepared, {
    profile: options.profile ?? PPTX_DEFAULT_QUALITY_PROFILE,
    policy: options.policy,
  });
}
