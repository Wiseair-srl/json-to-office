#!/usr/bin/env tsx
/**
 * `pnpm shipping` — calibrate, freeze and verify the shipping definition (#409).
 *
 *   pnpm shipping sheets <set-dir>
 *     Render the contact sheet of every completed run that has none, so a set
 *     authored without `--judge` can be judged later — by Paolo and by the
 *     frozen definition — from the same image.
 *
 *   pnpm shipping reanalyze <set-dir>
 *     Recompute every completed run's facts with the analyzer in this tree and
 *     write `<set-dir>/facts.json`. For fresh artifacts, whose sheets this
 *     tree also renders. A document the analyzer could not render is left out
 *     and the command fails, so a definition never reads it as clean.
 *
 *   pnpm shipping recorded-facts <set-dir> --page-fill <file> --page-fill-set <key>
 *     Write `<set-dir>/facts.json` from what was recorded when the set was
 *     judged: the run's findings, and its page defects from one page-fill
 *     measurement of the judged renders. For calibration artifacts, which
 *     today's engine would paginate differently.
 *
 *   pnpm shipping calibrate --set <id>=<dir>… --human <file>… [--previous <set>=<file>…] --out <file>
 *     Score every candidate definition on the human-labelled artifacts, with
 *     each set's `sitting-<question>.json` judge sittings (`pnpm rejudge <dir>
 *     --question v2 --out <dir>/sitting-v2.json`), and choose one by the
 *     stated rule.
 *
 *   pnpm shipping freeze --calibration <file> [--candidate <id>] --out <file>
 *   pnpm shipping verify --definition <file> --set <id>=<dir>… --human <file> --record <file> [--supersede <why>]
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { analyzeDocument } from './analyze.js';
import { assignments, runWithInkLines, type Line } from './cli-lines.js';
import type { BriefFormat } from './corpus.js';
import { gitState } from './manifest.js';
import { documentMetrics, type RunMetrics } from './metrics.js';
import { comparableRuns, type RecordedRun } from './rejudge.js';
import {
  RenderError,
  renderForJudging,
  type RenderedDocument,
} from './render.js';
import {
  buildEvidence,
  chooseDefinition,
  freezeDefinition,
  humanJudgments,
  humanRepeatability,
  labelArtifacts,
  loadSitting,
  sittingAgreement,
  authorVariance,
  type Sitting,
  recordedFacts,
  scoreDefinition,
  verifyDefinition,
  admitVerification,
  type EvidenceSet,
  type FrozenDefinition,
  type HumanRound,
  type VerificationAttempt,
  type VerificationRecord,
} from './shipping-calibration.js';
import {
  CANDIDATE_DEFINITIONS,
  definitionHash,
  promptDigest,
  SHIPPING_QUESTIONS,
  type ShippingDefinition,
  type ShippingQuestionId,
} from './shipping.js';
import { formatKappa } from './statistics.js';

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

type SetRun = RecordedRun &
  Pick<RunMetrics, 'format' | 'outcome' | 'qualityByCode'>;

/** The runs of a set, labelled the way the runner wrote their directories. */
async function setRuns(dir: string) {
  const scorecard = await readJson<{ runs: SetRun[] }>(
    path.join(dir, 'scorecard.json')
  );
  return comparableRuns(scorecard.runs);
}

async function sheets(dir: string, line: Line): Promise<number> {
  let rendered = 0;
  let failed = 0;
  for (const run of await setRuns(dir)) {
    const runDir = path.join(dir, 'runs', run.label);
    const sheet = path.join(runDir, 'contact-sheet.png');
    const documentFile = path.join(runDir, 'document.json');
    if (run.outcome !== 'completed' || (await exists(sheet))) continue;
    if (!(await exists(documentFile))) {
      line(`  ${run.label}: completed but no document.json — skipped`);
      continue;
    }
    const document = await readJson<unknown>(documentFile);
    let result: RenderedDocument;
    try {
      result = await renderForJudging(run.format as BriefFormat, document);
    } catch (error) {
      if (!(error instanceof RenderError)) throw error;
      // One converter crash leaves one document without a sheet, not the rest;
      // the command reruns only what is still missing.
      failed += 1;
      line(
        `  ${run.label}: render failed` +
          (error.stage ? ` at the ${error.stage} stage` : '')
      );
      continue;
    }
    await fs.writeFile(sheet, result.sheet.png);
    rendered += 1;
    line(`  ${run.label}: ${result.totalPages} page(s)`);
  }
  line(
    `${rendered} contact sheet(s) rendered in ${dir}` +
      (failed > 0 ? `, ${failed} failed` : '')
  );
  return failed > 0 ? 1 : 0;
}

