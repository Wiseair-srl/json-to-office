import type {
  DiagnosticSeverity,
  QualityDiagnostic,
  QualityPolicy,
  QualityProfile,
  QualityRule,
  QualitySuppression,
  ResolvedQualityRuleConfiguration,
} from './types';

const SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
};

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
