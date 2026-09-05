/**
 * The judge, measured against itself.
 *
 * Every number this programme reports about taste comes from one absolute
 * verdict per document, and an absolute verdict is only worth as much as its
 * repeatability. A spot check of four stored contact sheets, re-judged a day
 * later with the same rubric and the same model, changed three of the four
 * `wouldShip` answers — one of them on a document the judge simultaneously
 * scored level 4 and genericness 1, its two best marks. If that rate holds, the
 * cold-versus-assisted comparison the spec leads with is measuring the judge.
 *
 * So this re-judges a recorded set WITHOUT re-authoring it. The documents are
 * fixed, the rubric is fixed, and the only thing that varies is the judge; any
 * disagreement it finds is the instrument's own noise. It reads the contact
 * sheets already on disk rather than rendering again, so a full corpus costs
 * one judge call per document and nothing else.
 *
 * Kappa rather than agreement: on a corpus where four in five documents are
 * unshippable, a judge that says "no" to everything agrees with itself 80% of
 * the time and has said nothing.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Brief } from './corpus.js';
import { developmentCorpusDir, loadCorpus, selectBriefs } from './corpus.js';
import { agentVision, anthropicVision, judgeDocument } from './judge.js';
import type { KappaReport } from './statistics.js';
import { bootstrapKappa, type Rating } from './statistics.js';

/** One document, judged twice. */
export interface RejudgedRun {
  briefId: string;
  then: { wouldShip?: boolean; level?: number; genericness?: number };
  now?: { wouldShip: boolean; level: number; genericness: number };
  /** Why this document could not be re-judged, when it could not be. */
  error?: string;
}

export interface RejudgeReport {
  /** The set that was re-judged. */
  source: string;
  judgeModel: string;
  judgedAt: string;
  runs: RejudgedRun[];
  /** Self-agreement, per rubric field. Absent when nothing could be compared. */
  agreement?: {
    wouldShip: KappaReport;
    level: KappaReport;
    genericness: KappaReport;
    /** Documents whose level moved by more than one step. */
    levelMovedMoreThanOne: number;
  };
}

interface RecordedRun {
  briefId: string;
  judge?: { wouldShip?: boolean; level?: number; genericness?: number };
}

/** Pairs where BOTH judgements exist; anything else cannot be an agreement. */
export function pairs<T extends string | number | boolean>(
  runs: readonly RejudgedRun[],
  read: (verdict: {
    wouldShip?: boolean;
    level?: number;
    genericness?: number;
  }) => T | undefined
): Rating<T>[] {
  const found: Rating<T>[] = [];
  for (const run of runs) {
    if (!run.now) continue;
    const a = read(run.then);
    const b = read(run.now);
    if (a === undefined || b === undefined) continue;
    found.push({ a, b });
  }
  return found;
}

export function summarise(
  runs: readonly RejudgedRun[]
): RejudgeReport['agreement'] {
  const ship = pairs<boolean>(runs, (v) => v.wouldShip);
  if (ship.length === 0) return undefined;
  const levels = pairs<number>(runs, (v) => v.level);
  return {
    wouldShip: bootstrapKappa(ship),
    level: bootstrapKappa(levels),
    genericness: bootstrapKappa(pairs<number>(runs, (v) => v.genericness)),
    levelMovedMoreThanOne: levels.filter(
      (rating) => Math.abs(rating.a - rating.b) > 1
    ).length,
  };
}

export interface RejudgeOptions {
  /** Directory holding `runs/<briefId>/contact-sheet.png`. */
  runsDir: string;
  /** Scorecard or committed baseline carrying the recorded verdicts. */
  scorecardPath: string;
  judgeModel: string;
  useApiKey: boolean;
  briefs?: string;
  corpusDir?: string;
  onProgress?: (message: string) => void;
}

export async function rejudge(options: RejudgeOptions): Promise<RejudgeReport> {
  const recorded = JSON.parse(
    await fs.readFile(options.scorecardPath, 'utf8')
  ) as { runs: RecordedRun[] };

  const corpus = await loadCorpus(options.corpusDir ?? developmentCorpusDir());
  const wanted = selectBriefs(corpus, options.briefs);
  const byId = new Map<string, Brief>(
    wanted.map((brief) => [brief.id, brief] as const)
  );

  const call = options.useApiKey
    ? anthropicVision({ model: options.judgeModel })
    : agentVision({ model: options.judgeModel });

  // A set may hold repeats of the same brief; the first recorded verdict for
  // each is the one a committed baseline reports, so it is the one to match.
  const seen = new Set<string>();
  const runs: RejudgedRun[] = [];
  for (const record of recorded.runs) {
    const brief = byId.get(record.briefId);
    if (!brief || seen.has(record.briefId)) continue;
    seen.add(record.briefId);

    const then = record.judge ?? {};
    const sheetPath = path.join(
      options.runsDir,
      record.briefId,
      'contact-sheet.png'
    );
    let png: Buffer;
    try {
      png = await fs.readFile(sheetPath);
    } catch {
      // A run that failed never produced a sheet. Recorded, not silently
      // dropped: a re-judge over 34 of 40 documents is a different number
      // from one over 40.
      runs.push({ briefId: record.briefId, then, error: 'no contact sheet' });
      continue;
    }

    options.onProgress?.(`${runs.length + 1} ${record.briefId}`);
    try {
      const judged = await judgeDocument({
        brief,
        sheet: { png, label: record.briefId },
        call,
      });
      runs.push({
        briefId: record.briefId,
        then,
        now: {
          wouldShip: judged.verdict.wouldShip,
          level: judged.verdict.level,
          genericness: judged.verdict.genericness,
        },
      });
    } catch (error) {
      runs.push({
        briefId: record.briefId,
        then,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const agreement = summarise(runs);
  return {
    source: options.scorecardPath,
    judgeModel: options.judgeModel,
    judgedAt: new Date().toISOString(),
    runs,
    ...(agreement && { agreement }),
  };
}
