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
 *     write `<set-dir>/reanalysis.json`. Rules changed between the recorded
 *     sets; a definition that reads page defects must read them from one
 *     analyzer, for calibration and verification alike.
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

import { analyzeDocument } from './analyze.js';
import { gitState } from './manifest.js';
import { documentMetrics } from './metrics.js';
import { comparableRuns, type RecordedRun } from './rejudge.js';
import { renderForJudging } from './render.js';
import {
  buildEvidence,
  chooseDefinition,
  freezeDefinition,
  humanJudgments,
  humanRepeatability,
  labelArtifacts,
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

function line(text: string): void {
  process.stderr.write(`${text}\n`);
}

function values(argv: readonly string[], name: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${name}` && argv[index + 1] !== undefined) {
      found.push(argv[index + 1]);
      index += 1;
    }
  }
  return found;
}

const one = (argv: readonly string[], name: string): string | undefined =>
  values(argv, name)[0];

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

interface SetRun {
  label: string;
  briefId: string;
  format: string;
  outcome: 'completed' | 'failed';
}

/** The runs of a set, labelled the way the runner wrote their directories. */
async function setRuns(dir: string): Promise<SetRun[]> {
  const scorecard = await readJson<{
    runs: Array<
      RecordedRun & { format: string; outcome: 'completed' | 'failed' }
    >;
  }>(path.join(dir, 'scorecard.json'));
  return comparableRuns(scorecard.runs).map((run) => {
    const record = run as unknown as {
      format: string;
      outcome: 'completed' | 'failed';
    };
    return {
      label: run.label,
      briefId: run.briefId,
      format: record.format,
      outcome: record.outcome,
    };
  });
}

async function sheets(dir: string): Promise<number> {
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
    const result = await renderForJudging(
      run.format as 'docx' | 'pptx',
      document
    );
    await fs.writeFile(sheet, result.sheet.png);
    rendered += 1;
    line(`  ${run.label}: ${result.totalPages} page(s)`);
  }
  line(`${rendered} contact sheet(s) rendered in ${dir}`);
  return 0;
}

async function reanalyze(dir: string, repoRoot: string): Promise<number> {
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
      diagnostics: measured.diagnostics as never,
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
  const out = path.join(dir, 'reanalysis.json');
  await fs.writeFile(
    out,
    JSON.stringify(
      {
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

/** `<id>=<dir>` pairs, as `--set` takes them. */
function parseSets(
  argv: readonly string[]
): Array<{ id: string; dir: string }> {
  return values(argv, 'set').map((entry) => {
    const at = entry.indexOf('=');
    if (at <= 0) throw new Error(`--set takes <id>=<dir>, not "${entry}".`);
    return { id: entry.slice(0, at), dir: path.resolve(entry.slice(at + 1)) };
  });
}

async function loadEvidenceSet(id: string, dir: string): Promise<EvidenceSet> {
  const reanalysis = await readJson<{
    runs: Record<string, { qualityByCode: Record<string, number> }>;
  }>(path.join(dir, 'reanalysis.json'));
  const sittings: EvidenceSet['sittings'] = {};
  for (const question of Object.keys(
    SHIPPING_QUESTIONS
  ) as ShippingQuestionId[]) {
    const file = path.join(dir, `sitting-${question}.json`);
    if (!(await exists(file))) continue;
    const report = await readJson<{
      question?: string;
      runs: Array<{
        run?: string;
        briefId: string;
        now?: { level: number; wouldShip: boolean };
      }>;
    }>(file);
    if ((report.question ?? 'v1') !== question) {
      throw new Error(
        `${file} was judged with question ${report.question}, not ${question}.`
      );
    }
    sittings[question] = Object.fromEntries(
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
  return {
    id,
    runs: await setRuns(dir),
    reanalysis: reanalysis.runs,
    sittings,
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

async function calibrate(
  argv: readonly string[],
  repoRoot: string
): Promise<number> {
  const sets = parseSets(argv);
  const humanFiles = values(argv, 'human');
  const out = one(argv, 'out');
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

async function freeze(argv: readonly string[]): Promise<number> {
  const calibrationFile = one(argv, 'calibration');
  const out = one(argv, 'out');
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
  const id = one(argv, 'candidate') ?? calibration.choice.chosen;
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
  repoRoot: string
): Promise<number> {
  const definitionFile = one(argv, 'definition');
  const sets = parseSets(argv);
  const humanFiles = values(argv, 'human');
  const out = one(argv, 'out');
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

export async function main(argv: readonly string[]): Promise<number> {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..'
  );
  const [command, ...rest] = argv;
  switch (command) {
    case 'sheets':
      return rest[0]
        ? sheets(path.resolve(rest[0]))
        : (line('usage: pnpm shipping sheets <set-dir>'), 1);
    case 'reanalyze':
      return rest[0]
        ? reanalyze(path.resolve(rest[0]), repoRoot)
        : (line('usage: pnpm shipping reanalyze <set-dir>'), 1);
    case 'calibrate':
      return calibrate(rest, repoRoot);
    case 'freeze':
      return freeze(rest);
    case 'verify':
      return verify(rest, repoRoot);
    default:
      line('usage: pnpm shipping <sheets|reanalyze|calibrate|freeze|verify> …');
      return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2).filter((arg) => arg !== '--'))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      line(
        error instanceof Error ? error.stack ?? error.message : String(error)
      );
      process.exitCode = 1;
    });
}