async function reanalyze(
  dir: string,
  repoRoot: string,
  line: Line
): Promise<number> {
  const runs: Record<string, unknown> = {};
  const unrendered: string[] = [];
  for (const run of await setRuns(dir)) {
    if (run.outcome !== 'completed') continue;
    const documentFile = path.join(dir, 'runs', run.label, 'document.json');
    if (!(await exists(documentFile))) {
      line(`  ${run.label}: completed but no document.json — skipped`);
      continue;
    }
    const measured = await analyzeDocument(
      run.format,
      await readJson<unknown>(documentFile)
    );
    // A failed render still yields a page count, from the structure, and no
    // rendered finding at all. Kept, it would read as a clean document; left
    // out, a definition that needs it refuses the artifact until it is rerun.
    if (measured.pageCountSource === 'structural') {
      unrendered.push(run.label);
      line(`  ${run.label}: not rendered — left out of facts.json`);
      continue;
    }
    const metrics = documentMetrics({
      diagnostics: measured.diagnostics,
      pages: measured.pages,
    });
    runs[run.label] = {
      format: run.format,
      pages: metrics.pages,
      pageCountSource: measured.pageCountSource,
      qualityByCode: metrics.qualityByCode,
    };
    line(`  ${run.label}: ${metrics.pages} page(s)`);
  }
  if (unrendered.length > 0) {
    line(
      `${unrendered.length} of ${Object.keys(runs).length + unrendered.length} document(s) could not be rendered; rerun where LibreOffice renders them`
    );
  }
  const out = path.join(dir, 'facts.json');
  await fs.writeFile(
    out,
    JSON.stringify(
      {
        source: 'reanalysis',
        analyzedAt: new Date().toISOString(),
        gitSha: gitState(repoRoot).sha,
        runs,
      },
      null,
      2
    )
  );
  line(out);
  return unrendered.length > 0 ? 1 : 0;
}

async function recorded(
  dir: string,
  argv: readonly string[],
  line: Line
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'page-fill': { type: 'string' },
      'page-fill-set': { type: 'string' },
    },
  });
  const pageFillFile = values['page-fill'];
  const pageFillSet = values['page-fill-set'];
  if (!pageFillFile || !pageFillSet) {
    line(
      'usage: pnpm shipping recorded-facts <set-dir> --page-fill <file> --page-fill-set <key>'
    );
    return 1;
  }
  const measure = await readJson<{
    sets: Record<string, { runs: Record<string, { underfilled: number }> }>;
  }>(pageFillFile);
  const measured = measure.sets[pageFillSet];
  if (!measured) {
    line(`${pageFillFile} has no set "${pageFillSet}".`);
    return 1;
  }
  const runs = (await setRuns(dir)).filter(
    (run) => run.outcome === 'completed'
  );
  const out = path.join(dir, 'facts.json');
  await fs.writeFile(
    out,
    JSON.stringify(
      {
        source: 'recorded',
        pageFill: { file: path.basename(pageFillFile), set: pageFillSet },
        runs: recordedFacts(runs, measured.runs),
      },
      null,
      2
    )
  );
  line(out);
  return 0;
}

/** `--set <id>=<dir>` flags. */
function parseSets(
  entries: readonly string[] | undefined
): Array<{ id: string; dir: string }> {
  return assignments(entries, 'set').map(([id, dir]) => ({
    id,
    dir: path.resolve(dir),
  }));
}

