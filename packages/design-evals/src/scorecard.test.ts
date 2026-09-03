import { describe, expect, it } from 'vitest';
import { buildScorecard, median, totals } from './scorecard.js';
import { failedRun, type RunMetrics } from './metrics.js';
import type { RunManifest } from './manifest.js';

function run(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    briefId: 'brief',
    format: 'docx',
    outcome: 'completed',
    pages: 6,
    blockingFindings: 0,
    qualityByCode: {},
    placeholderLeaks: 0,
    fontSubstitutions: 0,
    iterations: 2,
    toolCalls: 9,
    cost: { inputTokens: 100, outputTokens: 50, usd: 0.01 },
    wallMs: 1000,
    retries: 0,
    ...overrides,
  };
}

const MANIFEST = { gitSha: 'abc' } as unknown as RunManifest;

describe('median', () => {
  it('averages the middle pair on an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBe(0);
  });
});

describe('totals', () => {
  it('keeps failed runs in every denominator', () => {
    // A scorecard whose denominator shrinks when the agent gives up is a
    // scorecard that improves by giving up.
    const summary = totals([
      run({ briefId: 'a' }),
      failedRun('b', 'docx', 'transport closed'),
    ]);
    expect(summary.runs).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.shippable).toBe(1);
    expect(summary.shippableRate).toBe(0.5);
  });

  it('counts a failed run as carrying an integrity defect', () => {
    // Its defects were never measured; calling it clean would be the wrong
    // way round.
    const summary = totals([failedRun('a', 'pptx', 'no result')]);
    expect(summary.integrityDefectRate).toBe(1);
  });

  it('refuses to call a document with a blocking finding shippable', () => {
    expect(totals([run({ blockingFindings: 1 })]).shippable).toBe(0);
    expect(totals([run({ placeholderLeaks: 2 })]).shippable).toBe(0);
    expect(totals([run({ pages: 0 })]).shippable).toBe(0);
  });

  it('takes the median iteration count over completed runs only', () => {
    // A run that produced nothing took no iterations in the sense the metric
    // means, and letting a zero in would flatter the median.
    const summary = totals([
      run({ iterations: 3 }),
      run({ iterations: 5 }),
      failedRun('c', 'docx', 'gave up'),
    ]);
    expect(summary.medianIterations).toBe(4);
  });

  it('sums cost and tool calls across everything attempted', () => {
    const summary = totals([run(), run(), failedRun('c', 'docx', 'x')]);
    expect(summary.totalToolCalls).toBe(18);
    expect(summary.totalInputTokens).toBe(200);
    expect(summary.totalUsd).toBeCloseTo(0.02);
  });
});

describe('buildScorecard', () => {
  const base = {
    manifest: MANIFEST,
    corpus: {
      kind: 'development' as const,
      hash: 'h',
      stratification: {
        total: 2,
        byFormat: {},
        byArchetype: {},
        byLanguage: {},
        byDensity: {},
      },
    },
    archetypes: { a: 'client-report', b: 'consulting-deck' },
    now: new Date('2026-09-03T12:00:00Z'),
  };

  it('groups by format and archetype, and sums quality codes', () => {
    const scorecard = buildScorecard({
      ...base,
      runs: [
        run({
          briefId: 'a',
          qualityByCode: { W_QUALITY_TEXT_OVERFLOW: 2 },
        }),
        run({
          briefId: 'b',
          format: 'pptx',
          qualityByCode: {
            W_QUALITY_TEXT_OVERFLOW: 1,
            W_QUALITY_SLIDE_DENSITY: 3,
          },
        }),
      ],
    });
    expect(scorecard.qualityByCode).toEqual({
      W_QUALITY_SLIDE_DENSITY: 3,
      W_QUALITY_TEXT_OVERFLOW: 3,
    });
    expect(Object.keys(scorecard.byFormat)).toEqual(['docx', 'pptx']);
    expect(Object.keys(scorecard.byArchetype)).toEqual([
      'client-report',
      'consulting-deck',
    ]);
    expect(scorecard.generatedAt).toBe('2026-09-03T12:00:00.000Z');
  });

  it('reports the judge separately, and only when there was one', () => {
    const unjudged = buildScorecard({ ...base, runs: [run({ briefId: 'a' })] });
    expect(unjudged.judge).toBeUndefined();

    const judged = buildScorecard({
      ...base,
      runs: [
        run({
          briefId: 'a',
          judge: {
            level: 4,
            wouldShip: true,
            genericness: 1,
            rationale: 'x',
          },
        }),
        // A failed run is not unjudged, it is unshippable — otherwise a phase
        // improves its rate by producing fewer documents.
        failedRun('b', 'pptx', 'overloaded'),
      ],
    });
    expect(judged.judge).toMatchObject({
      judged: 1,
      excellent: 1,
      wouldShip: 1,
      wouldShipRate: 0.5,
      medianLevel: 2.5,
    });
  });

  it('lists every failure by name, never elided', () => {
    const scorecard = buildScorecard({
      ...base,
      runs: [failedRun('b', 'pptx', 'overloaded'), run({ briefId: 'a' })],
    });
    expect(scorecard.failures).toEqual([
      { briefId: 'b', reason: 'overloaded' },
    ]);
    expect(scorecard.runs.map((entry) => entry.briefId)).toEqual(['a', 'b']);
  });
});
