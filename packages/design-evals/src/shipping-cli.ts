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
 *     tree also renders.
 *
 *   pnpm shipping recorded-facts <set-dir> --page-fill <file> --page-fill-set <key>
 *     Write `<set-dir>/facts.json` from what was recorded when the set was
 *     judged: the run's findings, and its page defects from one page-fill
 *     measurement of the judged renders. For calibration artifacts, which
 *     today's engine would paginate differently.
 *
 *   pnpm shipping calibrate --set <id>=<dir>… --human <file>… --out <file>
 *     Score every candidate definition on the human-labelled artifacts, with
 *     each set's `sitting-<question>.json` judge sittings (`pnpm rejudge <dir>
 *     --question v2 --out <dir>/sitting-v2.json`), and choose one by the
 *     stated rule.
 *
 *   pnpm shipping freeze --calibration <file> [--candidate <id>] --out <file>
 *   pnpm shipping verify --definition <file> --set <id>=<dir> --human <file> --out <file>
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
import { renderForJudging } from './render.js';
import {
  buildEvidence,
  chooseDefinition,
  freezeDefinition,
  humanJudgments,
  humanRepeatability,
  labelArtifacts,
  loadSitting,
  recordedFacts,
  scoreDefinition,
  verifyDefinition,
  type EvidenceSet,
  type FrozenDefinition,
  type HumanRound,
} from './shipping-calibration.js';
import {
  CANDIDATE_DEFINITIONS,
  SHIPPING_QUESTIONS,
  type ShippingQuestionId,
} from './shipping.js';

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
    const result = await renderForJudging(run.format as BriefFormat, document);
    await fs.writeFile(sheet, result.sheet.png);
    rendered += 1;
    line(`  ${run.label}: ${result.totalPages} page(s)`);
  }
  line(`${rendered} contact sheet(s) rendered in ${dir}`);
  return 0;
}

async function reanalyze(
  dir: string,
  repoRoot: string,
  line: Line
): Promise<number> {
  const runs: Record<string, unknown> = {};
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
  return 0;
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

async function loadEvidenceSet(id: string, dir: string): Promise<EvidenceSet> {
  const facts = await readJson<{
    source?: string;
    runs: Record<string, { qualityByCode: Record<string, number> }>;
  }>(path.join(dir, 'facts.json'));
  const sittings: EvidenceSet['sittings'] = {};
  for (const question of Object.keys(
    SHIPPING_QUESTIONS
  ) as ShippingQuestionId[]) {
    const sitting = await loadSitting(
      path.join(dir, `sitting-${question}.json`),
      question
    );
    if (sitting) sittings[question] = sitting;
  }
  return { id, runs: await setRuns(dir), facts: facts.runs, sittings };
}

async function loadRounds(files: readonly string[]): Promise<HumanRound[]> {
  return Promise.all(
    files.map(async (file) => ({
      id: path.basename(file, '.json'),
      file: await readJson<HumanRound['file']>(file),
    }))
  );
}

const SET_AND_HUMAN = {
  set: { type: 'string', multiple: true },
  human: { type: 'string', multiple: true },
  out: { type: 'string' },
} as const;

async function calibrate(
  argv: readonly string[],
  repoRoot: string,
  line: Line
): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: SET_AND_HUMAN });
  const sets = parseSets(values.set);
  const humanFiles = values.human ?? [];
  const out = values.out;
  if (sets.length === 0 || humanFiles.length === 0 || !out) {
    line(
      'usage: pnpm shipping calibrate --set <id>=<dir>… --human <file>… --out <file>'
    );
    return 1;
  }
  const evidenceSets = await Promise.all(
    sets.map((set) => loadEvidenceSet(set.id, set.dir))
  );
  const judgments = humanJudgments(await loadRounds(humanFiles));
  const labels = labelArtifacts(judgments);
  const rows = buildEvidence(evidenceSets, labels);
  const scores = CANDIDATE_DEFINITIONS.map((definition) =>
    scoreDefinition(definition, rows)
  );
  const choice = chooseDefinition(scores, CANDIDATE_DEFINITIONS);

  const manifest = {
    kind: 'shipping-calibration',
    generatedAt: new Date().toISOString(),
    gitSha: gitState(repoRoot).sha,
    questions: SHIPPING_QUESTIONS,
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
    humanRepeatability: humanRepeatability(judgments),
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
      `  ${definition.id.padEnd(16)} n=${String(score.n).padStart(3)} kappa ${score.kappa.toFixed(2)}${interval}` +
        ` agree ${(score.rawAgreement * 100).toFixed(0)}%` +
        ` both-ship ${score.confusion.bothShip} human-only ${score.confusion.humanOnly}` +
        ` definition-only ${score.confusion.definitionOnly} both-hold ${score.confusion.bothHold}`
    );
  }
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
    candidates: Array<{ definition: { id: string }; score: unknown }>;
    choice: { chosen: string; reason: string };
    generatedAt: string;
    gitSha: string;
  }>(calibrationFile);
  const id = values.candidate ?? calibration.choice.chosen;
  const definition = CANDIDATE_DEFINITIONS.find(
    (candidate) => candidate.id === id
  );
  if (!definition) {
    line(`No candidate "${id}".`);
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
    options: { ...SET_AND_HUMAN, definition: { type: 'string' } },
  });
  const definitionFile = values.definition;
  const sets = parseSets(values.set);
  const humanFiles = values.human ?? [];
  const out = values.out;
  if (!definitionFile || sets.length === 0 || humanFiles.length === 0 || !out) {
    line(
      'usage: pnpm shipping verify --definition <file> --set <id>=<dir> --human <file> --out <file>'
    );
    return 1;
  }
  const frozen = await readJson<FrozenDefinition>(definitionFile);
  const evidenceSets = await Promise.all(
    sets.map((set) => loadEvidenceSet(set.id, set.dir))
  );
  const judgments = humanJudgments(await loadRounds(humanFiles));
  const rows = buildEvidence(evidenceSets, labelArtifacts(judgments));
  const result = verifyDefinition(frozen, rows);
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await fs.writeFile(
    out,
    JSON.stringify(
      {
        kind: 'shipping-verification',
        generatedAt: new Date().toISOString(),
        gitSha: gitState(repoRoot).sha,
        definitionFile: path.relative(repoRoot, path.resolve(definitionFile)),
        allocation: {
          sets: sets.map((set) => ({
            id: set.id,
            dir: path.relative(repoRoot, set.dir),
          })),
          human: humanFiles.map((file) =>
            path.relative(repoRoot, path.resolve(file))
          ),
        },
        ...result,
      },
      null,
      2
    )
  );
  const { score } = result;
  line(
    `${result.definition}: n=${score.n} over ${score.clusters} brief(s), kappa ${score.kappa.toFixed(2)}` +
      (score.interval
        ? ` [${score.interval.low.toFixed(2)}, ${score.interval.high.toFixed(2)}]`
        : '') +
      ` — ${result.passed ? 'PASSED' : 'FAILED'} the ${result.target} target`
  );
  for (const [format, entry] of Object.entries(score.byFormat)) {
    line(`  ${format}: n=${entry.n} kappa ${entry.kappa.toFixed(2)}`);
  }
  line(out);
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