/** Where a set's verdicts came from: one judge sitting, by question. */
type SittingRecord = Omit<Sitting, 'verdicts'> & {
  set: string;
  question: ShippingQuestionId;
};

async function loadEvidenceSet(
  id: string,
  dir: string
): Promise<{
  set: EvidenceSet;
  sittings: SittingRecord[];
  factsSource?: string;
}> {
  const facts = await readJson<{
    source?: string;
    runs: Record<string, { qualityByCode: Record<string, number> }>;
  }>(path.join(dir, 'facts.json'));
  const verdicts: EvidenceSet['sittings'] = {};
  const sittings: SittingRecord[] = [];
  for (const question of Object.keys(
    SHIPPING_QUESTIONS
  ) as ShippingQuestionId[]) {
    const sitting = await loadSitting(
      path.join(dir, `sitting-${question}.json`),
      question
    );
    if (!sitting) continue;
    verdicts[question] = sitting.verdicts;
    sittings.push({
      set: id,
      question,
      ...(sitting.judgeModel && { judgeModel: sitting.judgeModel }),
      ...(sitting.judgedAt && { judgedAt: sitting.judgedAt }),
      ...(sitting.promptSha256 && { promptSha256: sitting.promptSha256 }),
    });
  }
  return {
    set: {
      id,
      runs: await setRuns(dir),
      facts: facts.runs,
      sittings: verdicts,
    },
    sittings,
    ...(facts.source && { factsSource: facts.source }),
  };
}

/** Every `--set`, with the sittings their verdicts came from and each set's facts source. */
async function loadEvidenceSets(
  sets: ReadonlyArray<{ id: string; dir: string }>
): Promise<{
  evidenceSets: EvidenceSet[];
  sittings: SittingRecord[];
  factsSources: Record<string, string>;
}> {
  const loaded = await Promise.all(
    sets.map((set) => loadEvidenceSet(set.id, set.dir))
  );
  return {
    evidenceSets: loaded.map((entry) => entry.set),
    sittings: loaded.flatMap((entry) => entry.sittings),
    factsSources: Object.fromEntries(
      loaded.map((entry) => [entry.set.id, entry.factsSource ?? 'unrecorded'])
    ),
  };
}

async function loadRounds(files: readonly string[]): Promise<HumanRound[]> {
  return Promise.all(
    files.map(async (file) => ({
      id: path.basename(file, '.json'),
      file: await readJson<HumanRound['file']>(file),
    }))
  );
}

const CALIBRATE_OPTIONS = {
  set: { type: 'string', multiple: true },
  human: { type: 'string', multiple: true },
  previous: { type: 'string', multiple: true },
  out: { type: 'string' },
} as const;

