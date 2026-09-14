/**
 * Calibrating the judge against Paolo.
 *
 * A vision model's opinion of a document is worth exactly what its agreement
 * with the person the documents are for is worth. So the judge is not trusted
 * until it has been measured: 40 development-corpus pairs, rated by hand,
 * compared against the judge's own answers on the same pairs.
 *
 * A rating sheet rather than an interactive prompt, because the ratings are
 * made over an afternoon with the documents open, not in one sitting at a
 * terminal — and because a file can be re-read, corrected and kept alongside
 * the scorecard it calibrated.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { bootstrapKappa, type KappaReport } from './statistics.js';
import type { PairwiseVerdict } from './rubric.js';
import type { PairOutcome } from './pairwise.js';

export interface CalibrationPair {
  id: string;
  briefId: string;
  /** Where the two documents' contact sheets were written. */
  a: { label: string; sheetPath: string };
  b: { label: string; sheetPath: string };
}

export interface CalibrationSheet {
  generatedAt: string;
  /** What the rater is being asked, verbatim, so a sheet stands alone. */
  question: string;
  pairs: Array<
    CalibrationPair & {
      /** Filled in by hand: 'a', 'b' or 'tie'. */
      human: '' | 'a' | 'b' | 'tie';
      /** The judge's own answer, recorded when the sheet was made. */
      judge: 'a' | 'b' | 'tie';
      judgeRationale: string;
    }
  >;
}

export const CALIBRATION_QUESTION =
  'For each pair, open both contact sheets and record which document you would rather send to a client — "a", "b", or "tie". Do not read the judge column first.';

/**
 * Which document is `a` is decided by the pair id, not by which is newer.
 *
 * A rater — human or model — shown the new work in the same position every
 * time learns the position. Deriving the order from a hash keeps it stable
 * across re-runs of the same sheet while carrying no information about which
 * side is which.
 */
export function ordersFirst(pairId: string): boolean {
  let hash = 0;
  for (const character of pairId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % 2 === 0;
}

export function buildCalibrationSheet(input: {
  pairs: ReadonlyArray<CalibrationPair & { judge: PairwiseVerdict }>;
  now?: Date;
}): CalibrationSheet {
  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    question: CALIBRATION_QUESTION,
    pairs: input.pairs.map((pair) => ({
      id: pair.id,
      briefId: pair.briefId,
      a: pair.a,
      b: pair.b,
      human: '',
      judge: pair.judge.winner,
      judgeRationale: pair.judge.rationale,
    })),
  };
}

/** One pair as the review page records it: the brief, and which side won. */
export interface ReviewedPair {
  /** The brief (or `<brief>#<pass>`) the two documents answer. */
  pair: string;
  /** A set name, or `tie`. */
  preferred: string;
  leftWas?: string;
  at?: string;
}

/**
 * Paolo's pairs from the review page and the judge's two-order comparisons,
 * as one rated calibration sheet (#409).
 *
 * Both raters are put on the same axis — `a` and `b` are the two recorded
 * sets, never "left" and "right" — so a disagreement is about the documents
 * and not about where they sat. A judge whose two showings disagreed has no
 * preference that survives the swap, so it answers `tie` here, and the
 * rationale says why; a brief the judge never compared is left out and named,
 * never counted as agreement.
 */
export function calibrationSheetFromReview(input: {
  human: readonly ReviewedPair[];
  outcomes: readonly Pick<PairOutcome, 'briefId' | 'verdict'>[];
  sides: { a: string; b: string };
  /** Where a set's sheet for a pair is, by set name. */
  sheetPath: (set: string, pair: string) => string;
  now?: Date;
}): { sheet: CalibrationSheet; judgeSkipped: string[] } {
  // One name for both sides would read every answer as the first side's.
  if (input.sides.a === input.sides.b) {
    throw new Error(
      `The two sides of a calibration need different set names; both are "${input.sides.a}".`
    );
  }
  const judged = new Map(
    input.outcomes.map((outcome) => [outcome.briefId, outcome.verdict])
  );
  const judgeSkipped: string[] = [];
  const pairs: CalibrationSheet['pairs'] = [];
  for (const entry of input.human) {
    const human =
      entry.preferred === input.sides.a
        ? 'a'
        : entry.preferred === input.sides.b
          ? 'b'
          : entry.preferred === 'tie'
            ? 'tie'
            : undefined;
    if (human === undefined) {
      throw new Error(
        `Pair ${entry.pair} prefers "${entry.preferred}", which is neither ${input.sides.a}, ${input.sides.b} nor a tie.`
      );
    }
    const verdict = judged.get(entry.pair);
    if (verdict === undefined) {
      judgeSkipped.push(entry.pair);
      continue;
    }
    pairs.push({
      id: entry.pair,
      briefId: entry.pair.split('#')[0],
      a: {
        label: input.sides.a,
        sheetPath: input.sheetPath(input.sides.a, entry.pair),
      },
      b: {
        label: input.sides.b,
        sheetPath: input.sheetPath(input.sides.b, entry.pair),
      },
      human,
      judge: verdict === 'inconsistent' ? 'tie' : verdict,
      judgeRationale:
        verdict === 'inconsistent'
          ? "The judge's two orders disagreed, so it has no preference that survives the swap."
          : '',
    });
  }
  return {
    sheet: {
      generatedAt: (input.now ?? new Date()).toISOString(),
      question: CALIBRATION_QUESTION,
      pairs,
    },
    judgeSkipped,
  };
}

export async function writeCalibrationSheet(
  file: string,
  sheet: CalibrationSheet
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(sheet, null, 2));
}

export interface CalibrationReport extends KappaReport {
  /** Pairs the rater left blank; excluded from the statistics, never counted as agreement. */
  unrated: number;
  disagreements: Array<{
    pairId: string;
    briefId: string;
    human: string;
    judge: string;
    judgeRationale: string;
  }>;
}

/**
 * Agreement between the hand ratings and the judge's.
 *
 * Unrated pairs are dropped and reported rather than treated as agreement or
 * as disagreement: a sheet half filled in should say so, not average itself
 * towards whichever answer is more convenient.
 */
export function calibrationReport(
  sheet: CalibrationSheet,
  options: { seed?: number; resamples?: number } = {}
): CalibrationReport {
  const rated = sheet.pairs.filter((pair) => pair.human !== '');
  const report = bootstrapKappa(
    rated.map((pair) => ({ a: pair.human as string, b: pair.judge })),
    options
  );
  return {
    ...report,
    unrated: sheet.pairs.length - rated.length,
    disagreements: rated
      .filter((pair) => pair.human !== pair.judge)
      .map((pair) => ({
        pairId: pair.id,
        briefId: pair.briefId,
        human: pair.human,
        judge: pair.judge,
        judgeRationale: pair.judgeRationale,
      })),
  };
}

/**
 * Whether the judge may be believed.
 *
 * The programme's own threshold: below 0.8 ship/no-ship agreement, the human
 * answer is authoritative and the judge's contribution to a scorecard is
 * reported but not relied on.
 */
export const CALIBRATION_THRESHOLD = 0.8;

export function judgeIsCalibrated(report: CalibrationReport): boolean {
  return report.n > 0 && report.rawAgreement >= CALIBRATION_THRESHOLD;
}
