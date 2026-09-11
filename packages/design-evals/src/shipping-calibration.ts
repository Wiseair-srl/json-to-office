/**
 * Calibrating the shipping definition against Paolo, then checking it (#409).
 *
 * Three rules keep the result from being the thing it measures.
 *
 * **One label per artifact.** The recorded human rounds judged some sheets
 * twice — the 24 checkpoint "before" documents were shown in both rounds, and
 * ten ships became two, all in one direction, beside a visibly better set. An
 * artifact whose judgments agree carries that answer; one whose judgments
 * conflict is `unstable`, left out of the agreement and counted, because no
 * definition can be scored against a person who answered both ways. The
 * reviewer's disagreement across rounds is reported on its own, as the
 * human floor.
 *
 * **Allocation by brief.** Calibration artifacts and verification artifacts
 * share no brief, so no document — and no question — reaches both sets
 * through a repeated judgment. Uncertainty is resampled by brief for the same
 * reason: three passes of one brief are one question asked three times.
 *
 * **Freeze, then verify.** The definition chosen on calibration evidence is
 * frozen with a hash of its terms and its question's wording, and
 * verification refuses a definition whose hash no longer matches. The target
 * — Cohen's kappa of at least 0.5 on the verification set — is the ticket's,
 * and a miss is reported as a miss.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  clusterBootstrapKappa,
  cohensKappa,
  rawAgreement,
  type ClusteredKappaReport,
} from './statistics.js';
import {
  definitionHash,
  PAGE_DEFECT_CODES,
  ships,
  SHIPPING_QUESTIONS,
  STATUS_QUO_DEFINITION,
  type JudgeAnswer,
  type ShippingDefinition,
  type ShippingQuestionId,
} from './shipping.js';
import type { RunOutcome } from './metrics.js';

/** One absolute verdict by the reviewer, on one artifact, in one round. */
export interface HumanJudgment {
  /** `<set>/<run>`: the document, not the brief. */
  artifact: string;
  set: string;
  /** The run label: `<brief>` or `<brief>#<pass>`. */
  run: string;
  briefId: string;
  round: string;
  ship: boolean;
  at?: string;
}

/** A recorded review round, as `baselines/*-human-*-verdicts*.json` holds it. */
export interface HumanRound {
  id: string;
  file: {
    verdicts: ReadonlyArray<{
      set: string;
      run: string;
      wouldShip: boolean;
      at?: string;
    }>;
  };
}

export function briefOf(run: string): string {
  return run.split('#')[0];
}

export function humanJudgments(rounds: readonly HumanRound[]): HumanJudgment[] {
  return rounds.flatMap((round) =>
    round.file.verdicts.map((verdict) => ({
      artifact: `${verdict.set}/${verdict.run}`,
      set: verdict.set,
      run: verdict.run,
      briefId: briefOf(verdict.run),
      round: round.id,
      ship: verdict.wouldShip,
      ...(verdict.at !== undefined && { at: verdict.at }),
    }))
  );
}

export interface LabelledArtifact {
  artifact: string;
  set: string;
  run: string;
  briefId: string;
  /** What every judgment agreed on, or `unstable` when they did not. */
  label: boolean | 'unstable';
  judgments: HumanJudgment[];
}

function byArtifact(
  judgments: readonly HumanJudgment[]
): Map<string, HumanJudgment[]> {
  const grouped = new Map<string, HumanJudgment[]>();
  for (const judgment of judgments) {
    const list = grouped.get(judgment.artifact);
    if (list) list.push(judgment);
    else grouped.set(judgment.artifact, [judgment]);
  }
  return grouped;
}

export function labelArtifacts(
  judgments: readonly HumanJudgment[]
): LabelledArtifact[] {
  return [...byArtifact(judgments).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([artifact, list]) => {
      const answers = new Set(list.map((judgment) => judgment.ship));
      return {
        artifact,
        set: list[0].set,
        run: list[0].run,
        briefId: list[0].briefId,
        label: answers.size === 1 ? list[0].ship : 'unstable',
        judgments: list,
      };
    });
}

/** The reviewer's own repeatability: first judgment against second, by brief. */
export function humanRepeatability(
  judgments: readonly HumanJudgment[],
  options: { seed?: number; resamples?: number } = {}
): ClusteredKappaReport {
  const ratings = [...byArtifact(judgments).values()]
    .filter((list) => list.length >= 2)
    .map((list) => ({
      a: list[0].ship,
      b: list[1].ship,
      cluster: list[0].briefId,
    }));
  return clusterBootstrapKappa(ratings, options);
}