async function calibrate(
  argv: readonly string[],
  repoRoot: string,
  line: Line
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: CALIBRATE_OPTIONS,
  });
  const sets = parseSets(values.set);
  const humanFiles = values.human ?? [];
  const previous = assignments(values.previous, 'previous');
  const out = values.out;
  if (sets.length === 0 || humanFiles.length === 0 || !out) {
    line(
      'usage: pnpm shipping calibrate --set <id>=<dir>… --human <file>… [--previous <set>=<file>…] --out <file>'
    );
    return 1;
  }
  const { evidenceSets, sittings, factsSources } = await loadEvidenceSets(sets);
  const judgments = humanJudgments(await loadRounds(humanFiles));
  const labels = labelArtifacts(judgments);
  const rows = buildEvidence(evidenceSets, labels);
  const scores = CANDIDATE_DEFINITIONS.map((definition) =>
    scoreDefinition(definition, rows)
  );
  const choice = chooseDefinition(scores, CANDIDATE_DEFINITIONS);

  // Keyed by artifact across sets, so pooled agreement never joins two sets'
  // documents that happen to share a run label.
  const pooled = (question: ShippingQuestionId) =>
    Object.fromEntries(
      evidenceSets.flatMap((set) =>
        Object.entries(set.sittings[question] ?? {}).map(([label, answer]) => [
          `${set.id}/${label}`,
          answer,
        ])
      )
    );
  const judgeRepeatability = await Promise.all(
    previous.map(async ([setId, file]) => {
      const set = evidenceSets.find((entry) => entry.id === setId);
      const earlier = await loadSitting(path.resolve(file), 'v1');
      if (!set || !earlier) {
        throw new Error(
          `--previous ${setId}=${file} names no set or no v1 sitting.`
        );
      }
      return {
        set: setId,
        earlier: path.basename(file),
        judgedAt: earlier.judgedAt,
        ...sittingAgreement(set.sittings.v1 ?? {}, earlier.verdicts),
      };
    })
  );

  const manifest = {
    kind: 'shipping-calibration',
    generatedAt: new Date().toISOString(),
    gitSha: gitState(repoRoot).sha,
    questions: SHIPPING_QUESTIONS,
    // The whole prompt each question's sitting read, hashed, so a manifest
    // names the instrument and not only its question.
    prompts: Object.fromEntries(
      (Object.keys(SHIPPING_QUESTIONS) as ShippingQuestionId[]).map((id) => [
        id,
        promptDigest(id),
      ])
    ),
    sittings,
    facts: factsSources,
    allocation: {
      calibration: sets.map((set) => ({
        id: set.id,
        dir: path.relative(repoRoot, set.dir),
        briefs: [
          ...new Set(
            evidenceSets
              .find((entry) => entry.id === set.id)!
              .runs.map((run) => run.briefId)
          ),
        ].sort(),
      })),
      human: humanFiles.map((file) =>
        path.relative(repoRoot, path.resolve(file))
      ),
      artifacts: labels.length,
      unstable: labels.filter((entry) => entry.label === 'unstable').length,
    },
    variance: {
      human: humanRepeatability(judgments),
      judge: judgeRepeatability,
      questions: sittingAgreement(pooled('v1'), pooled('v2')),
      author: authorVariance(rows, 'v1'),
    },
    candidates: CANDIDATE_DEFINITIONS.map((definition, index) => ({
      definition,
      score: scores[index],
    })),
    choice,
  };
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await fs.writeFile(out, JSON.stringify(manifest, null, 2));

  line(
    `${labels.length} artifact(s), ${manifest.allocation.unstable} unstable`
  );
  for (const [index, definition] of CANDIDATE_DEFINITIONS.entries()) {
    const score = scores[index];
    const interval = score.interval
      ? ` [${score.interval.low.toFixed(2)}, ${score.interval.high.toFixed(2)}]`
      : '';
    line(
      `  ${definition.id.padEnd(16)} n=${String(score.n).padStart(3)} kappa ${formatKappa(score.kappa)}${interval}` +
        ` agree ${(score.rawAgreement * 100).toFixed(0)}%` +
        ` both-ship ${score.confusion.bothShip} human-only ${score.confusion.humanOnly}` +
        ` definition-only ${score.confusion.definitionOnly} both-hold ${score.confusion.bothHold}`
    );
  }
  const { variance } = manifest;
  line(
    `reviewer against themselves: n=${variance.human.n}, kappa ${formatKappa(variance.human.kappa)}`
  );
  for (const entry of variance.judge) {
    line(
      `judge against its ${entry.earlier} sitting (${entry.set}): n=${entry.n}, ship kappa ${formatKappa(entry.wouldShip.kappa)}, level kappa ${formatKappa(entry.level.kappa)}`
    );
  }
  if (variance.questions.n > 0) {
    line(
      `v1 against v2 sitting: n=${variance.questions.n}, level kappa ${formatKappa(variance.questions.level.kappa)}, ship kappa ${formatKappa(variance.questions.wouldShip.kappa)}`
    );
  }
  line(
    `author: ${variance.author.briefsTheReviewerSplit}/${variance.author.briefs} briefs split by the reviewer across passes; judge level range ${variance.author.meanJudgeLevelRange.toFixed(2)} on average`
  );
  line(`chosen: ${choice.chosen} — ${choice.reason}`);
  line(out);
  return 0;
}

