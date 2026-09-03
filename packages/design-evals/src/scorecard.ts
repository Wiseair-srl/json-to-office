/**
 * The scorecard: one run set, summarised.
 *
 * Two rules hold the numbers honest. Every rate is over *every* run attempted,
 * failures included — a denominator that shrinks when the agent gives up is a
 * denominator that improves on its own. And every aggregate carries its own
 * count, so a rate read out of context still says how many documents it is
 * made of.
 */

import type { RunMetrics } from './metrics.js';
import { isShippable } from './metrics.js';
import type { RunManifest } from './manifest.js';
import type { Stratification } from './corpus.js';

export interface ScorecardTotals {
  /** Every brief attempted. The denominator for every rate below. */
  runs: number;
  completed: number;
  failed: number;
  shippable: number;
  shippableRate: number;
  withAnyIntegrityDefect: number;
  integrityDefectRate: number;
  withPlaceholderLeak: number;
  medianIterations: number;
  medianPages: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalUsd?: number;
  totalWallMs: number;
}

export interface Scorecard {
  /** ISO 8601, when the run set finished. */
  generatedAt: string;
  corpus: {
    kind: 'development' | 'sealed';
    hash: string;
    stratification: Stratification;
    /** Ids, present only for a corpus that may be disclosed. */
    briefIds?: string[];
  };
  manifest: RunManifest;
  totals: ScorecardTotals;
  /** Every `W_QUALITY_*` code seen, summed over runs. */
  qualityByCode: Record<string, number>;
  byFormat: Record<string, ScorecardTotals>;
  byArchetype: Record<string, ScorecardTotals>;
  runs: RunMetrics[];
  /** One line per failed brief, never elided. */
  failures: Array<{ briefId: string; reason: string }>;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** An integrity defect is anything that would be visible in the rendered file. */
const INTEGRITY_CODES = new Set([
  'W_QUALITY_TEXT_OVERFLOW',
  'W_QUALITY_BOX_OVERLAP',
  'W_QUALITY_FRAME_COLLISION',
  'W_QUALITY_SVG_TEXT_CLIPPED',
  'W_QUALITY_LINE_BOX_COLLAPSE',
  'W_QUALITY_TABLE_WIDTH_OVERFLOW',
  'W_QUALITY_PLACEHOLDER_TEXT',
  'W_QUALITY_SCAFFOLD_MARKER',
]);

function hasIntegrityDefect(run: RunMetrics): boolean {
  // A failed run is not defect-free; it is a run whose defects were never
  // measured, and the target counts it as not shippable either way.
  if (run.outcome === 'failed') return true;
  return Object.keys(run.qualityByCode).some((code) =>
    INTEGRITY_CODES.has(code)
  );
}

export function totals(runs: readonly RunMetrics[]): ScorecardTotals {
  const completed = runs.filter((run) => run.outcome === 'completed');
  const shippable = runs.filter(isShippable);
  const defective = runs.filter(hasIntegrityDefect);
  const usd = runs
    .map((run) => run.cost.usd)
    .filter((value): value is number => typeof value === 'number');

  return {
    runs: runs.length,
    completed: completed.length,
    failed: runs.length - completed.length,
    shippable: shippable.length,
    shippableRate: runs.length === 0 ? 0 : shippable.length / runs.length,
    withAnyIntegrityDefect: defective.length,
    integrityDefectRate: runs.length === 0 ? 0 : defective.length / runs.length,
    withPlaceholderLeak: runs.filter((run) => run.placeholderLeaks > 0).length,
    // Over completed runs: the median number of edits a run that produced
    // nothing took is not a number about iteration.
    medianIterations: median(completed.map((run) => run.iterations)),
    medianPages: median(completed.map((run) => run.pages)),
    totalToolCalls: runs.reduce((sum, run) => sum + run.toolCalls, 0),
    totalInputTokens: runs.reduce((sum, run) => sum + run.cost.inputTokens, 0),
    totalOutputTokens: runs.reduce(
      (sum, run) => sum + run.cost.outputTokens,
      0
    ),
    ...(usd.length > 0 && {
      totalUsd:
        Math.round(usd.reduce((sum, value) => sum + value, 0) * 1e6) / 1e6,
    }),
    totalWallMs: runs.reduce((sum, run) => sum + run.wallMs, 0),
  };
}

function group(
  runs: readonly RunMetrics[],
  key: (run: RunMetrics) => string
): Record<string, ScorecardTotals> {
  const buckets = new Map<string, RunMetrics[]>();
  for (const run of runs) {
    const name = key(run);
    const bucket = buckets.get(name);
    if (bucket) bucket.push(run);
    else buckets.set(name, [run]);
  }
  return Object.fromEntries(
    [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, bucket]) => [name, totals(bucket)])
  );
}

export function buildScorecard(input: {
  runs: readonly RunMetrics[];
  manifest: RunManifest;
  corpus: {
    kind: 'development' | 'sealed';
    hash: string;
    stratification: Stratification;
    briefIds?: string[];
  };
  /** Archetype per brief id, so the scorecard can group by it. */
  archetypes: Readonly<Record<string, string>>;
  now?: Date;
}): Scorecard {
  const qualityByCode: Record<string, number> = {};
  for (const run of input.runs) {
    for (const [code, count] of Object.entries(run.qualityByCode)) {
      qualityByCode[code] = (qualityByCode[code] ?? 0) + count;
    }
  }

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    corpus: input.corpus,
    manifest: input.manifest,
    totals: totals(input.runs),
    qualityByCode: Object.fromEntries(Object.entries(qualityByCode).sort()),
    byFormat: group(input.runs, (run) => run.format),
    byArchetype: group(
      input.runs,
      (run) => input.archetypes[run.briefId] ?? 'unknown'
    ),
    runs: [...input.runs].sort((a, b) => a.briefId.localeCompare(b.briefId)),
    failures: input.runs
      .filter((run) => run.outcome === 'failed')
      .map((run) => ({
        briefId: run.briefId,
        reason: run.failure ?? 'unknown',
      }))
      .sort((a, b) => a.briefId.localeCompare(b.briefId)),
  };
}
