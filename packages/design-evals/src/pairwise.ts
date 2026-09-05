/**
 * Two recorded sets, compared document by document.
 *
 * Absolute verdicts drift, and the drift has a direction: the same 39 documents
 * scored 8 shippable one day and 12 the next, every change in the same
 * direction. The cold-to-assisted difference the spec reports is one document.
 * An effect a quarter the size of the instrument's zero-shift is not an effect,
 * and no amount of re-judging each side separately fixes that — it only makes
 * the two zeroes recent instead of distant.
 *
 * A pairwise call does not have a zero. It shows the judge both answers to the
 * same brief and asks which is better, so anything that moves both documents
 * together — a lenient session, a fuller context, a different mood in the
 * rubric — moves neither side of the comparison.
 *
 * Every pair is judged TWICE, once in each order, and only a brief whose two
 * verdicts agree counts. That is not caution, it is the first run's result: the
 * judge picked whichever document it saw second in 68% of comparisons, and a
 * per-brief hash that was meant to balance the orders happened to put one side
 * second 23 times out of 38. The headline that came out — 25 against 13 for the
 * assisted set — was mostly seating. Within the orientation that disfavoured
 * it, the same set won 7 of 15.
 *
 * Both sets already have contact sheets on disk, so this costs two calls per
 * brief and no authoring at all.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Brief } from './corpus.js';
import { developmentCorpusDir, loadCorpus, selectBriefs } from './corpus.js';
import { agentVision, anthropicVision, judgePair } from './judge.js';
import { comparableRuns, type RecordedRun } from './rejudge.js';

/** One showing of a pair, in one order. */
export interface PairJudgement {
  /** True when B was shown first, so a re-read can check the un-flipping. */
  bShownFirst: boolean;
  /** `a`, `b` or `tie` — already translated back out of the shown order. */
  winner: 'a' | 'b' | 'tie';
  margin: string;
  rationale: string;
}

export interface PairOutcome {
  briefId: string;
  /** Both orders, when both were judged. */
  judgements: PairJudgement[];
  /**
   * What the two showings agree on. `inconsistent` when they disagree, which
   * is a document the judge cannot rank rather than a document that lost.
   */
  verdict: 'a' | 'b' | 'tie' | 'inconsistent';
}

/**
 * The verdict two showings of one pair agree on.
 *
 * A pair judged once has no verdict worth reporting: with a 68% pull towards
 * whatever came second, a single showing is mostly a seating chart.
 */
export function agreedVerdict(
  judgements: readonly PairJudgement[]
): PairOutcome['verdict'] {
  if (
    judgements.length !== 2 ||
    judgements[0].bShownFirst === judgements[1].bShownFirst
  ) {
    return 'inconsistent';
  }
  const [first, ...rest] = judgements;
  return rest.every((judgement) => judgement.winner === first.winner)
    ? first.winner
    : 'inconsistent';
}

export interface PairwiseReport {
  a: string;
  b: string;
  judgeModel: string;
  judgedAt: string;
  outcomes: PairOutcome[];
  skipped: { briefId: string; why: string }[];
  tally: Tally;
}

export interface Tally {
  a: number;
  b: number;
  tie: number;
  /** Briefs whose two showings disagreed: counted, never averaged away. */
  inconsistent: number;
  /** Decided comparisons only — ties and disagreements carry no direction. */
  decided: number;
  /**
   * Share of decided single showings won by the document shown SECOND.
   *
   * The instrument's own thumb on the scale. At 0.5 order does not matter; the
   * first measured value was 0.68, which is larger than any effect this corpus
   * has produced.
   */
  secondShownWinRate: number;
  /**
   * Two-sided sign test over the decided comparisons. The question "did B beat
   * A" is a coin unless this is small, and 9-against-4 looks convincing and is
   * not.
   */
  pValue: number;
}

/**
 * Which set is shown first for a given brief.
 *
 * Deterministic, so a re-run of the same comparison shows the same order and
 * two reports can be diffed; varied per brief, because a judge shown the new
 * work second every time has been told where to find it.
 */
export function bShownFirst(briefId: string, seed: number): boolean {
  let hash = seed >>> 0;
  for (let index = 0; index < briefId.length; index += 1) {
    hash = (Math.imul(hash ^ briefId.charCodeAt(index), 16777619) >>> 0) >>> 0;
  }
  return (hash & 1) === 1;
}

/** Exact two-sided sign test: P(|X - n/2| >= |k - n/2|) for a fair coin. */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const logFactorial: number[] = [0];
  for (let index = 1; index <= n; index += 1) {
    logFactorial[index] = logFactorial[index - 1] + Math.log(index);
  }
  const probability = (k: number): number =>
    Math.exp(
      logFactorial[n] - logFactorial[k] - logFactorial[n - k] - n * Math.LN2
    );
  const observed = Math.abs(wins - n / 2);
  let total = 0;
  for (let k = 0; k <= n; k += 1) {
    if (Math.abs(k - n / 2) >= observed - 1e-9) total += probability(k);
  }
  return Math.min(1, total);
}

