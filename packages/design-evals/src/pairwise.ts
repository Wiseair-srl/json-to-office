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
 * Both sets already have contact sheets on disk, so this costs one call per
 * brief and no authoring at all.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Brief } from './corpus.js';
import { developmentCorpusDir, loadCorpus, selectBriefs } from './corpus.js';
import { agentVision, anthropicVision, judgePair } from './judge.js';
import { comparableRuns, type RecordedRun } from './rejudge.js';

export interface PairOutcome {
  briefId: string;
  /** `a`, `b` or `tie` — already translated back out of the shown order. */
  winner: 'a' | 'b' | 'tie';
  margin: string;
  /** True when B was shown first, so a re-read can check the un-flipping. */
  bShownFirst: boolean;
  rationale: string;
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
  /** Decided comparisons only — ties carry no direction. */
  decided: number;
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
  const a = outcomes.filter((outcome) => outcome.winner === 'a').length;
  const b = outcomes.filter((outcome) => outcome.winner === 'b').length;
  const tie = outcomes.filter((outcome) => outcome.winner === 'tie').length;
  return { a, b, tie, decided: a + b, pValue: signTest(b, a) };
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

    const flipped = bShownFirst(brief.id, seed);
    options.onProgress?.(`${outcomes.length + 1} ${brief.id}`);
    try {
      const judged = await judgePair({
        brief,
        a: { png: flipped ? bPng : aPng, label: flipped ? 'B' : 'A' },
        b: { png: flipped ? aPng : bPng, label: flipped ? 'A' : 'B' },
        call,
      });
      // The judge answered about the order it was shown; translate back.
      const shown = judged.verdict.winner;
      const winner =
        shown === 'tie' ? 'tie' : flipped ? (shown === 'a' ? 'b' : 'a') : shown;
      outcomes.push({
        briefId: brief.id,
        winner,
        margin: judged.verdict.margin,
        bShownFirst: flipped,
        rationale: judged.verdict.rationale,
      });
    } catch (error) {
      skipped.push({
        briefId: brief.id,
        why: error instanceof Error ? error.message : String(error),
      });
    }
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
