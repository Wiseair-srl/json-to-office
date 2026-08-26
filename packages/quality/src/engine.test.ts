import { describe, expect, it } from 'vitest';
import { QualityEngine, QualityGateError, QualityProfileError } from './engine';
import type { PreparedDocument, QualityFact, QualityRule } from './types';

interface TestFact extends QualityFact {
  kind: 'measurement';
  value: number;
}

const prepared: PreparedDocument<{}, TestFact> = {
  format: 'pptx',
  model: {},
  facts: [
    {
      id: 'measurement:0',
      kind: 'measurement',
      path: '/children/0',
      value: 12,
    },
    { id: 'measurement:1', kind: 'measurement', path: '/children/1', value: 3 },
  ],
  provenance: {},
};

const minimumRule: QualityRule<{}, TestFact> = {
  id: 'test/minimum',
  code: 'W_TEST_MINIMUM',
  category: 'legibility',
  defaultSeverity: 'warning',
  defaultCertainty: 'measured',
  formats: ['pptx'],
  defaultParameters: { minimum: 10 },
  evaluate: ({ facts, configuration }) => {
    const minimum = Number(configuration.parameters.minimum);
    return facts
      .filter((fact) => fact.value < minimum)
      .map((fact) => ({
        path: fact.path,
        message: `${fact.value} is below ${minimum}`,
        evidence: { actual: fact.value, expected: minimum },
      }));
  },
};

describe('QualityEngine', () => {
  it('resolves profile parameters and policy severity/gating', async () => {
    const analysis = await new QualityEngine([minimumRule]).analyze(prepared, {
      profile: {
        id: 'executive-deck',
        formats: ['pptx'],
        rules: {
          'test/minimum': { parameters: { minimum: 15 } },
        },
      },
      policy: {
        gate: 'warning',
        rules: { 'test/minimum': { severity: 'error' } },
      },
    });

    expect(analysis.counts).toEqual({ error: 2, warning: 0, info: 0 });
    expect(analysis.blocked).toBe(true);
    expect(analysis.diagnostics).toMatchObject([
      {
        source: 'quality',
        ruleId: 'test/minimum',
        profileId: 'executive-deck',
        severity: 'error',
        certainty: 'measured',
        blocking: true,
      },
      {
        source: 'quality',
        ruleId: 'test/minimum',
        severity: 'error',
        blocking: true,
      },
    ]);
  });

  it('applies subtree suppressions and reports their count', async () => {
    const analysis = await new QualityEngine([minimumRule]).analyze(prepared, {
      profile: { id: 'strict', parameters: { minimum: 15 } },
      policy: {
        suppressions: [
          {
            ruleId: 'test/minimum',
            path: '/children/0',
            pathMatch: 'subtree',
            reason: 'deliberate exception',
          },
        ],
      },
    });

    expect(analysis.suppressedCount).toBe(1);
    expect(analysis.diagnostics.map((entry) => entry.path)).toEqual([
      '/children/1',
    ]);
  });

  it('keeps severe diagnostics when the output budget truncates', async () => {
    const infoRule: QualityRule<{}, TestFact> = {
      ...minimumRule,
      id: 'test/info',
      code: 'W_TEST_INFO',
      defaultSeverity: 'info',
    };
    const analysis = await new QualityEngine([infoRule, minimumRule]).analyze(
      prepared,
      {
        profile: { id: 'strict', parameters: { minimum: 15 } },
        policy: { maxDiagnostics: 2 },
      }
    );

    expect(analysis.truncated).toBe(true);
    expect(analysis.counts).toEqual({ error: 0, warning: 2, info: 2 });
    expect(analysis.diagnostics.map((entry) => entry.severity)).toEqual([
      'warning',
      'warning',
    ]);
  });

  it('isolates rule failures unless policy asks to throw', async () => {
    const brokenRule: QualityRule<{}, TestFact> = {
      ...minimumRule,
      id: 'test/broken',
      evaluate: () => {
        throw new Error('broken');
      },
    };
    const engine = new QualityEngine([brokenRule, minimumRule]);

    const continued = await engine.analyze(prepared);
    expect(continued.ruleErrors).toEqual([
      { ruleId: 'test/broken', message: 'broken' },
    ]);
    expect(continued.evaluatedRuleIds).toEqual(['test/broken', 'test/minimum']);

    await expect(
      engine.analyze(prepared, { policy: { onRuleError: 'throw' } })
    ).rejects.toThrow('broken');
  });

  it('runs static rule packs synchronously', () => {
    const analysis = new QualityEngine([minimumRule]).analyzeSync(prepared);
    expect(analysis.diagnostics).toHaveLength(1);
    expect(analysis.diagnostics[0].path).toBe('/children/1');
  });

  it('rejects a profile for another format', async () => {
    await expect(
      new QualityEngine([minimumRule]).analyze(prepared, {
        profile: { id: 'report', formats: ['docx'] },
      })
    ).rejects.toThrow('does not support format');
  });

  it('rejects renderer-targeted profiles outside their declared renderer', async () => {
    const engine = new QualityEngine([minimumRule]);

    await expect(
      engine.analyze(
        { ...prepared, renderer: 'pptxgenjs' },
        {
          profile: {
            id: 'office-open-deck',
            rendererTargets: ['office-open'],
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'QUALITY_PROFILE_INCOMPATIBLE',
      message: expect.stringContaining('does not support renderer'),
    });

    await expect(
      engine.analyze(prepared, {
        profile: {
          id: 'office-open-deck',
          rendererTargets: ['office-open'],
        },
      })
    ).rejects.toThrow('has no renderer identity');

    expect(new QualityProfileError('incompatible').code).toBe(
      'QUALITY_PROFILE_INCOMPATIBLE'
    );
  });

  it('carries the complete analysis in gate failures', async () => {
    const analysis = await new QualityEngine([minimumRule]).analyze(prepared, {
      policy: { gate: 'warning' },
    });
    const error = new QualityGateError(analysis);
    expect(error.code).toBe('QUALITY_GATE_FAILED');
    expect(error.analysis).toBe(analysis);
    expect(error.message).toContain('1 blocking diagnostic');
  });
});