/** Everything a definition is scored on, for one artifact. */
export interface EvidenceRow {
  artifact: string;
  briefId: string;
  format: string;
  /** The human label; `unstable` rows are counted and never scored. */
  label: boolean | 'unstable';
  outcome: RunOutcome;
  qualityByCode: Readonly<Record<string, number>>;
  /** The judge's verdict in each question's sitting, where it answered. */
  verdicts: Partial<Record<ShippingQuestionId, JudgeAnswer>>;
}

/** One judged set on disk: its runs, their fresh facts, and each sitting's verdicts. */
export interface EvidenceSet {
  /** The set id the human verdict files use: `before`, `after-exhibits`… */
  id: string;
  runs: ReadonlyArray<{
    label: string;
    briefId: string;
    format: string;
    outcome: RunOutcome;
  }>;
  /**
   * `facts.json` runs: every completed run's findings, either re-analysed by
   * the analyzer in this tree (fresh artifacts, whose sheets it also rendered)
   * or as recorded when the artifact was judged (see `recordedFacts`).
   */
  facts: Readonly<
    Record<string, { qualityByCode: Readonly<Record<string, number>> }>
  >;
  /** Each question's sitting over the set, by run label. */
  sittings: Partial<
    Record<ShippingQuestionId, Readonly<Record<string, JudgeAnswer>>>
  >;
}

/**
 * The rows a definition is scored on: every labelled artifact, joined to its
 * run, its facts and whatever each sitting answered.
 *
 * Strict on purpose. A label that names no run, or a completed run with no
 * fresh facts, is a broken join — scoring around it would quietly shrink the
 * set, which is the failure this whole ticket exists to stop.
 */
export function buildEvidence(
  sets: readonly EvidenceSet[],
  labels: readonly LabelledArtifact[]
): EvidenceRow[] {
  const bySet = new Map(sets.map((set) => [set.id, set]));
  return labels.map((entry) => {
    const set = bySet.get(entry.set);
    const run = set?.runs.find((candidate) => candidate.label === entry.run);
    if (!set || !run) {
      throw new Error(`No set holds the labelled artifact ${entry.artifact}.`);
    }
    const facts = set.facts[run.label];
    if (run.outcome === 'completed' && !facts) {
      throw new Error(
        `${entry.artifact} completed but its set's facts.json has no entry for it; run \`pnpm shipping reanalyze\` or \`pnpm shipping recorded-facts\` on the set first.`
      );
    }
    const verdicts: EvidenceRow['verdicts'] = {};
    for (const [question, sitting] of Object.entries(set.sittings) as Array<
      [ShippingQuestionId, EvidenceSet['sittings'][ShippingQuestionId]]
    >) {
      const verdict = sitting?.[run.label];
      if (verdict) verdicts[question] = verdict;
    }
    return {
      artifact: entry.artifact,
      briefId: run.briefId,
      format: run.format,
      label: entry.label,
      outcome: run.outcome,
      qualityByCode: facts?.qualityByCode ?? {},
      verdicts,
    };
  });
}

/**
 * Facts as they stood when an artifact was judged.
 *
 * A document is not a fixed picture: the engine that renders it moves. The
 * checkpoint sets were judged on sheets rendered before sections flowed, and
 * re-rendering those documents today paginates them differently — so facts
 * re-analysed now would describe pages nobody looked at. For a calibration
 * artifact the facts are therefore the run's recorded findings, with its page
 * defects taken from one measurement made on the judged renders
 * (`baselines/2026-09-08-page-fill-measure.json`), replacing whatever page
 * codes the run recorded under whichever rule was current that day.
 */
export function recordedFacts(
  runs: ReadonlyArray<{
    label: string;
    qualityByCode: Readonly<Record<string, number>>;
  }>,
  pageFill: Readonly<Record<string, { underfilled: number }>>
): Record<string, { qualityByCode: Record<string, number> }> {
  const facts: Record<string, { qualityByCode: Record<string, number> }> = {};
  for (const run of runs) {
    const measured = pageFill[run.label];
    if (!measured) {
      throw new Error(
        `The page-fill measure has no entry for ${run.label}; recorded facts need one for every run.`
      );
    }
    const qualityByCode = Object.fromEntries(
      Object.entries(run.qualityByCode).filter(
        ([code]) => !PAGE_DEFECT_CODES.includes(code)
      )
    );
    if (measured.underfilled > 0) {
      qualityByCode.W_QUALITY_RENDERED_PAGE_UNDERFILLED = measured.underfilled;
    }
    facts[run.label] = { qualityByCode };
  }
  return facts;
}

