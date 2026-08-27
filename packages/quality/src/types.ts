/** Stable built-in codes. Add freely; never rename or reuse. */
export const QUALITY_CODES = {
  CANVAS_UNSPECIFIED: 'W_QUALITY_CANVAS_UNSPECIFIED',
  CANVAS_NONSTANDARD: 'W_QUALITY_CANVAS_NONSTANDARD',
  CANVAS_LEGACY: 'W_QUALITY_CANVAS_LEGACY',
  TEXT_OVERFLOW: 'W_QUALITY_TEXT_OVERFLOW',
  TEXT_TIGHT: 'W_QUALITY_TEXT_TIGHT',
  SLIDE_DENSITY: 'W_QUALITY_SLIDE_DENSITY',
  FONT_SIZE_MIN: 'W_QUALITY_FONT_SIZE_MIN',
  TABLE_WIDTH_OVERFLOW: 'W_QUALITY_TABLE_WIDTH_OVERFLOW',
  HEADING_SKIP: 'W_QUALITY_HEADING_SKIP',
} as const;

export type BuiltInQualityCode =
  (typeof QUALITY_CODES)[keyof typeof QUALITY_CODES];

/** Built-ins stay discoverable while external rule packs can own stable codes. */
export type QualityCode = BuiltInQualityCode | (string & {});

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type QualityCertainty =
  | 'deterministic'
  | 'measured'
  | 'estimated'
  | 'rendered'
  | 'evaluative';

export type QualityCategory =
  | 'integrity'
  | 'accessibility'
  | 'legibility'
  | 'hierarchy'
  | 'composition'
  | 'consistency'
  | 'information-design'
  | 'brand';

export type DiagnosticSource = 'schema' | 'semantic' | 'renderer' | 'quality';

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  from?: string;
  value?: unknown;
}

export interface QualityEvidence {
  summary?: string;
  actual?: unknown;
  expected?: unknown;
  unit?: string;
  values?: Readonly<Record<string, unknown>>;
}

export interface DocumentDiagnostic {
  source: DiagnosticSource;
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  path: string;
  suggestion?: string;
  context?: Readonly<Record<string, unknown>>;
  relatedPaths?: readonly string[];
  evidence?: QualityEvidence;
  fixes?: readonly JsonPatchOperation[];
}

export interface QualityDiagnostic extends DocumentDiagnostic {
  source: 'quality';
  ruleId: string;
  category: QualityCategory;
  certainty: QualityCertainty;
  blocking: boolean;
  profileId?: string;
}

export interface SourceReference {
  /** Primary authored RFC 6901 JSON Pointer. */
  path: string;
  relatedPaths?: readonly string[];
  synthetic?: boolean;
}

export type ProvenanceMap = Readonly<Record<string, SourceReference>>;

export interface QualityFact {
  /** Stable within one prepared document. */
  id: string;
  kind: string;
  /** Authored pointer for the fact's primary subject. */
  path: string;
  relatedPaths?: readonly string[];
}

export interface PreparedDocument<
  TModel = unknown,
  TFact extends QualityFact = QualityFact,
  TMetadata extends Readonly<Record<string, unknown>> = Readonly<
    Record<string, unknown>
  >,
> {
  format: string;
  model: TModel;
  facts: readonly TFact[];
  provenance: ProvenanceMap;
  renderer?: string;
  metadata?: TMetadata;
}

export interface QualityRuleConfiguration {
  enabled?: boolean;
  severity?: DiagnosticSeverity;
  parameters?: Readonly<Record<string, unknown>>;
}

export interface ResolvedQualityRuleConfiguration {
  enabled: boolean;
  severity: DiagnosticSeverity;
  /** Set only when a profile or policy explicitly overrode this rule. */
  severityOverride?: DiagnosticSeverity;
  parameters: Readonly<Record<string, unknown>>;
}

export interface QualityProfile {
  id: string;
  version?: string;
  description?: string;
  formats?: readonly string[];
  rendererTargets?: readonly string[];
  parameters?: Readonly<Record<string, unknown>>;
  rules?: Readonly<Record<string, QualityRuleConfiguration>>;
}

export interface QualitySuppression {
  ruleId?: string;
  code?: string;
  path?: string;
  pathMatch?: 'exact' | 'subtree';
  reason: string;
}

export type QualityGate = 'none' | DiagnosticSeverity;

export interface QualityPolicy {
  rules?: Readonly<Record<string, QualityRuleConfiguration>>;
  suppressions?: readonly QualitySuppression[];
  gate?: QualityGate;
  maxDiagnostics?: number;
  onRuleError?: 'continue' | 'throw';
}

export interface QualityRuleFinding {
  code?: QualityCode;
  severity?: DiagnosticSeverity;
  category?: QualityCategory;
  certainty?: QualityCertainty;
  message: string;
  path: string;
  suggestion?: string;
  context?: Record<string, unknown>;
  relatedPaths?: readonly string[];
  evidence?: QualityEvidence;
  fixes?: readonly JsonPatchOperation[];
}

export interface QualityRuleContext<
  TModel = unknown,
  TFact extends QualityFact = QualityFact,
> {
  prepared: PreparedDocument<TModel, TFact>;
  facts: readonly TFact[];
  profile?: QualityProfile;
  configuration: ResolvedQualityRuleConfiguration;
}

export interface QualityRule<
  TModel = unknown,
  TFact extends QualityFact = QualityFact,
> {
  readonly id: string;
  readonly code: QualityCode;
  readonly category: QualityCategory;
  readonly defaultSeverity: DiagnosticSeverity;
  readonly defaultCertainty: QualityCertainty;
  readonly formats?: readonly string[];
  readonly defaultParameters?: Readonly<Record<string, unknown>>;
  evaluate(
    context: QualityRuleContext<TModel, TFact>
  ): readonly QualityRuleFinding[] | Promise<readonly QualityRuleFinding[]>;
}

export interface QualityRulePack<
  TModel = unknown,
  TFact extends QualityFact = QualityFact,
> {
  readonly id: string;
  readonly rules: readonly QualityRule<TModel, TFact>[];
}

export interface QualityRuleError {
  ruleId: string;
  message: string;
}

export interface QualityCounts {
  error: number;
  warning: number;
  info: number;
}

export interface QualityAnalysis {
  diagnostics: readonly QualityDiagnostic[];
  counts: QualityCounts;
  blocked: boolean;
  truncated: boolean;
  suppressedCount: number;
  evaluatedRuleIds: readonly string[];
  ruleErrors: readonly QualityRuleError[];
  profileId?: string;
}