async function freeze(argv: readonly string[], line: Line): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      calibration: { type: 'string' },
      candidate: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const calibrationFile = values.calibration;
  const out = values.out;
  if (!calibrationFile || !out) {
    line(
      'usage: pnpm shipping freeze --calibration <file> [--candidate <id>] --out <file>'
    );
    return 1;
  }
  const calibration = await readJson<{
    candidates: Array<{
      definition: ShippingDefinition;
      score: { hash?: string };
    }>;
    choice: { chosen: string; reason: string };
    allocation: { calibration: Array<{ briefs: string[] }> };
    generatedAt: string;
    gitSha: string;
  }>(calibrationFile);
  const id = values.candidate ?? calibration.choice.chosen;
  // Frozen as it was scored: the candidate list in code may have moved on
  // since the calibration, and its scores belong to the definition they read.
  const scored = calibration.candidates.find(
    (entry) => entry.definition?.id === id
  );
  if (!scored) {
    line(`${calibrationFile} scored no candidate "${id}".`);
    return 1;
  }
  const { definition } = scored;
  if (definitionHash(definition) !== scored.score.hash) {
    line(
      `Candidate "${id}" no longer hashes as it was scored: its terms or the judge prompt changed after calibration; calibrate again before freezing.`
    );
    return 1;
  }
  const frozen = freezeDefinition(definition, {
    evidence: {
      scores: calibration.candidates.map((entry) => entry.score),
      chosen: calibration.choice.chosen,
      reason:
        id === calibration.choice.chosen
          ? calibration.choice.reason
          : `overridden by hand: ${id} instead of ${calibration.choice.chosen}`,
      manifest: path.basename(calibrationFile),
      calibratedAt: calibration.generatedAt,
      calibratedAtSha: calibration.gitSha,
      briefs: [
        ...new Set(
          calibration.allocation.calibration.flatMap((set) => set.briefs)
        ),
      ].sort(),
    },
  });
  await fs.writeFile(out, JSON.stringify(frozen, null, 2));
  line(`froze ${definition.id} (${frozen.hash.slice(0, 12)}) -> ${out}`);
  return 0;
}

