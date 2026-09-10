/**
 * The critique state machine, which exists to make one number trustworthy.
 *
 * The three-round limit on subjective revision is only meaningful if the
 * rounds are the ones an agent actually judged. Rendering the same revision
 * twice because a transport dropped the answer is not a round; neither is
 * inspecting, thinking better of it, and inspecting again. So a round is
 * created by nothing except `record`, against a run id `inspect` handed out,
 * and recording the same run id twice is the same round — a retry, not a
 * second opinion.
 *
 * A verdict belongs to the revision it was formed against. If the workspace
 * moved between the looking and the recording, the record is refused rather
 * than filed against a document the agent never saw.
 *
 * State is per connection, like the workspaces it keys on, and bounded: a run
 * an agent never records is dead weight, and the oldest are dropped first.
 */

import { randomUUID } from 'node:crypto';

import type { FormatName } from './adapters.js';

/** Recorded rounds after which the log recommends stopping. */
export const MAX_CRITIQUE_ROUNDS = 3;

/** Runs kept per connection before the oldest are dropped. */
const MAX_RUNS = 64;

/**
 * Records kept per connection.
 *
 * Far higher than the runs cap, and pruned separately, because a record is
 * the round: dropping one with the run that produced it would hand a
 * workspace back rounds it had already spent. A connection holds sixteen
 * workspaces and three rounds each, so this cannot be reached by a loop that
 * is actually critiquing.
 */
const MAX_RECORDS = 512;

export type CritiqueVerdict = 'ship' | 'iterate';

/** One `inspect`: what was looked at, and when. */
export interface CritiqueRun {
  id: string;
  handle: string;
  format: FormatName;
  /** The workspace revision the evidence was rendered from. */
  revision: number;
  createdAt: string;
}

/** One `record`: a verdict about the revision a run inspected. */
export interface CritiqueRecord {
  runId: string;
  handle: string;
  revision: number;
  verdict: CritiqueVerdict;
  rationale: string;
  /** The rubric level the host judged, when it said one. */
  level?: number;
  recordedAt: string;
}

export interface CritiqueLog {
  /** Start a run against a revision, and return its id. */
  open(input: Omit<CritiqueRun, 'id' | 'createdAt'>): CritiqueRun;
  run(id: string): CritiqueRun | undefined;
  /** The record filed against a run, when one was. */
  recordFor(runId: string): CritiqueRecord | undefined;
  /**
   * File a verdict. Recording a run that already has one returns the record
   * it already has, unchanged: a retry is not a round.
   */
  record(input: Omit<CritiqueRecord, 'recordedAt'>): {
    record: CritiqueRecord;
    duplicate: boolean;
  };
  /** Recorded `iterate` verdicts against a workspace, in order. */
  rounds(handle: string): CritiqueRecord[];
  /** Every record filed against a workspace, in the order they were filed. */
  history(handle: string): CritiqueRecord[];
  /** Drop everything about a workspace, when the handle is released. */
  forget(handle: string): void;
}

export function createCritiqueLog(): CritiqueLog {
  const runs = new Map<string, CritiqueRun>();
  const records = new Map<string, CritiqueRecord>();

  // A plain function, not a method reaching for `this`: a caller that pulls
  // `rounds` off the log would otherwise get one that throws.
  const history = (handle: string): CritiqueRecord[] =>
    [...records.values()].filter((record) => record.handle === handle);

  /** Drop the oldest of a map, keeping insertion order as the age. */
  const trim = (map: Map<string, unknown>, cap: number): void => {
    while (map.size > cap) {
      const oldest = map.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  };
  // An unrecorded run is dead weight; a record is a round that was spent, and
  // outlives the run it was formed against.
  const prune = (): void => {
    trim(runs, MAX_RUNS);
    trim(records, MAX_RECORDS);
  };

  return {
    open(input) {
      const run: CritiqueRun = {
        ...input,
        id: `crit_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        createdAt: new Date().toISOString(),
      };
      runs.set(run.id, run);
      prune();
      return run;
    },
    run: (id) => runs.get(id),
    recordFor: (runId) => records.get(runId),
    record(input) {
      const existing = records.get(input.runId);
      if (existing) return { record: existing, duplicate: true };
      const record: CritiqueRecord = {
        ...input,
        recordedAt: new Date().toISOString(),
      };
      records.set(record.runId, record);
      return { record, duplicate: false };
    },
    history,
    rounds: (handle) =>
      history(handle).filter((record) => record.verdict === 'iterate'),
    forget(handle) {
      for (const [id, run] of runs) if (run.handle === handle) runs.delete(id);
      // Records outlive their runs, so they have to be released on their own
      // name rather than through the run that produced them.
      for (const [id, record] of records)
        if (record.handle === handle) records.delete(id);
    },
  };
}
