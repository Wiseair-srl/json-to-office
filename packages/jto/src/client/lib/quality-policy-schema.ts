/**
 * JSON Schema for the run-policy editor, built from the rule catalog.
 *
 * It exists for Monaco: hovering a rule id explains it, and completion offers
 * the ids and parameters rather than leaving an author to remember them. The
 * server validates what it is actually sent, so this is guidance, not a gate.
 */

import { rulesForFormat } from './quality-rules';

/** Distinct from any document or theme file, so only the policy model matches. */
export const QUALITY_POLICY_MODEL_PATH = 'inmemory://jto/quality-policy.json';
export const QUALITY_POLICY_SCHEMA_URI =
  'https://json-to-office.dev/schema/quality-policy/v1';

const SEVERITY = {
  enum: ['error', 'warning', 'info'],
  description: 'Overrides the severity this rule reports at.',
};

export function createQualityPolicySchemaConfig(): {
  uri: string;
  fileMatch: string[];
  schema: object;
} {
  const rules = rulesForFormat();

  const ruleProperties: Record<string, unknown> = {};
  for (const rule of rules) {
    const parameters: Record<string, unknown> = {};
    for (const parameter of rule.parameters) {
      parameters[parameter.name] =
        parameter.type === 'string-list'
          ? {
              type: 'array',
              items: { type: 'string' },
              default: [...parameter.default],
              description: `${parameter.description} (default ${JSON.stringify(parameter.default)})`,
            }
          : {
              type: 'number',
              default: parameter.default,
              description: `${parameter.description} (default ${parameter.default})`,
            };
    }
    ruleProperties[rule.id] = {
      type: 'object',
      description: `${rule.description} Category ${rule.category}; reports at ${rule.defaultSeverity} by default.`,
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Set false to switch this rule off for the run.',
        },
        severity: { type: 'string', ...SEVERITY },
        ...(rule.parameters.length > 0 && {
          parameters: {
            type: 'object',
            description: 'Tuning for this rule.',
            properties: parameters,
            additionalProperties: false,
          },
        }),
      },
      additionalProperties: false,
    };
  }

  return {
    uri: QUALITY_POLICY_SCHEMA_URI,
    fileMatch: [QUALITY_POLICY_MODEL_PATH, '*quality-policy.json'],
    schema: {
      type: 'object',
      title: 'Quality run policy',
      description:
        'Per-run rule configuration. The gate and profile have their own controls and are not set here.',
      properties: {
        rules: {
          type: 'object',
          description: 'Overrides keyed by rule id.',
          properties: ruleProperties,
          additionalProperties: false,
        },
        suppressions: {
          type: 'array',
          description:
            'Findings to mute. Every entry must say why, so a muted rule stays accountable.',
          items: {
            type: 'object',
            required: ['reason'],
            properties: {
              ruleId: {
                type: 'string',
                enum: rules.map((rule) => rule.id),
                description: 'Mute this rule.',
              },
              code: {
                type: 'string',
                description:
                  'Mute this diagnostic code, e.g. W_QUALITY_HEADING_SKIP.',
              },
              path: {
                type: 'string',
                description: 'RFC 6901 pointer the suppression applies to.',
              },
              pathMatch: {
                enum: ['exact', 'subtree'],
                description:
                  '`subtree` also mutes everything beneath `path`. Defaults to exact.',
              },
              reason: {
                type: 'string',
                minLength: 1,
                description: 'Why this finding is acceptable here.',
              },
            },
            additionalProperties: false,
          },
        },
        maxDiagnostics: {
          type: 'integer',
          minimum: 0,
          description:
            'Stop after this many diagnostics. The report is marked truncated.',
        },
        onRuleError: {
          enum: ['continue', 'throw'],
          description:
            'What a crashing rule does: report and carry on, or fail the run.',
        },
      },
      additionalProperties: false,
    },
  };
}
