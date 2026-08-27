import {
  assertValidQualityPolicy,
  assertValidQualityProfile,
  isBlocking,
  isSuppressed,
  resolveRuleConfiguration,
  severityRank,
} from './policy';
import { QualityRuleRegistry } from './registry';
import type {
  DiagnosticSeverity,
  PreparedDocument,
  QualityAnalysis,
  QualityCounts,
  QualityDiagnostic,
  QualityFact,
  QualityPolicy,
  QualityProfile,
  QualityRule,
  QualityRuleError,
} from './types';

export interface QualityAnalyzeOptions {
  profile?: QualityProfile;
  policy?: QualityPolicy;
}

export class QualityProfileError extends Error {
  readonly code = 'QUALITY_PROFILE_INCOMPATIBLE';

  constructor(message: string) {
    super(message);
    this.name = 'QualityProfileError';
  }
}

export class QualityGateError extends Error {
  readonly code = 'QUALITY_GATE_FAILED';
  readonly analysis: QualityAnalysis;

  constructor(analysis: QualityAnalysis) {
    const blocking = analysis.diagnostics.filter(
      (diagnostic) => diagnostic.blocking
    );
    super(
      `Quality gate failed with ${blocking.length} blocking diagnostic${blocking.length === 1 ? '' : 's'}`
    );
    this.name = 'QualityGateError';
    this.analysis = analysis;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyCounts(): QualityCounts {
  return { error: 0, warning: 0, info: 0 };
}

function countDiagnostics(
  diagnostics: readonly Pick<QualityDiagnostic, 'severity'>[]
): QualityCounts {
  const counts = emptyCounts();
  for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1;
  return counts;
}

function assertProfileSupports(
  profile: QualityProfile | undefined,
  prepared: PreparedDocument
): void {
  if (profile?.formats && !profile.formats.includes(prepared.format)) {
    throw new QualityProfileError(
      `Quality profile "${profile.id}" does not support format "${prepared.format}"`
    );
  }
  if (profile?.rendererTargets) {
    if (!prepared.renderer) {
      throw new QualityProfileError(
        `Quality profile "${profile.id}" declares renderer targets, but the prepared document has no renderer identity`
      );
    }
    if (!profile.rendererTargets.includes(prepared.renderer)) {
      throw new QualityProfileError(
        `Quality profile "${profile.id}" does not support renderer "${prepared.renderer}"`
      );
    }
  }
}

export class QualityEngine<
  TModel = unknown,
  TFact extends QualityFact = QualityFact,
> {
  readonly registry: QualityRuleRegistry<TModel, TFact>;

  constructor(
    rules:
      | Iterable<QualityRule<TModel, TFact>>
      | QualityRuleRegistry<TModel, TFact> = []
  ) {
    this.registry =
      rules instanceof QualityRuleRegistry
        ? rules
        : new QualityRuleRegistry(rules);
  }

  async analyze(
    prepared: PreparedDocument<TModel, TFact>,
    options: QualityAnalyzeOptions = {}
  ): Promise<QualityAnalysis> {
    assertValidQualityPolicy(options.policy);
    assertValidQualityProfile(options.profile);
    assertProfileSupports(options.profile, prepared);
    return this.runAsync(prepared, options);
  }

  analyzeSync(
    prepared: PreparedDocument<TModel, TFact>,
    options: QualityAnalyzeOptions = {}
  ): QualityAnalysis {
    assertValidQualityPolicy(options.policy);
    assertValidQualityProfile(options.profile);
    assertProfileSupports(options.profile, prepared);
    const state = createAnalysisState();

    for (const rule of this.registry.rules(prepared.format)) {
      const configuration = resolveRuleConfiguration(
        rule,
        options.profile,
        options.policy
      );
      if (!configuration.enabled) continue;
      state.evaluatedRuleIds.push(rule.id);

      let findings;
      try {
        findings = rule.evaluate({
          prepared,
          facts: prepared.facts,
          profile: options.profile,
          configuration,
        });
      } catch (error) {
        handleRuleError(state.ruleErrors, rule.id, error, options.policy);
        continue;
      }
      if (isPromiseLike(findings)) {
        throw new Error(
          `Quality rule "${rule.id}" is asynchronous; use analyze()`
        );
      }
      appendFindings(state, rule, findings, options);
    }

    return finalizeAnalysis(state, options);
  }

  private async runAsync(
    prepared: PreparedDocument<TModel, TFact>,
    options: QualityAnalyzeOptions
  ): Promise<QualityAnalysis> {
    assertProfileSupports(options.profile, prepared);
    const state = createAnalysisState();

    for (const rule of this.registry.rules(prepared.format)) {
      const configuration = resolveRuleConfiguration(
        rule,
        options.profile,
        options.policy
      );
      if (!configuration.enabled) continue;
      state.evaluatedRuleIds.push(rule.id);

      let findings;
      try {
        findings = await rule.evaluate({
          prepared,
          facts: prepared.facts,
          profile: options.profile,
          configuration,
        });
      } catch (error) {
        handleRuleError(state.ruleErrors, rule.id, error, options.policy);
        continue;
      }
      appendFindings(state, rule, findings, options);
    }

    return finalizeAnalysis(state, options);
  }
}

interface AnalysisState {
  diagnostics: QualityDiagnostic[];
  evaluatedRuleIds: string[];
  ruleErrors: QualityRuleError[];
  suppressedCount: number;
}

function createAnalysisState(): AnalysisState {
  return {
    diagnostics: [],
    evaluatedRuleIds: [],
    ruleErrors: [],
    suppressedCount: 0,
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function handleRuleError(
  ruleErrors: QualityRuleError[],
  ruleId: string,
  error: unknown,
  policy: QualityPolicy | undefined
): void {
  if (policy?.onRuleError === 'throw') throw error;
  ruleErrors.push({ ruleId, message: errorMessage(error) });
}

function appendFindings(
  state: AnalysisState,
  rule: QualityRule,
  findings: readonly import('./types').QualityRuleFinding[],
  options: QualityAnalyzeOptions
): void {
  const configuration = resolveRuleConfiguration(
    rule,
    options.profile,
    options.policy
  );
  for (const finding of findings) {
    // An operator's explicit override outranks the per-code severity a rule sets
    // inline, which in turn outranks the rule's resolved default.
    const severity =
      configuration.severityOverride ??
      finding.severity ??
      configuration.severity;
    const diagnostic: QualityDiagnostic = {
      source: 'quality',
      ruleId: rule.id,
      code: finding.code ?? rule.code,
      category: finding.category ?? rule.category,
      certainty: finding.certainty ?? rule.defaultCertainty,
      severity,
      message: finding.message,
      path: finding.path,
      blocking: isBlocking(severity, options.policy?.gate),
      ...(options.profile && { profileId: options.profile.id }),
      ...(finding.suggestion !== undefined && {
        suggestion: finding.suggestion,
      }),
      ...(finding.context !== undefined && { context: finding.context }),
      ...(finding.relatedPaths !== undefined && {
        relatedPaths: finding.relatedPaths,
      }),
      ...(finding.evidence !== undefined && {
        evidence: finding.evidence,
      }),
      ...(finding.fixes !== undefined && { fixes: finding.fixes }),
    };

    if (isSuppressed(diagnostic, options.policy?.suppressions)) {
      state.suppressedCount += 1;
      continue;
    }
    state.diagnostics.push(diagnostic);
  }
}

function finalizeAnalysis(
  state: AnalysisState,
  options: QualityAnalyzeOptions
): QualityAnalysis {
  const counts = countDiagnostics(state.diagnostics);
  const blocked = state.diagnostics.some((diagnostic) => diagnostic.blocking);
  const maxDiagnostics = options.policy?.maxDiagnostics;
  let kept = state.diagnostics;
  let truncated = false;
  if (
    maxDiagnostics !== undefined &&
    Number.isInteger(maxDiagnostics) &&
    maxDiagnostics >= 0 &&
    state.diagnostics.length > maxDiagnostics
  ) {
    const ordered = state.diagnostics
      .map((diagnostic, index) => ({ diagnostic, index }))
      .sort(
        (a, b) =>
          severityRank(a.diagnostic.severity) -
            severityRank(b.diagnostic.severity) || a.index - b.index
      );
    // maxDiagnostics is a display budget, not a correctness lever: dropping a
    // blocking diagnostic would leave a failed gate with nothing to point at.
    const blockingCount = ordered.filter(
      ({ diagnostic }) => diagnostic.blocking
    ).length;
    let budget = Math.max(0, maxDiagnostics - blockingCount);
    kept = ordered
      .filter(({ diagnostic }) => {
        if (diagnostic.blocking) return true;
        if (budget === 0) return false;
        budget -= 1;
        return true;
      })
      .map(({ diagnostic }) => diagnostic);
    truncated = kept.length < state.diagnostics.length;
  }

  return {
    diagnostics: kept,
    counts,
    blocked,
    truncated,
    suppressedCount: state.suppressedCount,
    evaluatedRuleIds: state.evaluatedRuleIds,
    ruleErrors: state.ruleErrors,
    ...(options.profile && { profileId: options.profile.id }),
  };
}

export function qualitySeverityCounts(
  diagnostics: readonly { severity: DiagnosticSeverity }[]
): QualityCounts {
  return countDiagnostics(diagnostics);
}