export interface Confusion {
  bothShip: number;
  bothHold: number;
  /** The human ships, the definition does not. */
  humanOnly: number;
  /** The definition ships, the human does not. */
  definitionOnly: number;
}

export interface DefinitionScore extends ClusteredKappaReport {
  id: string;
  hash: string;
  excluded: { unstable: number; undecided: number };
  confusion: Confusion;
  byFormat: Record<
    string,
    { n: number; kappa: number; rawAgreement: number; confusion: Confusion }
  >;
}

function confusionOf(
  pairs: ReadonlyArray<{ a: boolean; b: boolean }>
): Confusion {
  const confusion = {
    bothShip: 0,
    bothHold: 0,
    humanOnly: 0,
    definitionOnly: 0,
  };
  for (const { a, b } of pairs) {
    if (a && b) confusion.bothShip += 1;
    else if (!a && !b) confusion.bothHold += 1;
    else if (a) confusion.humanOnly += 1;
    else confusion.definitionOnly += 1;
  }
  return confusion;
}

export function scoreDefinition(
  definition: ShippingDefinition,
  rows: readonly EvidenceRow[],
  options: { seed?: number; resamples?: number } = {}
): DefinitionScore {
  const excluded = { unstable: 0, undecided: 0 };
  const ratings: Array<{
    a: boolean;
    b: boolean;
    cluster: string;
    format: string;
  }> = [];
  for (const row of rows) {
    if (row.label === 'unstable') {
      excluded.unstable += 1;
      continue;
    }
    const decision = ships(definition, {
      outcome: row.outcome,
      qualityByCode: row.qualityByCode,
      ...(row.verdicts[definition.question] && {
        judge: row.verdicts[definition.question],
      }),
    });
    if (decision === undefined) {
      excluded.undecided += 1;
      continue;
    }
    ratings.push({
      a: row.label,
      b: decision,
      cluster: row.briefId,
      format: row.format,
    });
  }

  const formats = [...new Set(ratings.map((rating) => rating.format))].sort();
  const byFormat: DefinitionScore['byFormat'] = {};
  for (const format of formats) {
    const subset = ratings.filter((rating) => rating.format === format);
    byFormat[format] = {
      n: subset.length,
      kappa: cohensKappa(subset),
      rawAgreement: rawAgreement(subset),
      confusion: confusionOf(subset),
    };
  }

  return {
    id: definition.id,
    hash: definitionHash(definition),
    ...clusterBootstrapKappa(ratings, options),
    excluded,
    confusion: confusionOf(ratings),
    byFormat,
  };
}

/** How many terms a definition decides on; fewer is simpler. */
function terms(definition: ShippingDefinition): number {
  return (
    Number(definition.judgeAnswer) +
    Number(definition.minimumLevel > 0) +
    Number(definition.noIntegrityDefect) +
    Number(definition.maximumPageDefects !== undefined)
  );
}

const readsPages = (definition: ShippingDefinition): boolean =>
  definition.maximumPageDefects !== undefined;

/**
 * The rule the calibration plan states before any score is seen.
 *
 * The highest kappa wins, except that a definition within `margin` of it that
 * reads no page term is preferred: page fill is measured only for documents,
 * so a page term that wins on the report-only calibration set would carry an
 * assumption about decks nobody has checked. Among the rest, fewer terms,
 * then the candidates' own order.
 */
