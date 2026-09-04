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
import { buildsClean } from './metrics.js';
import type { RunManifest } from './manifest.js';
import type { Stratification } from './corpus.js';

export interface ScorecardTotals {
  /** Every brief attempted. The denominator for every rate below. */
  runs: number;
  completed: number;
  failed: number;
  /**
   * Built, nothing blocking, no placeholder text left. A floor with a
   * mechanical answer — NOT the programme's shipping metric, which is the
   * judge's and lives on `judge.wouldShipRate`.
   */
  buildsClean: number;
  buildsCleanRate: number;
  withAnyIntegrityDefect: number;
  integrityDefectRate: number;
  withPlaceholderLeak: number;
  medianIterations: number;
  medianTurns: number;
  medianPages: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalUsd?: number;
  totalWallMs: number;
}

/**
 * The judge's side of the scorecard.
 *
 * Kept in its own object rather than folded into `totals` so that a reader can
 * see at a glance which numbers are countable and which are an opinion —
 * and so that a scorecard produced without a judge is obviously missing that
 * half rather than silently reporting zeros for it.
 */
export interface JudgeTotals {
  /** Runs the judge actually saw. Failed runs are judged as unshippable. */
  judged: number;
  medianLevel: number;
  excellent: number;
  excellentRate: number;
  wouldShip: number;
  wouldShipRate: number;
  medianGenericness: number;
}

export function judgeTotals(runs: readonly RunMetrics[]): JudgeTotals {
  // A failed run is not unjudged, it is unshippable: leaving it out would let
  // a phase improve its rate by producing fewer documents. A run that
  // *completed* and has no verdict is a different thing — the judge itself
  // failed — and scoring that as a level 1 would report an outage as a
  // quality regression, so it is left out of the level median and visible in
  // `judged` being smaller than the run count.
  const levels = runs.flatMap((run) => {
    if (run.judge) return [run.judge.level as number];
    return run.outcome === 'failed' ? [1] : [];
  });
  const shipped = runs.filter((run) => run.judge?.wouldShip === true).length;
  const excellent = runs.filter((run) => (run.judge?.level ?? 1) >= 4).length;
  return {
    judged: runs.filter((run) => run.judge !== undefined).length,
    medianLevel: median(levels),
    excellent,
    excellentRate: runs.length === 0 ? 0 : excellent / runs.length,
    wouldShip: shipped,
    wouldShipRate: runs.length === 0 ? 0 : shipped / runs.length,
    medianGenericness: median(
      runs.flatMap((run) => (run.judge ? [run.judge.genericness] : []))
    ),
  };
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
  /** Present only when the runs were judged. */
  judge?: JudgeTotals;
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
  const clean = runs.filter(buildsClean);
  const defective = runs.filter(hasIntegrityDefect);
  const usd = runs
    .map((run) => run.cost.usd)
    .filter((value): value is number => typeof value === 'number');

  return {
    runs: runs.length,
    completed: completed.length,
    failed: runs.length - completed.length,
    buildsClean: clean.length,
    buildsCleanRate: runs.length === 0 ? 0 : clean.length / runs.length,
    withAnyIntegrityDefect: defective.length,
    integrityDefectRate: runs.length === 0 ? 0 : defective.length / runs.length,
    withPlaceholderLeak: runs.filter((run) => run.placeholderLeaks > 0).length,
    // Over completed runs: the median number of edits a run that produced
    // nothing took is not a number about iteration.
    medianIterations: median(completed.map((run) => run.iterations)),
    medianTurns: median(completed.map((run) => run.turns)),
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
    ...(input.runs.some((run) => run.judge !== undefined) && {
      judge: judgeTotals(input.runs),
    }),
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