async function verify(
  argv: readonly string[],
  repoRoot: string,
  line: Line
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      set: { type: 'string', multiple: true },
      human: { type: 'string' },
      definition: { type: 'string' },
      record: { type: 'string' },
      supersede: { type: 'string' },
    },
  });
  const definitionFile = values.definition;
  const sets = parseSets(values.set);
  const humanFile = values.human;
  const recordFile = values.record;
  if (!definitionFile || sets.length === 0 || !humanFile || !recordFile) {
    line(
      'usage: pnpm shipping verify --definition <file> --set <id>=<dir>… --human <file> --record <file> [--supersede <why>]'
    );
    return 1;
  }
  const frozen = await readJson<FrozenDefinition>(definitionFile);
  const [round] = await loadRounds([humanFile]);
  // Not compared with the frozen question: that is the judge's, and the
  // reviewer's wording is the review's own. It has to be on the record.
  if (!round.file.question) {
    line(
      `${humanFile} carries no question: the record keeps the wording the reviewer answered, verbatim, so a verdict file has to state it.`
    );
    return 1;
  }
  if (!round.file.readAt) {
    line(
      `${humanFile} carries no readAt: when the verdicts left the review page is what proves they were not seen before freezing.`
    );
    return 1;
  }
  const { evidenceSets, sittings } = await loadEvidenceSets(sets);
  const rows = buildEvidence(
    evidenceSets,
    labelArtifacts(humanJudgments([round]))
  );
  const result = verifyDefinition(frozen, rows, {
    humanReadAt: round.file.readAt,
    sittings,
  });
  // Every run the score does not count, and why, so the denominator is on
  // the record rather than only in whatever prose describes the set.
  const labelled = new Set(rows.map((row) => row.artifact));
  const outside: Array<{ set: string; run: string; reason: string }> = [];
  for (const [index, set] of sets.entries()) {
    for (const run of evidenceSets[index].runs) {
      if (labelled.has(`${set.id}/${run.label}`)) continue;
      const sheet = path.join(set.dir, 'runs', run.label, 'contact-sheet.png');
      outside.push({
        set: set.id,
        run: run.label,
        reason:
          run.outcome !== 'completed'
            ? `run ${run.outcome}`
            : (await exists(sheet))
              ? 'no reviewer verdict'
              : 'no contact sheet',
      });
    }
  }
  const attempt: VerificationAttempt = {
    ...result,
    set: {
      id: sets.map((set) => set.id).join('+'),
      briefs: [...new Set(rows.map((row) => row.briefId))].sort(),
    },
    verifiedAt: new Date().toISOString(),
    humanReadAt: round.file.readAt,
    ...(values.supersede && { supersedes: values.supersede }),
  };
  let record: VerificationRecord | undefined;
  try {
    record = await readJson<VerificationRecord>(recordFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  admitVerification(record, attempt, values.supersede);
  await fs.mkdir(path.dirname(path.resolve(recordFile)), { recursive: true });
  await fs.writeFile(
    recordFile,
    JSON.stringify(
      {
        kind: 'shipping-verification',
        definitionFile: path.relative(repoRoot, path.resolve(definitionFile)),
        attempts: [
          ...(record?.attempts ?? []),
          {
            ...attempt,
            gitSha: gitState(repoRoot).sha,
            allocation: {
              sets: sets.map((set) => ({
                id: set.id,
                dir: path.relative(repoRoot, set.dir),
              })),
              human: path.relative(repoRoot, path.resolve(humanFile)),
              question: round.file.question,
              // The judge model, time and prompt digest of each sitting the
              // verdicts came from.
              sittings,
              outside,
            },
          },
        ],
      },
      null,
      2
    )
  );
  const { score } = result;
  line(
    `${result.definition}: n=${score.n} over ${score.clusters} brief(s), kappa ${formatKappa(score.kappa)}` +
      (score.interval
        ? ` [${score.interval.low.toFixed(2)}, ${score.interval.high.toFixed(2)}]`
        : '') +
      ` — ${result.passed ? 'PASSED' : 'FAILED'} the ${result.target} target`
  );
  for (const [format, entry] of Object.entries(score.byFormat)) {
    line(`  ${format}: n=${entry.n} kappa ${formatKappa(entry.kappa)}`);
  }
  if (outside.length > 0) {
    const reasons = new Map<string, number>();
    for (const entry of outside) {
      reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
    }
    line(
      `${outside.length} artifact(s) outside the denominator: ` +
        [...reasons].map(([reason, count]) => `${count} ${reason}`).join(', ')
    );
  }
  line(recordFile);
  return 0;
}

export async function main(
  argv: readonly string[],
  line: Line
): Promise<number> {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..'
  );
  const [command, target, ...rest] = argv;
  const needsDir = (usage: string): number => {
    line(`usage: pnpm shipping ${usage}`);
    return 1;
  };
  switch (command) {
    case 'sheets':
      return target
        ? sheets(path.resolve(target), line)
        : needsDir('sheets <set-dir>');
    case 'reanalyze':
      return target
        ? reanalyze(path.resolve(target), repoRoot, line)
        : needsDir('reanalyze <set-dir>');
    case 'recorded-facts':
      return target
        ? recorded(path.resolve(target), rest, line)
        : needsDir(
            'recorded-facts <set-dir> --page-fill <file> --page-fill-set <key>'
          );
    case 'calibrate':
      return calibrate(argv.slice(1), repoRoot, line);
    case 'freeze':
      return freeze(argv.slice(1), line);
    case 'verify':
      return verify(argv.slice(1), repoRoot, line);
    default:
      line(
        'usage: pnpm shipping <sheets|reanalyze|recorded-facts|calibrate|freeze|verify> …'
      );
      return 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('shipping-cli.ts')) {
  process.exitCode = await runWithInkLines(
    main,
    process.argv.slice(2).filter((arg) => arg !== '--')
  );
}