export function chooseDefinition(
  scores: ReadonlyArray<{ id: string; kappa: number }>,
  candidates: readonly ShippingDefinition[],
  options: { margin?: number } = {}
): { chosen: string; reason: string } {
  const margin = options.margin ?? 0.05;
  const ranked = scores.filter((score) => Number.isFinite(score.kappa));
  if (ranked.length === 0) {
    throw new Error('No candidate has a defined agreement to choose on.');
  }
  const best = Math.max(...ranked.map((score) => score.kappa));
  const order = new Map(
    candidates.map((candidate, index) => [candidate.id, index])
  );
  const definitionOf = (id: string): ShippingDefinition => {
    const found = candidates.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown candidate "${id}".`);
    return found;
  };
  const eligible = ranked
    .filter((score) => score.kappa >= best - margin)
    .map((score) => definitionOf(score.id))
    .sort(
      (a, b) =>
        Number(readsPages(a)) - Number(readsPages(b)) ||
        terms(a) - terms(b) ||
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    );
  const chosen = eligible[0];
  const top = ranked.find((score) => score.kappa === best)!;
  const reason =
    chosen.id === top.id
      ? `highest kappa (${best.toFixed(2)})`
      : `within ${margin} of the highest kappa (${top.id}, ${best.toFixed(2)}), and ${
          readsPages(definitionOf(top.id)) && !readsPages(chosen)
            ? 'reads no page term, which only documents measure'
            : 'decides on fewer terms'
        }`;
  return { chosen: chosen.id, reason };
}

export interface FrozenDefinition {
  definition: ShippingDefinition;
  hash: string;
  /** The exact wording of the question the definition reads. */
  questionText: string;
  frozenAt: string;
  calibration: {
    scores: unknown[];
    chosen: string;
    reason: string;
    [key: string]: unknown;
  };
}

export function freezeDefinition(
  definition: ShippingDefinition,
  input: {
    frozenAt?: Date;
    evidence: FrozenDefinition['calibration'];
  }
): FrozenDefinition {
  return {
    definition,
    hash: definitionHash(definition),
    questionText: SHIPPING_QUESTIONS[definition.question],
    frozenAt: (input.frozenAt ?? new Date()).toISOString(),
    calibration: input.evidence,
  };
}

export const VERIFICATION_TARGET = 0.5;

export interface VerificationResult {
  definition: string;
  hash: string;
  target: number;
  passed: boolean;
  score: DefinitionScore;
}

export function verifyDefinition(
  frozen: FrozenDefinition,
  rows: readonly EvidenceRow[],
  options: { seed?: number; resamples?: number; target?: number } = {}
): VerificationResult {
  const hash = definitionHash(frozen.definition);
  if (hash !== frozen.hash) {
    throw new Error(
      `The frozen definition "${frozen.definition.id}" no longer matches its hash: it was edited after freezing, so it cannot be verified as frozen.`
    );
  }
  const target = options.target ?? VERIFICATION_TARGET;
  const score = scoreDefinition(frozen.definition, rows, options);
  return {
    definition: frozen.definition.id,
    hash,
    target,
    passed:
      score.n > 0 && Number.isFinite(score.kappa) && score.kappa >= target,
    score,
  };
}

/** Where a frozen definition and its verification are committed. */
export const FROZEN_DEFINITION_FILE = 'shipping-definition.json';
export const VERIFICATION_FILE = 'shipping-verification.json';

async function readIfPresent(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * The definition a run set's `wouldShip` is computed under, and whether it is
 * verified — read from the baselines directory, where freezing commits it.
 *
 * A frozen file whose definition no longer hashes to its recorded hash is
 * refused rather than used: the hash covers the question's wording, so a
 * question edited in code after freezing would otherwise change the
 * instrument under a scorecard that still names the old one.
 */
export async function loadShippingSemantics(
  baselinesDir: string
): Promise<{ definition: ShippingDefinition; verified: boolean }> {
  const frozen = (await readIfPresent(
    path.join(baselinesDir, FROZEN_DEFINITION_FILE)
  )) as FrozenDefinition | undefined;
  if (!frozen) return { definition: STATUS_QUO_DEFINITION, verified: false };
  if (definitionHash(frozen.definition) !== frozen.hash) {
    throw new Error(
      `${FROZEN_DEFINITION_FILE} does not match its hash: the definition or its question changed after freezing. Freeze again rather than scoring under an instrument nobody calibrated.`
    );
  }
  const verification = (await readIfPresent(
    path.join(baselinesDir, VERIFICATION_FILE)
  )) as { hash?: string; passed?: boolean } | undefined;
  return {
    definition: frozen.definition,
    verified:
      verification?.hash === frozen.hash && verification.passed === true,
  };
}

/**
 * One judge sitting over a set — `pnpm rejudge <dir> --question <q> --out
 * <dir>/sitting-<q>.json` — as verdicts by run label.
 *
 * Undefined when the set has no sitting for that question; a sitting judged
 * with another question, or one that does not parse, is refused rather than
 * read as silence.
 */
export async function loadSitting(
  file: string,
  question: ShippingQuestionId
): Promise<Record<string, JudgeAnswer> | undefined> {
  const report = (await readIfPresent(file)) as
    | {
        question?: string;
        runs: Array<{ run?: string; briefId: string; now?: JudgeAnswer }>;
      }
    | undefined;
  if (!report) return undefined;
  if ((report.question ?? 'v1') !== question) {
    throw new Error(
      `${file} was judged with question ${report.question ?? 'v1'}, not ${question}.`
    );
  }
  return Object.fromEntries(
    report.runs.flatMap((run) =>
      run.now
        ? [
            [
              run.run ?? run.briefId,
              { level: run.now.level, wouldShip: run.now.wouldShip },
            ],
          ]
        : []
    )
  );
}
