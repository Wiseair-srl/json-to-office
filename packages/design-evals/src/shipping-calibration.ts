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
  promptDigest,
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
    /** The question the reviewer answered, verbatim. */
    question?: string;
    /** When the verdicts were read out of the review page (verification only). */
    readAt?: string;
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
  const listed = (definition: ShippingDefinition): number =>
    order.get(definition.id) ?? 0;
  // The stated rule, in order: the first step that separates two candidates
  // decides between them, and is the reason given for the choice.
  const tieBreaks: ReadonlyArray<{
    compare: (a: ShippingDefinition, b: ShippingDefinition) => number;
    reason: string;
  }> = [
    {
      compare: (a, b) => Number(readsPages(a)) - Number(readsPages(b)),
      reason: 'reads no page term, which only documents measure',
    },
    {
      compare: (a, b) => terms(a) - terms(b),
      reason: 'decides on fewer terms',
    },
    {
      compare: (a, b) => listed(a) - listed(b),
      reason: 'has the same page term and as many terms, and was listed first',
    },
  ];
  const eligible = ranked
    .filter((score) => score.kappa >= best - margin)
    .map((score) => definitionOf(score.id))
    .sort(
      (a, b) =>
        tieBreaks.map((step) => step.compare(a, b)).find((d) => d !== 0) ?? 0
    );
  const chosen = eligible[0];
  const top = ranked.find((score) => score.kappa === best)!;
  const decider = tieBreaks.find(
    (step) => step.compare(chosen, definitionOf(top.id)) < 0
  );
  const reason =
    chosen.id === top.id
      ? `highest kappa (${best.toFixed(2)})`
      : `within ${margin} of the highest kappa (${top.id}, ${best.toFixed(2)}), and ${decider?.reason}`;
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
    /** Every brief a calibration artifact answered; verification may use none of them. */
    briefs?: string[];
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
  options: {
    /** When the human verdicts were read out of the review page. */
    humanReadAt: string;
    /** The judge sittings the verdicts came from, one per set and question. */
    sittings: ReadonlyArray<{
      question?: ShippingQuestionId;
      judgedAt?: string;
      promptSha256?: string;
    }>;
    seed?: number;
    resamples?: number;
    target?: number;
  }
): VerificationResult {
  const hash = definitionHash(frozen.definition);
  if (hash !== frozen.hash) {
    throw new Error(
      `The frozen definition "${frozen.definition.id}" no longer matches its hash: it was edited after freezing, so it cannot be verified as frozen.`
    );
  }
  // Read after freezing, or the definition could have been chosen knowing them.
  if (!(Date.parse(options.humanReadAt) > Date.parse(frozen.frozenAt))) {
    throw new Error(
      `The verification verdicts were read at ${options.humanReadAt}, before the definition was frozen at ${frozen.frozenAt}: they cannot verify it.`
    );
  }
  // The sitting the definition reads answered after freezing, or its verdicts
  // could have been seen while choosing; and it read the frozen prompt.
  const { question } = frozen.definition;
  const expectedPrompt = promptDigest(question);
  for (const sitting of options.sittings) {
    if ((sitting.question ?? 'v1') !== question) continue;
    if (sitting.judgedAt === undefined) {
      throw new Error(
        `A judge sitting for question ${question} does not say when it answered, so it cannot show it followed the freeze.`
      );
    }
    if (!(Date.parse(sitting.judgedAt) > Date.parse(frozen.frozenAt))) {
      throw new Error(
        `The judge sitting for question ${question} answered at ${sitting.judgedAt}, before the definition was frozen at ${frozen.frozenAt}: its verdicts could have shaped the choice.`
      );
    }
    if (
      sitting.promptSha256 !== undefined &&
      sitting.promptSha256 !== expectedPrompt
    ) {
      throw new Error(
        `The judge sitting for question ${question} read another prompt (${sitting.promptSha256.slice(0, 12)}) than the frozen definition names (${expectedPrompt.slice(0, 12)}).`
      );
    }
  }
  const calibrated = new Set(frozen.calibration.briefs ?? []);
  const overlap = [
    ...new Set(
      rows.map((row) => row.briefId).filter((brief) => calibrated.has(brief))
    ),
  ];
  if (overlap.length > 0) {
    throw new Error(
      `Verification artifacts answer brief(s) the definition was calibrated on: ${overlap.join(', ')}. Verification must be independent by brief.`
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

/** One verification, as the record keeps it — every attempt, never only the last. */
export interface VerificationAttempt extends VerificationResult {
  set: { id: string; briefs: string[] };
  verifiedAt: string;
  humanReadAt: string;
  /** Why this attempt was allowed to follow another on the same set. */
  supersedes?: string;
}

export interface VerificationRecord {
  attempts: VerificationAttempt[];
}

/**
 * Whether an attempt may join the record.
 *
 * A set that has verified one definition can never verify another: choosing
 * the next definition after seeing how the first did on the set is tuning on
 * verification outcomes, however it is dressed. The same definition may try
 * again on the same set only with a stated reason — a crashed sitting, a
 * harness bug — and the earlier attempt stays in the record beside it.
 */
export function admitVerification(
  record: VerificationRecord | undefined,
  attempt: Pick<VerificationAttempt, 'hash' | 'set'>,
  supersede?: string
): void {
  const briefs = new Set(attempt.set.briefs);
  const onSet = (record?.attempts ?? []).filter((earlier) =>
    earlier.set.briefs.some((brief) => briefs.has(brief))
  );
  const other = onSet.find((earlier) => earlier.hash !== attempt.hash);
  if (other) {
    throw new Error(
      `These briefs already verified definition ${other.hash.slice(0, 12)} (${other.definition}); a different definition needs artifacts nobody has verified with.`
    );
  }
  if (onSet.length > 0 && !supersede?.trim()) {
    throw new Error(
      'This definition was already verified on these briefs; a second attempt needs a stated reason (--supersede "<why>"), and both stay in the record.'
    );
  }
}

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
  const record = (await readIfPresent(
    path.join(baselinesDir, VERIFICATION_FILE)
  )) as Pick<VerificationRecord, 'attempts'> | undefined;
  const latest = (record?.attempts ?? [])
    .filter((attempt) => attempt.hash === frozen.hash)
    .at(-1);
  return {
    definition: frozen.definition,
    verified: latest?.passed === true,
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
export interface Sitting {
  verdicts: Record<string, JudgeAnswer>;
  judgeModel?: string;
  judgedAt?: string;
  /** The digest of the whole prompt the sitting read; absent on sittings older than the field. */
  promptSha256?: string;
}

export async function loadSitting(
  file: string,
  question: ShippingQuestionId
): Promise<Sitting | undefined> {
  const report = (await readIfPresent(file)) as
    | {
        question?: string;
        judgeModel?: string;
        judgedAt?: string;
        promptSha256?: string;
        runs: Array<{ run?: string; briefId: string; now?: JudgeAnswer }>;
      }
    | undefined;
  if (!report) return undefined;
  if ((report.question ?? 'v1') !== question) {
    throw new Error(
      `${file} was judged with question ${report.question ?? 'v1'}, not ${question}.`
    );
  }
  return {
    verdicts: Object.fromEntries(
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
    ),
    ...(report.judgeModel !== undefined && { judgeModel: report.judgeModel }),
    ...(report.judgedAt !== undefined && { judgedAt: report.judgedAt }),
    ...(report.promptSha256 !== undefined && {
      promptSha256: report.promptSha256,
    }),
  };
}

/**
 * Two sittings of the judge, on the artifacts both answered — the judge's
 * variance, kept apart from the reviewer's and the author's. With the
 * calibration sitting against an earlier one it is the judge's
 * repeatability; with the two questions' sittings against each other it is
 * how much rewording the question moved the level a definition reads.
 */
export function sittingAgreement(
  a: Readonly<Record<string, JudgeAnswer>>,
  b: Readonly<Record<string, JudgeAnswer>>,
  options: { seed?: number; resamples?: number } = {}
): { n: number; wouldShip: ClusteredKappaReport; level: ClusteredKappaReport } {
  const shared = Object.keys(a).filter((label) => b[label] !== undefined);
  return {
    n: shared.length,
    wouldShip: clusterBootstrapKappa(
      shared.map((label) => ({
        a: a[label].wouldShip,
        b: b[label].wouldShip,
        cluster: briefOf(label),
      })),
      options
    ),
    level: clusterBootstrapKappa(
      shared.map((label) => ({
        a: a[label].level,
        b: b[label].level,
        cluster: briefOf(label),
      })),
      options
    ),
  };
}

/**
 * How much the author varies, read off repeated passes of one brief: the
 * briefs whose passes the reviewer split between ship and hold, and the
 * spread of the judge's level across passes. Same question, same product,
 * different documents — the part of any delta that is the author's dice.
 */
export function authorVariance(
  rows: readonly EvidenceRow[],
  question: ShippingQuestionId
): {
  briefs: number;
  briefsTheReviewerSplit: number;
  meanJudgeLevelRange: number;
} {
  // Passes of one brief within one set: across sets the product changed, and
  // that difference is the product's, not the author's.
  const byBrief = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const key = `${row.artifact.split('/')[0]}/${row.briefId}`;
    const list = byBrief.get(key);
    if (list) list.push(row);
    else byBrief.set(key, [row]);
  }
  const repeated = [...byBrief.values()].filter((list) => list.length >= 2);
  const split = repeated.filter((list) => {
    const labels = new Set(
      list.flatMap((row) => (row.label === 'unstable' ? [] : [row.label]))
    );
    return labels.size > 1;
  }).length;
  const ranges = repeated.flatMap((list) => {
    const levels = list.flatMap((row) => {
      const verdict = row.verdicts[question];
      return verdict ? [verdict.level] : [];
    });
    return levels.length >= 2
      ? [Math.max(...levels) - Math.min(...levels)]
      : [];
  });
  return {
    briefs: repeated.length,
    briefsTheReviewerSplit: split,
    meanJudgeLevelRange:
      ranges.length === 0
        ? 0
        : ranges.reduce((sum, range) => sum + range, 0) / ranges.length,
  };
}
