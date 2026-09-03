/**
 * Agreement statistics.
 *
 * Two raters agreeing 90% of the time on a corpus where 90% of documents are
 * unshippable have agreed about nothing. Kappa says so, and a bootstrap
 * interval says how much of the kappa is the sample. Both are reported with
 * every calibration, because a judge calibrated on 40 comparisons has a real
 * and quantifiable amount of uncertainty in it, and hiding that would make the
 * scorecard read more precise than it is.
 */

export interface Rating<T extends string | number | boolean> {
  a: T;
  b: T;
}

export interface KappaReport {
  n: number;
  rawAgreement: number;
  kappa: number;
  /** Percentile bootstrap interval; absent when the sample cannot support one. */
  interval?: {
    low: number;
    high: number;
    confidence: number;
    resamples: number;
  };
}

/** Cohen's kappa over paired categorical ratings. NaN when chance is total. */
export function cohensKappa<T extends string | number | boolean>(
  ratings: readonly Rating<T>[]
): number {
  const n = ratings.length;
  if (n === 0) return Number.NaN;

  const categories = new Set<T>();
  for (const rating of ratings) {
    categories.add(rating.a);
    categories.add(rating.b);
  }

  let observed = 0;
  for (const rating of ratings) if (rating.a === rating.b) observed += 1;
  observed /= n;

  let expected = 0;
  for (const category of categories) {
    const aShare = ratings.filter((rating) => rating.a === category).length / n;
    const bShare = ratings.filter((rating) => rating.b === category).length / n;
    expected += aShare * bShare;
  }

  if (expected === 1) return Number.NaN;
  return (observed - expected) / (1 - expected);
}

export function rawAgreement<T extends string | number | boolean>(
  ratings: readonly Rating<T>[]
): number {
  if (ratings.length === 0) return 0;
  return (
    ratings.filter((rating) => rating.a === rating.b).length / ratings.length
  );
}

/**
 * A deterministic PRNG, so a reported interval can be reproduced.
 *
 * A bootstrap seeded from the clock gives a slightly different interval every
 * time it is run, which invites exactly the argument ("run it again") that a
 * confidence interval exists to end.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapKappa<T extends string | number | boolean>(
  ratings: readonly Rating<T>[],
  options: { resamples?: number; confidence?: number; seed?: number } = {}
): KappaReport {
  const resamples = options.resamples ?? 2000;
  const confidence = options.confidence ?? 0.95;
  const base: KappaReport = {
    n: ratings.length,
    rawAgreement: rawAgreement(ratings),
    kappa: cohensKappa(ratings),
  };
  if (ratings.length < 2) return base;

  const random = mulberry32(options.seed ?? 20260903);
  const values: number[] = [];
  for (let index = 0; index < resamples; index += 1) {
    const sample: Rating<T>[] = [];
    for (let pick = 0; pick < ratings.length; pick += 1) {
      sample.push(ratings[Math.floor(random() * ratings.length)]);
    }
    const kappa = cohensKappa(sample);
    // A resample where one rater never varies has an undefined kappa; it is
    // dropped rather than counted as zero, which would drag the interval.
    if (Number.isFinite(kappa)) values.push(kappa);
  }
  if (values.length === 0) return base;

  values.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  const at = (quantile: number): number =>
    values[
      Math.min(
        values.length - 1,
        Math.max(0, Math.round(quantile * (values.length - 1)))
      )
    ];

  return {
    ...base,
    interval: {
      low: at(tail),
      high: at(1 - tail),
      confidence,
      resamples: values.length,
    },
  };
}
