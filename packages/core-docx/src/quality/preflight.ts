/** DOCX quality analysis over renderer-aligned prepared facts. */

import type {
  PreparedDocument,
  QualityAnalysis,
  QualityPolicy,
  QualityProfile,
  QualityRuleError,
} from '@json-to-office/quality';
import type { ThemeConfig } from '../styles';
import type { ReportComponentDefinition } from '../types';
import { prepareDocxQualityDocument } from './facts';
import type { DocxQualityFact, DocxQualityModel } from './facts';
import {
  DOCX_DEFAULT_QUALITY_PROFILE,
  docxQualityEngine,
  resolveDocxQualityProfile,
} from './rules';

/** Synthetic rule id for a failure raised before any rule could run. */
const PREPARE_RULE_ID = 'quality/prepare';

export interface DocxQualityOptions {
  customThemes?: Record<string, ThemeConfig>;
}

export interface DocxQualityAnalysisOptions extends DocxQualityOptions {
  renderer?: string;
  profile?: QualityProfile;
  policy?: QualityPolicy;
  prepared?: PreparedDocument<DocxQualityModel, DocxQualityFact>;
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

export function analyzeDocxQuality(
  doc: unknown,
  options: DocxQualityAnalysisOptions = {}
): QualityAnalysis {
  if (
    typeof doc !== 'object' ||
    doc === null ||
    Array.isArray(doc) ||
    (doc as { name?: unknown }).name !== 'docx'
  ) {
    return emptyAnalysis();
  }

  let prepared = options.prepared;
  try {
    prepared ??= prepareDocxQualityDocument(
      doc as ReportComponentDefinition,
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
  return docxQualityEngine.analyzeSync(prepared, {
    profile:
      resolveDocxQualityProfile(options.profile) ??
      DOCX_DEFAULT_QUALITY_PROFILE,
    policy: options.policy,
  });
}
