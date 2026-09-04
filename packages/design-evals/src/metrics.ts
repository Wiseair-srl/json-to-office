/**
 * Hard metrics: what a run cost, and what is measurably wrong with what it
 * produced.
 *
 * Everything here is countable without an opinion. Whether a document is any
 * good is the judge's question (#321); whether it still carries a scaffold
 * marker, overflows a box or substituted a font is this one, and the two are
 * kept apart so a taste change can never quietly move a hard number.
 *
 * A failed run is not absent from the metrics. It is a run whose document is
 * not shippable, and it stays in the denominator — the alternative is a
 * scorecard that improves every time the agent gives up earlier.
 */

export type RunOutcome = 'completed' | 'failed';

export interface RunCost {
  /** Input and output tokens across the whole session. */
  inputTokens: number;
  outputTokens: number;
  /** USD, as the SDK reports it. Absent when the SDK does not say. */
  usd?: number;
}

export interface DocumentMetrics {
  /** Pages for docx, slides for pptx, as the preview or the document reports. */
  pages: number;
  /** Diagnostics that would stop `jto_generate`. */
  blockingFindings: number;
  /** `W_QUALITY_*` counts, by code. */
  qualityByCode: Record<string, number>;
  /** Placeholder or scaffold-marker findings still present at "done". */
  placeholderLeaks: number;
  /** Fonts the render could not resolve and replaced. */
  fontSubstitutions: number;
}

/** The judge's answer for this run, when one was asked for. */
export interface RunJudgement {
  level: 1 | 2 | 3 | 4 | 5;
  wouldShip: boolean;
  genericness: 0 | 1 | 2 | 3 | 4;
  rationale: string;
}

export interface RunMetrics extends DocumentMetrics {
  /**
   * Whether `pages` was counted by a renderer or inferred from the JSON.
   * On the run rather than the scorecard, so a corpus measured on two hosts
   * cannot average a real page count with a structural one and say nothing.
   */
  pageCountSource: 'rendered' | 'structural';
  briefId: string;
  format: string;
  outcome: RunOutcome;
  /** Why a failed run failed, in one line. */
  failure?: string;
  /**
   * Edit-and-recheck rounds after the first complete draft — the spec's
   * "author iterations to done", whose target is 2.
   *
   * Not the agent's turn count, which is roughly the tool-call count and an
   * order of magnitude larger. Reporting one under the other's name made a
   * run look 9x worse than the target scale and compared nothing to anything.
   */
  iterations: number;
  /** Conversational turns the session took. Kept because it prices the run. */
  turns: number;
  toolCalls: number;
  cost: RunCost;
  wallMs: number;
  /** Retries the runner itself performed, e.g. after a transport error. */
  retries: number;
  /**
   * `evaluative`, and never mixed into a hard metric. A scorecard reports the
   * judge beside the countable numbers so a taste change and a defect change
   * stay distinguishable.
   */
  judge?: RunJudgement;
}

/** A run that produced nothing, counted rather than dropped. */
export function failedRun(
  briefId: string,
  format: string,
  failure: string,
  partial: Partial<RunMetrics> = {}
): RunMetrics {
  return {
    briefId,
    format,
    outcome: 'failed',
    failure,
    pages: 0,
    pageCountSource: 'structural',
    blockingFindings: 0,
    qualityByCode: {},
    placeholderLeaks: 0,
    fontSubstitutions: 0,
    iterations: 0,
    turns: 0,
    toolCalls: 0,
    cost: { inputTokens: 0, outputTokens: 0 },
    wallMs: 0,
    retries: 0,
    ...partial,
  };
}

interface Diagnostic {
  code?: unknown;
  severity?: unknown;
  blocking?: unknown;
}

/** Codes that mean text nobody meant to ship reached the document. */
const PLACEHOLDER_CODES = new Set([
  'W_QUALITY_PLACEHOLDER_TEXT',
  'W_QUALITY_SCAFFOLD_MARKER',
]);

/** Codes the cores emit when a requested family was not available. */
const FONT_SUBSTITUTION_CODES = new Set([
  'W_FONT_UNRESOLVED',
  'W_FONT_SUBSTITUTED',
]);

/**
 * Fold a final `jto_validate` answer into document metrics.
 *
 * Reads the diagnostics rather than the tool's `ok`, because "blocking" is a
 * property of each finding: a run policy can promote a quality warning into
 * the gate, and a scorecard that counted `ok: false` would then report a
 * policy choice as a defect.
 */
export function documentMetrics(input: {
  diagnostics: readonly Diagnostic[];
  pages: number;
}): DocumentMetrics {
  const qualityByCode: Record<string, number> = {};
  let blockingFindings = 0;
  let placeholderLeaks = 0;
  let fontSubstitutions = 0;

  for (const entry of input.diagnostics) {
    const code = typeof entry.code === 'string' ? entry.code : '';
    if (entry.blocking === true || entry.severity === 'error') {
      blockingFindings += 1;
    }
    if (code.startsWith('W_QUALITY_')) {
      qualityByCode[code] = (qualityByCode[code] ?? 0) + 1;
      if (PLACEHOLDER_CODES.has(code)) placeholderLeaks += 1;
    }
    if (FONT_SUBSTITUTION_CODES.has(code)) fontSubstitutions += 1;
  }

  return {
    pages: input.pages,
    blockingFindings,
    qualityByCode: Object.fromEntries(Object.entries(qualityByCode).sort()),
    placeholderLeaks,
    fontSubstitutions,
  };
}

/**
 * Whether a run produced a structurally sound document.
 *
 * A floor, not a verdict, and named accordingly. It asks only whether the
 * document built, stopped blocking generation, and carries no text nobody
 * wrote — questions with mechanical answers. Whether anyone would SEND it is
 * the judge's question and reaches the scorecard as `judge.wouldShipRate`.
 *
 * The two were briefly both called "shippable", and the first smoke run duly
 * reported "3/3 shippable (100%)" for three documents nothing had looked at —
 * against a programme target of 50%. A floor wearing the headline metric's
 * name is worse than no floor.
 */
export function buildsClean(run: RunMetrics): boolean {
  return (
    run.outcome === 'completed' &&
    run.blockingFindings === 0 &&
    run.placeholderLeaks === 0 &&
    run.pages > 0
  );
}
