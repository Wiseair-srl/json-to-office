/**
 * The run policy an author writes by hand.
 *
 * The profile and gate controls cover the two settings most runs need; this
 * covers the rest of the contract — per-rule severity, enable/disable and
 * parameters, suppressions, and the diagnostic budget — which until now was
 * reachable only through the CLI's `--quality-policy` file.
 *
 * `gate` is deliberately NOT accepted here. It has a control of its own, and
 * two writable sources for one field means the dropdown either lies or silently
 * loses, so naming it in the JSON is reported as a mistake instead.
 */

import { rulesForFormat } from './quality-rules';

export interface QualityRuleConfiguration {
  enabled?: boolean;
  severity?: 'error' | 'warning' | 'info';
  parameters?: Record<string, unknown>;
}

export interface QualitySuppression {
  ruleId?: string;
  code?: string;
  path?: string;
  pathMatch?: 'exact' | 'subtree';
  reason: string;
}

export interface EditableQualityPolicy {
  rules?: Record<string, QualityRuleConfiguration>;
  suppressions?: QualitySuppression[];
  maxDiagnostics?: number;
  onRuleError?: 'continue' | 'throw';
}

export type ParsedQualityPolicy =
  | { ok: true; policy: EditableQualityPolicy | undefined }
  | { ok: false; error: string };

/** What a fresh editor opens on: valid, inert, and a shape to copy. */
export const EMPTY_POLICY_TEXT = `{
  "rules": {},
  "suppressions": []
}
`;

const SEVERITIES = new Set(['error', 'warning', 'info']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and check a hand-written policy.
 *
 * Errors are values and name the offending key, because this text is typed by
 * hand and the server's own rejection would arrive as a 400 the panel reports
 * far from the field that caused it.
 */
export function parseQualityPolicy(
  text: string | undefined
): ParsedQualityPolicy {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: true, policy: undefined };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, error: `Not valid JSON: ${(error as Error).message}` };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'A policy must be a JSON object.' };
  }

  if ('gate' in parsed) {
    return {
      ok: false,
      error: 'Remove "gate" — it is set by the Gate control above.',
    };
  }
  if ('profile' in parsed) {
    return {
      ok: false,
      error: 'Remove "profile" — it is set by the Profile control above.',
    };
  }

  // Every key below is read by name, so anything else would be dropped in
  // silence — `{"maxDiagnostic": 0}` parsed as a valid empty policy and the
  // budget the author asked for never applied. Say so instead.
  const EDITABLE_KEYS = new Set([
    'rules',
    'suppressions',
    'maxDiagnostics',
    'onRuleError',
  ]);
  const unknownKey = Object.keys(parsed).find((key) => !EDITABLE_KEYS.has(key));
  if (unknownKey !== undefined) {
    return {
      ok: false,
      error: `Unknown key "${unknownKey}". A policy takes: ${[...EDITABLE_KEYS].join(', ')}.`,
    };
  }

  const known = new Set(rulesForFormat().map((rule) => rule.id));
  const policy: EditableQualityPolicy = {};

  if (parsed.rules !== undefined) {
    if (!isPlainObject(parsed.rules)) {
      return {
        ok: false,
        error: '"rules" must be an object keyed by rule id.',
      };
    }
    for (const [ruleId, configuration] of Object.entries(parsed.rules)) {
      if (!known.has(ruleId)) {
        return {
          ok: false,
          error: `Unknown rule "${ruleId}". This format ships: ${[...known].join(', ')}.`,
        };
      }
      if (!isPlainObject(configuration)) {
        return {
          ok: false,
          error: `Rule "${ruleId}" must be an object, e.g. { "severity": "warning" }.`,
        };
      }
      if (
        configuration.severity !== undefined &&
        !SEVERITIES.has(configuration.severity as string)
      ) {
        return {
          ok: false,
          error: `Rule "${ruleId}" has an invalid severity. Use "error", "warning" or "info".`,
        };
      }
      if (
        configuration.enabled !== undefined &&
        typeof configuration.enabled !== 'boolean'
      ) {
        return {
          ok: false,
          error: `Rule "${ruleId}": "enabled" must be true or false.`,
        };
      }
      if (
        configuration.parameters !== undefined &&
        !isPlainObject(configuration.parameters)
      ) {
        return {
          ok: false,
          error: `Rule "${ruleId}": "parameters" must be an object.`,
        };
      }
    }
    policy.rules = parsed.rules as Record<string, QualityRuleConfiguration>;
  }

  if (parsed.suppressions !== undefined) {
    if (!Array.isArray(parsed.suppressions)) {
      return { ok: false, error: '"suppressions" must be an array.' };
    }
    for (const [index, entry] of parsed.suppressions.entries()) {
      if (!isPlainObject(entry)) {
        return { ok: false, error: `Suppression ${index} must be an object.` };
      }
      // The contract makes `reason` mandatory on purpose: a muted finding that
      // nobody has to justify is how a rule quietly stops being enforced.
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
        return {
          ok: false,
          error: `Suppression ${index} needs a "reason" saying why the finding is acceptable.`,
        };
      }
      if (
        entry.pathMatch !== undefined &&
        entry.pathMatch !== 'exact' &&
        entry.pathMatch !== 'subtree'
      ) {
        return {
          ok: false,
          error: `Suppression ${index}: "pathMatch" must be "exact" or "subtree".`,
        };
      }
    }
    policy.suppressions = parsed.suppressions as QualitySuppression[];
  }

  if (parsed.maxDiagnostics !== undefined) {
    if (
      !Number.isInteger(parsed.maxDiagnostics) ||
      (parsed.maxDiagnostics as number) < 0
    ) {
      return {
        ok: false,
        error: '"maxDiagnostics" must be a whole number, zero or more.',
      };
    }
    policy.maxDiagnostics = parsed.maxDiagnostics as number;
  }

  if (parsed.onRuleError !== undefined) {
    if (parsed.onRuleError !== 'continue' && parsed.onRuleError !== 'throw') {
      return {
        ok: false,
        error: '"onRuleError" must be "continue" or "throw".',
      };
    }
    policy.onRuleError = parsed.onRuleError;
  }

  const empty =
    (policy.rules === undefined || Object.keys(policy.rules).length === 0) &&
    (policy.suppressions === undefined || policy.suppressions.length === 0) &&
    policy.maxDiagnostics === undefined &&
    policy.onRuleError === undefined;

  return { ok: true, policy: empty ? undefined : policy };
}
