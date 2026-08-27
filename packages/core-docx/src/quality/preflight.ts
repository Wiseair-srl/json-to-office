/** DOCX quality analysis over renderer-aligned prepared facts. */

import type {
  PreparedDocument,
  QualityAnalysis,
  QualityPolicy,
  QualityProfile,
} from '@json-to-office/quality';
import type { ThemeConfig } from '../styles';
import type { ReportComponentDefinition } from '../types';
import { prepareDocxQualityDocument } from './facts';
import type { DocxQualityFact, DocxQualityModel } from './facts';
import { DOCX_DEFAULT_QUALITY_PROFILE, docxQualityEngine } from './rules';

export interface DocxQualityOptions {
  customThemes?: Record<string, ThemeConfig>;
}

export interface DocxQualityAnalysisOptions extends DocxQualityOptions {
  renderer?: string;
  profile?: QualityProfile;
  policy?: QualityPolicy;
  prepared?: PreparedDocument<DocxQualityModel, DocxQualityFact>;
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
  } catch {
    // Structural validation owns malformed trees; quality remains additive.
    return emptyAnalysis();
  }
  return docxQualityEngine.analyzeSync(prepared, {
    profile: options.profile ?? DOCX_DEFAULT_QUALITY_PROFILE,
    policy: options.policy,
  });
}
