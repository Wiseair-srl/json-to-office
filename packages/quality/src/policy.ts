import type {
  DiagnosticSeverity,
  QualityDiagnostic,
  QualityPolicy,
  QualityProfile,
  QualityRule,
  QualityRuleConfiguration,
  QualitySuppression,
  ResolvedQualityRuleConfiguration,
} from './types';

const SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Policies arrive from untrusted input (HTTP body, MCP tool call, CLI file). */
export class QualityPolicyError extends Error {
  readonly code = 'QUALITY_POLICY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'QualityPolicyError';
  }
}

function isSeverity(value: unknown): value is DiagnosticSeverity {
  return value === 'error' || value === 'warning' || value === 'info';
}

function assertRuleConfigurations(
  rules: Readonly<Record<string, QualityRuleConfiguration>> | undefined,
  origin: 'policy' | 'profile'
): void {
  for (const [ruleId, configuration] of Object.entries(rules ?? {})) {
    // A hand-written JSON policy can hold `null` or a scalar here; reading
    // `severity` off one is a TypeError, not the configuration error callers
    // are told to expect.
    if (
      typeof configuration !== 'object' ||
      configuration === null ||
      Array.isArray(configuration)
    ) {
      throw new QualityPolicyError(
        `Quality ${origin} rule "${ruleId}" has invalid configuration ${JSON.stringify(configuration)}; expected an object`
      );
    }
    if (
      configuration.severity !== undefined &&
      !isSeverity(configuration.severity)
    ) {
      throw new QualityPolicyError(
        `Quality ${origin} rule "${ruleId}" has invalid severity ${JSON.stringify(configuration.severity)}; expected "error", "warning" or "info"`
      );
    }
  }
}

export function assertValidQualityPolicy(
  policy: QualityPolicy | undefined
): void {
  if (!policy) return;
  if (
    policy.gate !== undefined &&
    policy.gate !== 'none' &&
    !isSeverity(policy.gate)
  ) {
    throw new QualityPolicyError(
      `Quality policy has invalid gate ${JSON.stringify(policy.gate)}; expected "none", "error", "warning" or "info"`
    );
  }
  assertRuleConfigurations(policy.rules, 'policy');
  if (
    policy.maxDiagnostics !== undefined &&
    (!Number.isInteger(policy.maxDiagnostics) || policy.maxDiagnostics < 0)
  ) {
    throw new QualityPolicyError(
      `Quality policy has invalid maxDiagnostics ${JSON.stringify(policy.maxDiagnostics)}; expected a non-negative integer`
    );
  }
  if (
    policy.onRuleError !== undefined &&
    policy.onRuleError !== 'continue' &&
    policy.onRuleError !== 'throw'
  ) {
    throw new QualityPolicyError(
      `Quality policy has invalid onRuleError ${JSON.stringify(policy.onRuleError)}; expected "continue" or "throw"`
    );
  }
}

export function assertValidQualityProfile(
  profile: QualityProfile | undefined
): void {
  if (!profile) return;
  assertRuleConfigurations(profile.rules, 'profile');
}

/**
 * Layer a caller's profile over a shipped one. A caller who names a profile and
 * overrides a single field of a single rule — `{ severity: 'error' }` — means to
 * keep the rest: replacing the whole configuration would silently drop the
 * shipped parameters, so every overlapping rule merges field by field.
 */
export function mergeQualityProfiles(
  base: QualityProfile,
  override: QualityProfile
): QualityProfile {
  const rules: Record<string, QualityRuleConfiguration> = { ...base.rules };
  for (const [ruleId, configuration] of Object.entries(override.rules ?? {})) {
    const shipped = rules[ruleId];
    rules[ruleId] = shipped
      ? {
          ...shipped,
          ...configuration,
          parameters: {
            ...shipped.parameters,
            ...configuration.parameters,
          },
        }
      : configuration;
  }
  return {
    ...base,
    ...override,
    rules,
    parameters: { ...base.parameters, ...override.parameters },
  };
}

export function resolveRuleConfiguration(
  rule: QualityRule,
  profile: QualityProfile | undefined,
  policy: QualityPolicy | undefined
): ResolvedQualityRuleConfiguration {
  const profileRule = profile?.rules?.[rule.id];
  const policyRule = policy?.rules?.[rule.id];

  return {
    enabled: policyRule?.enabled ?? profileRule?.enabled ?? true,
    severity:
      policyRule?.severity ?? profileRule?.severity ?? rule.defaultSeverity,
    severityOverride: policyRule?.severity ?? profileRule?.severity,
    parameters: {
      ...(rule.defaultParameters ?? {}),
      ...(profile?.parameters ?? {}),
      ...(profileRule?.parameters ?? {}),
      ...(policyRule?.parameters ?? {}),
    },
  };
}

function matchesPath(
  diagnosticPath: string,
  suppression: QualitySuppression
): boolean {
  if (suppression.path === undefined) return true;
  if (suppression.pathMatch !== 'subtree') {
    return diagnosticPath === suppression.path;
  }
  if (suppression.path === '') return true;
  return (
    diagnosticPath === suppression.path ||
    diagnosticPath.startsWith(`${suppression.path}/`)
  );
}

export function isSuppressed(
  diagnostic: Pick<QualityDiagnostic, 'ruleId' | 'code' | 'path'>,
  suppressions: readonly QualitySuppression[] = []
): boolean {
  return suppressions.some((suppression) => {
    const hasSelector =
      suppression.ruleId !== undefined ||
      suppression.code !== undefined ||
      suppression.path !== undefined;
    if (!hasSelector) return false;
    if (
      suppression.ruleId !== undefined &&
      diagnostic.ruleId !== suppression.ruleId
    ) {
      return false;
    }
    if (
      suppression.code !== undefined &&
      diagnostic.code !== suppression.code
    ) {
      return false;
    }
    return matchesPath(diagnostic.path, suppression);
  });
}

export function isBlocking(
  severity: DiagnosticSeverity,
  gate: QualityPolicy['gate'] = 'none'
): boolean {
  if (gate === 'none') return false;
  return SEVERITY_RANK[severity] <= SEVERITY_RANK[gate];
}

export function severityRank(severity: DiagnosticSeverity): number {
  return SEVERITY_RANK[severity];
}