export function tally(outcomes: readonly PairOutcome[]): Tally {
  const count = (verdict: PairOutcome['verdict']): number =>
    outcomes.filter((outcome) => outcome.verdict === verdict).length;
  const a = count('a');
  const b = count('b');

  const showings = outcomes
    .flatMap((outcome) => outcome.judgements)
    .filter((judgement) => judgement.winner !== 'tie');
  const second = showings.filter(
    (judgement) => (judgement.winner === 'b') === !judgement.bShownFirst
  ).length;

  return {
    a,
    b,
    tie: count('tie'),
    inconsistent: count('inconsistent'),
    decided: a + b,
    secondShownWinRate: showings.length === 0 ? 0.5 : second / showings.length,
    pValue: signTest(b, a),
  };
}

async function briefIds(scorecardPath: string): Promise<string[]> {
  const recorded = JSON.parse(await fs.readFile(scorecardPath, 'utf8')) as {
    runs: RecordedRun[];
  };
  return comparableRuns(recorded.runs).map((run) => run.briefId);
}

export interface PairwiseOptions {
  /** Run directories, each holding `scorecard.json` and `runs/<id>/`. */
  aDir: string;
  bDir: string;
  judgeModel: string;
  useApiKey: boolean;
  seed?: number;
  /**
   * Judge each pair once, in a seeded order, instead of twice.
   *
   * Halves the cost and reintroduces the position bias the two-order design
   * exists to cancel. Only for a smoke run, never for a result.
   */
  singleOrder?: boolean;
  briefs?: string;
  corpusDir?: string;
  onProgress?: (message: string) => void;
}

export async function comparePairs(
  options: PairwiseOptions
): Promise<PairwiseReport> {
  const seed = options.seed ?? 20260905;
  const inA = new Set(
    await briefIds(path.join(options.aDir, 'scorecard.json'))
  );
  const inB = new Set(
    await briefIds(path.join(options.bDir, 'scorecard.json'))
  );

  const corpus = await loadCorpus(options.corpusDir ?? developmentCorpusDir());
  const briefs: Brief[] = selectBriefs(corpus, options.briefs);
  const call = options.useApiKey
    ? anthropicVision({ model: options.judgeModel })
    : agentVision({ model: options.judgeModel });

  const outcomes: PairOutcome[] = [];
  const skipped: { briefId: string; why: string }[] = [];

  for (const brief of briefs) {
    if (!inA.has(brief.id) || !inB.has(brief.id)) {
      // A brief only one side could compare is not a comparison. Recorded,
      // because 39 pairs and 31 pairs are different claims.
      skipped.push({
        briefId: brief.id,
        why: inA.has(brief.id) ? 'absent from B' : 'absent from A',
      });
      continue;
    }
    let aPng: Buffer;
    let bPng: Buffer;
    try {
      aPng = await fs.readFile(
        path.join(options.aDir, 'runs', brief.id, 'contact-sheet.png')
      );
      bPng = await fs.readFile(
        path.join(options.bDir, 'runs', brief.id, 'contact-sheet.png')
      );
    } catch {
      skipped.push({ briefId: brief.id, why: 'no contact sheet on one side' });
      continue;
    }

    // Both orders, always. One showing measures the seating as much as the
    // documents; the pair of them measures only what survives the swap.
    const orders = options.singleOrder
      ? [bShownFirst(brief.id, seed)]
      : [false, true];
    options.onProgress?.(`${outcomes.length + 1} ${brief.id}`);

    const judgements: PairJudgement[] = [];
    let failed: string | undefined;
    for (const flipped of orders) {
      try {
        const judged = await judgePair({
          brief,
          a: { png: flipped ? bPng : aPng, label: flipped ? 'B' : 'A' },
          b: { png: flipped ? aPng : bPng, label: flipped ? 'A' : 'B' },
          call,
        });
        // The judge answered about the order it was shown; translate back.
        const shown = judged.verdict.winner;
        judgements.push({
          bShownFirst: flipped,
          winner:
            shown === 'tie'
              ? 'tie'
              : flipped
                ? shown === 'a'
                  ? 'b'
                  : 'a'
                : shown,
          margin: judged.verdict.margin,
          rationale: judged.verdict.rationale,
        });
      } catch (error) {
        failed = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    if (failed !== undefined || judgements.length < orders.length) {
      // Half a pair is not a pair: one surviving showing is exactly the
      // single-order measurement this exists to replace.
      skipped.push({
        briefId: brief.id,
        why: failed ?? 'one of the two orders was not judged',
      });
      continue;
    }
    outcomes.push({
      briefId: brief.id,
      judgements,
      verdict: agreedVerdict(judgements),
    });
  }

  return {
    a: options.aDir,
    b: options.bDir,
    judgeModel: options.judgeModel,
    judgedAt: new Date().toISOString(),
    outcomes,
    skipped,
    tally: tally(outcomes),
  };
}
