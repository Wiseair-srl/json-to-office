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
