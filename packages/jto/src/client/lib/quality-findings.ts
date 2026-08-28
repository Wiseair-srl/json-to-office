/**
 * The playground's own model of a quality finding.
 *
 * The server hands the same finding over in two shapes: `/validate` returns
 * rich `QualityDiagnostic` objects, while `/generate` flattens each one into a
 * `GenerationWarning` whose real fields live in `context` and whose severity is
 * squashed to `warning | info`. Normalising both here keeps that asymmetry out
 * of the panel, the store and the Monaco markers.
 */

export type QualitySeverity = 'error' | 'warning' | 'info';

export type QualityCertainty =
  | 'deterministic'
  | 'measured'
  | 'estimated'
  | 'rendered'
  | 'evaluative';

export interface QualityFixOp {
  op: 'add' | 'replace' | 'remove' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export interface QualityEvidence {
  actual?: unknown;
  expected?: unknown;
  unit?: string;
  [key: string]: unknown;
}

export interface QualityFinding {
  /** Stable within one analysis; used as a React key and for fix dedup. */
  id: string;
  code: string;
  message: string;
  /** RFC 6901 pointer into the authored document. */
  path: string;
  severity: QualitySeverity;
  ruleId?: string;
  category?: string;
  certainty?: QualityCertainty;
  blocking?: boolean;
  suggestion?: string;
  relatedPaths?: readonly string[];
  evidence?: QualityEvidence;
  fixes?: readonly QualityFixOp[];
}

export interface GenerationWarningLike {
  component: string;
  message: string;
  severity?: 'warning' | 'info';
  context?: Record<string, unknown>;
}

const SEVERITIES: readonly QualitySeverity[] = ['error', 'warning', 'info'];

const SEVERITY_RANK: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Anything that is not one of the three legal severities sorts last rather
 * than throwing, so a future server-side severity cannot crash the panel.
 */
const UNRANKED = 3;

function rankOf(severity: unknown): number {
  return typeof severity === 'string' && severity in SEVERITY_RANK
    ? (SEVERITY_RANK[severity] as number)
    : UNRANKED;
}

const CERTAINTIES: readonly QualityCertainty[] = [
  'deterministic',
  'measured',
  'estimated',
  'rendered',
  'evaluative',
];

const FIX_OPS: readonly QualityFixOp['op'][] = [
  'add',
  'replace',
  'remove',
  'move',
  'copy',
  'test',
];

/** Findings with no category are grouped under this bucket. */
const UNCATEGORIZED = 'other';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The same test as `isRecord` but without the type predicate, for values that
 * are already typed and only need the runtime guard — narrowing them to
 * `Record<string, unknown>` would throw away the declared shape.
 */
function looksLikeObject(value: unknown): boolean {
  return isRecord(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asSeverity(value: unknown): QualitySeverity | undefined {
  return typeof value === 'string' &&
    (SEVERITIES as readonly string[]).includes(value)
    ? (value as QualitySeverity)
    : undefined;
}

function asCertainty(value: unknown): QualityCertainty | undefined {
  return typeof value === 'string' &&
    (CERTAINTIES as readonly string[]).includes(value)
    ? (value as QualityCertainty)
    : undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => {
    return typeof entry === 'string';
  });
  return strings.length > 0 ? strings : undefined;
}

function asEvidence(value: unknown): QualityEvidence | undefined {
  return isRecord(value) ? (value as QualityEvidence) : undefined;
}

/**
 * A malformed patch operation is worse than none: the fix button would apply
 * garbage to the author's document, so anything without a legal `op` and a
 * string `path` is discarded rather than passed along.
 */
function asFixes(value: unknown): readonly QualityFixOp[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const fixes: QualityFixOp[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const op = entry['op'];
    const path = entry['path'];
    if (typeof op !== 'string' || typeof path !== 'string') continue;
    if (!(FIX_OPS as readonly string[]).includes(op)) continue;
    const fix: QualityFixOp = { op: op as QualityFixOp['op'], path };
    if ('value' in entry) fix.value = entry['value'];
    const from = asString(entry['from']);
    if (from !== undefined) fix.from = from;
    fixes.push(fix);
  }
  return fixes.length > 0 ? fixes : undefined;
}

/**
 * The generate path double-encodes the code: the message arrives as
 * "[W_QUALITY_FONT_SIZE_MIN] Body text is 5pt" while the code is also in
 * `context.code`. Stripping the prefix keeps the panel from showing the code
 * twice, but only when the two agree — an unrelated bracketed prefix is part
 * of the rule's own wording and must survive.
 */
function stripCodePrefix(message: string, code: string | undefined): string {
  if (!code) return message;
  const prefix = `[${code}] `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

/**
 * Ids must survive a re-render of the same analysis, so they are derived from
 * the finding rather than from a counter or a random value. The index breaks
 * ties between findings that share a code and a path.
 */
function makeId(code: string, path: string, index: number): string {
  return `${code || 'quality'}:${path}:${index}`;
}

function buildFinding(
  fields: {
    code: unknown;
    message: unknown;
    path: unknown;
    severity: QualitySeverity;
    ruleId: unknown;
    category: unknown;
    certainty: unknown;
    blocking: unknown;
    suggestion: unknown;
    relatedPaths: unknown;
    evidence: unknown;
    fixes: unknown;
  },
  index: number
): QualityFinding | undefined {
  const code = asString(fields.code) ?? '';
  const rawMessage = asString(fields.message) ?? '';
  // Nothing to render and nothing to look up: the entry is not a finding.
  if (!code && !rawMessage) return undefined;

  const path = asString(fields.path) ?? '';
  const finding: QualityFinding = {
    id: makeId(code, path, index),
    code,
    // A finding row with no text at all is unreadable, so a code-only entry
    // shows its code rather than rendering blank.
    message: stripCodePrefix(rawMessage, code) || code,
    path,
    severity: fields.severity,
  };

  const ruleId = asString(fields.ruleId);
  if (ruleId !== undefined) finding.ruleId = ruleId;

  const category = asString(fields.category);
  if (category !== undefined) finding.category = category;

  const certainty = asCertainty(fields.certainty);
  if (certainty !== undefined) finding.certainty = certainty;

  if (typeof fields.blocking === 'boolean') finding.blocking = fields.blocking;

  const suggestion = asString(fields.suggestion);
  if (suggestion !== undefined) finding.suggestion = suggestion;

  const relatedPaths = asStringArray(fields.relatedPaths);
  if (relatedPaths !== undefined) finding.relatedPaths = relatedPaths;

  const evidence = asEvidence(fields.evidence);
  if (evidence !== undefined) finding.evidence = evidence;

  const fixes = asFixes(fields.fixes);
  if (fixes !== undefined) finding.fixes = fixes;

  return finding;
}

/** Split a generate response's warnings into quality findings and everything else. */
export function splitQualityWarnings(
  warnings: readonly GenerationWarningLike[] | null | undefined
): { findings: QualityFinding[]; others: GenerationWarningLike[] } {
  const findings: QualityFinding[] = [];
  const others: GenerationWarningLike[] = [];
  if (!Array.isArray(warnings)) return { findings, others };

  for (const warning of warnings) {
    // The array is typed, but it comes off the wire — a null slot is possible.
    if (!looksLikeObject(warning)) continue;
    if (warning.component !== 'quality') {
      others.push(warning);
      continue;
    }

    const context = isRecord(warning.context) ? warning.context : {};
    // `context.originalSeverity` is the only place an 'error' survives; the
    // top-level severity was already coerced to warning | info by the server.
    const severity =
      asSeverity(context['originalSeverity']) ??
      asSeverity(warning.severity) ??
      'warning';

    const finding = buildFinding(
      {
        code: context['code'],
        message: warning.message,
        path: context['path'],
        severity,
        ruleId: context['ruleId'],
        category: context['category'],
        certainty: context['certainty'],
        blocking: context['blocking'],
        suggestion: context['suggestion'],
        relatedPaths: context['relatedPaths'],
        evidence: context['evidence'],
        fixes: context['fixes'],
      },
      findings.length
    );
    if (finding) findings.push(finding);
  }

  return { findings, others };
}

/** Findings from a /validate response's qualityAnalysis object. */
export function findingsFromAnalysis(analysis: unknown): QualityFinding[] {
  if (!isRecord(analysis)) return [];
  const diagnostics = analysis['diagnostics'];
  if (!Array.isArray(diagnostics)) return [];

  const findings: QualityFinding[] = [];
  for (const diagnostic of diagnostics) {
    if (!isRecord(diagnostic)) continue;
    const finding = buildFinding(
      {
        code: diagnostic['code'],
        message: diagnostic['message'],
        path: diagnostic['path'],
        severity: asSeverity(diagnostic['severity']) ?? 'warning',
        ruleId: diagnostic['ruleId'],
        category: diagnostic['category'],
        certainty: diagnostic['certainty'],
        blocking: diagnostic['blocking'],
        suggestion: diagnostic['suggestion'],
        relatedPaths: diagnostic['relatedPaths'],
        evidence: diagnostic['evidence'],
        fixes: diagnostic['fixes'],
      },
      findings.length
    );
    if (finding) findings.push(finding);
  }
  return findings;
}

export function countBySeverity(findings: readonly QualityFinding[]): {
  error: number;
  warning: number;
  info: number;
} {
  const counts = { error: 0, warning: 0, info: 0 };
  if (!Array.isArray(findings)) return counts;
  for (const finding of findings) {
    const severity = asSeverity(finding?.severity);
    if (severity) counts[severity] += 1;
  }
  return counts;
}

/** error < warning < info, then by path, then by code. For Array.sort. */
export function compareFindings(a: QualityFinding, b: QualityFinding): number {
  const rankA = rankOf(a?.severity);
  const rankB = rankOf(b?.severity);
  if (rankA !== rankB) return rankA - rankB;
  const pathA = a?.path ?? '';
  const pathB = b?.path ?? '';
  if (pathA !== pathB) return pathA < pathB ? -1 : 1;
  const codeA = a?.code ?? '';
  const codeB = b?.code ?? '';
  if (codeA === codeB) return 0;
  return codeA < codeB ? -1 : 1;
}

/** Groups sorted by worst severity within the group, then category name. */
export function groupByCategory(
  findings: readonly QualityFinding[]
): Array<{ category: string; findings: QualityFinding[] }> {
  const groups = new Map<string, QualityFinding[]>();
  if (!Array.isArray(findings)) return [];

  for (const finding of findings) {
    if (!finding) continue;
    const category = finding.category || UNCATEGORIZED;
    const bucket = groups.get(category);
    if (bucket) bucket.push(finding);
    else groups.set(category, [finding]);
  }

  const worstRank = (group: readonly QualityFinding[]): number => {
    return group.reduce((worst, finding) => {
      const rank = rankOf(finding.severity);
      return rank < worst ? rank : worst;
    }, UNRANKED);
  };

  return Array.from(groups.entries())
    .map(([category, bucket]) => ({
      category,
      findings: [...bucket].sort(compareFindings),
    }))
    .sort((a, b) => {
      const rankDelta = worstRank(a.findings) - worstRank(b.findings);
      if (rankDelta !== 0) return rankDelta;
      if (a.category === b.category) return 0;
      return a.category < b.category ? -1 : 1;
    });
}

export function filterByMinSeverity(
  findings: readonly QualityFinding[],
  min: QualitySeverity
): QualityFinding[] {
  if (!Array.isArray(findings)) return [];
  // An unknown threshold must not silently hide findings, so it lets all pass.
  const limit = asSeverity(min) ? rankOf(min) : UNRANKED;
  return findings.filter((finding) => rankOf(finding?.severity) <= limit);
}

/** Human label for a certainty, e.g. 'measured' -> 'Measured'. */
export function certaintyLabel(
  c: QualityCertainty | undefined
): string | undefined {
  const certainty = asCertainty(c);
  if (!certainty) return undefined;
  return certainty.charAt(0).toUpperCase() + certainty.slice(1);
}
