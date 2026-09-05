/**
 * What it would take to reproduce a run set.
 *
 * A scorecard without this is a number with no denominator in time: the model
 * moved, LibreOffice moved, the fonts on the host moved, and the delta between
 * two runs measures all of it at once. Every field here is something that has
 * silently changed a result at least once in this project's history, so the
 * manifest is mandatory and a missing field is reported rather than omitted.
 *
 * When a field cannot be read, it is recorded as `unavailable` instead of
 * being dropped. A manifest with a hole in it is still a manifest; a manifest
 * that quietly shrank is a comparison waiting to mislead.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const UNAVAILABLE = 'unavailable';

export interface RunManifest {
  gitSha: string;
  /** True when the tree had uncommitted changes: the SHA does not describe it. */
  gitDirty: boolean;
  /** The revision the FIRST brief started against. */
  gitShaAtStart: string;
  /** Identity of the compiled workspace when the first brief started. */
  buildFingerprintAtStart: string;
  /** The same, after the last brief finished. */
  buildFingerprint: string;
  /**
   * False when the revision or the compiled output moved while briefs were in
   * flight — which makes the set a mixture of two products rather than a
   * measurement of one.
   *
   * This is not hypothetical. A variance run of six briefs shared a working
   * tree with another session that landed a feature and rebuilt at minute 58;
   * the twelve pptx briefs already measured were pre-change, the six docx
   * briefs after it died with `does not provide an export named ...` because
   * the process still held the old `@json-to-office/quality` in its module
   * graph, and the manifest — built at the END of the run — recorded only the
   * final SHA and looked perfectly clean. Seventy-six minutes of runs, and the
   * only evidence that anything was wrong was a mtime.
   */
  treeStableDuringRun: boolean;
  packageVersions: Record<string, string>;
  agentSdkVersion: string;
  /** The exact model identifier the runs were made with. */
  model: string;
  modelParameters: Record<string, unknown>;
  /** SHA-256 of the server instructions the agent was given. */
  serverInstructionsHash: string;
  /** SHA-256 of the skill bundle, or `none` for a cold run. */
  skillHash: string;
  /** Name and version of the skill an assisted run carried. */
  skillName?: string;
  skillVersion?: string;
  /**
   * `bundle` when the whole skill directory was inlined, `file` when only one
   * document was. A `file` run carried the workflow and none of the taste, and
   * understates the ceiling it is supposed to measure.
   */
  skillMode?: 'bundle' | 'file';
  /** Files the bundle contributed, so a ceiling can be audited. */
  skillFiles?: string[];
  /**
   * What the skill ships and the run did not get — templates, scripts, media.
   * An assisted run with no file tools measures the skill's guidance, not its
   * machinery, and this says how much machinery was left out.
   */
  skillExcluded?: { files: number; bytes: number };
  mode: 'cold' | 'assisted';
  os: { platform: string; release: string; arch: string };
  node: string;
  libreoffice: string;
  poppler: string;
  /** Font families staged for the runs, sorted. */
  fonts: string[];
  exportServer: {
    /** `local`, `private` or `hosted` — what left the machine. */
    endpointClass: 'local' | 'private' | 'hosted' | 'none';
    version: string;
  };
  /** Retries the runner was allowed per brief. */
  maxRetries: number;
}

/**
 * A command's stdout, or `unavailable` when it failed.
 *
 * Strict: a non-zero exit means the answer is not usable. Used for commands
 * whose output is DATA — `git rev-parse`, `git status` — where a stderr
 * message is an error to report as absence, not a value to record.
 */
function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error || result.status !== 0) return UNAVAILABLE;
  return (result.stdout ?? '').trim() || UNAVAILABLE;
}

/**
 * A tool's version banner, from whichever stream it prints on.
 *
 * Deliberately more tolerant than `run`: `pdftoppm -v` writes its version to
 * stderr, and `execFileSync` discards that — so poppler was recorded as
 * `unavailable` on a host that had just rendered forty documents with it.
 * Several tools also print a version and exit non-zero, which is not the same
 * as being absent.
 */
function probeVersion(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (result.error) return UNAVAILABLE;
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return text === '' ? UNAVAILABLE : (text.split('\n')[0] as string).trim();
}

/**
 * A cheap identity for the COMPILED workspace.
 *
 * Runs import the built packages, not the sources, so a git SHA does not say
 * what the agent actually talked to: `pnpm build` between two runs of the same
 * commit changes the product and nothing in git. Size and mtime of each
 * package's entry point are enough — the question is only ever "did this move
 * while I was measuring", never "what exactly changed".
 */
export function buildFingerprint(repoRoot: string): string {
  const packagesDir = path.join(repoRoot, 'packages');
  const parts: string[] = [];
  let names: string[];
  try {
    names = readdirSync(packagesDir).sort();
  } catch {
    return UNAVAILABLE;
  }
  for (const name of names) {
    const entry = path.join(packagesDir, name, 'dist', 'index.js');
    try {
      const stat = statSync(entry);
      parts.push(`${name}:${stat.size}:${Math.round(stat.mtimeMs)}`);
    } catch {
      // A package with no dist is not built; its absence is part of the state.
      parts.push(`${name}:absent`);
    }
  }
  return sha256(parts.join('\n'));
}

/** Revision plus compiled identity — everything that makes a run reproducible. */
export interface TreeState {
  gitSha: string;
  buildFingerprint: string;
}

export function treeState(repoRoot: string): TreeState {
  return {
    gitSha: gitState(repoRoot).sha,
    buildFingerprint: buildFingerprint(repoRoot),
  };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function gitState(cwd: string): { sha: string; dirty: boolean } {
  const sha = run('git', ['-C', cwd, 'rev-parse', 'HEAD']);
  const status = run('git', ['-C', cwd, 'status', '--porcelain']);
  return {
    sha,
    dirty: status !== UNAVAILABLE && status !== '',
  };
}

/**
 * Every family the host can actually paint, by name.
 *
 * The list, not a hash: a font that is present on one machine and absent on
 * another is the single most common reason two runs of the same brief look
 * different, and "the inventories differ" is not an answer to which one.
 */
export function fontInventory(): string[] {
  const directories = [
    path.join(os.homedir(), 'Library/Fonts'),
    '/Library/Fonts',
    '/System/Library/Fonts',
    path.join(os.homedir(), '.local/share/fonts'),
    '/usr/share/fonts',
    'C:\\Windows\\Fonts',
  ];
  const families = new Set<string>();
  const walk = (directory: string, depth: number): void => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/\.(ttf|otf|ttc|woff2?)$/i.test(entry.name)) {
        families.add(entry.name.replace(/\.[^.]+$/, ''));
      }
    }
  };
  for (const directory of directories) walk(directory, 0);
  return [...families].sort();
}

function packageVersion(packageJsonPath: string): string {
  try {
    return (
      (
        JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
          version?: string;
        }
      ).version ?? UNAVAILABLE
    );
  } catch {
    return UNAVAILABLE;
  }
}

export interface ManifestInput {
  repoRoot: string;
  /**
   * The tree as it was before the first brief ran. Optional only so a caller
   * that genuinely cannot capture it still gets a manifest; when it is absent
   * the manifest says the run was stable because it has nothing to compare,
   * which is the weaker claim and is labelled as such by the two identical
   * `AtStart` fields.
   */
  atStart?: TreeState;
  model: string;
  modelParameters: Record<string, unknown>;
  serverInstructions: string;
  /** The skill an assisted run was given; omit for a cold run. */
  skill?: {
    text: string;
    name: string;
    version: string;
    files: string[];
    hash: string;
    mode: 'bundle' | 'file';
    excluded?: { files: number; bytes: number };
  };
  mode: 'cold' | 'assisted';
  libreofficePath?: string;
  pdftoppmPath?: string;
  exportServerUrl?: string;
  maxRetries: number;
  agentSdkVersion: string;
}

/** Which network the chart data would cross, from the endpoint alone. */
export function endpointClass(
  url: string | undefined
): RunManifest['exportServer']['endpointClass'] {
  if (!url) return 'none';
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'hosted';
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return 'local';
  }
  // RFC 1918 and .local: reachable only from a network the operator controls.
  if (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return 'private';
  }
  return 'hosted';
}

export function buildManifest(input: ManifestInput): RunManifest {
  const git = gitState(input.repoRoot);
  const packages = [
    'mcp-server',
    'core-docx',
    'core-pptx',
    'quality',
    'jto-ops',
  ];

  const fingerprint = buildFingerprint(input.repoRoot);
  const atStart = input.atStart ?? {
    gitSha: git.sha,
    buildFingerprint: fingerprint,
  };

  return {
    gitSha: git.sha,
    gitDirty: git.dirty,
    gitShaAtStart: atStart.gitSha,
    buildFingerprintAtStart: atStart.buildFingerprint,
    buildFingerprint: fingerprint,
    treeStableDuringRun:
      atStart.gitSha === git.sha && atStart.buildFingerprint === fingerprint,
    packageVersions: Object.fromEntries(
      packages.map((name) => [
        `@json-to-office/${name}`,
        packageVersion(
          path.join(input.repoRoot, 'packages', name, 'package.json')
        ),
      ])
    ),
    agentSdkVersion: input.agentSdkVersion,
    model: input.model,
    modelParameters: input.modelParameters,
    serverInstructionsHash: sha256(input.serverInstructions),
    skillHash: input.skill === undefined ? 'none' : input.skill.hash,
    ...(input.skill && {
      skillName: input.skill.name,
      skillVersion: input.skill.version,
      skillMode: input.skill.mode,
      skillFiles: input.skill.files,
      ...(input.skill.excluded && { skillExcluded: input.skill.excluded }),
    }),
    mode: input.mode,
    os: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
    },
    node: process.version,
    // Resolved from PATH when no explicit path is given, the same way the
    // preview pipeline resolves them. The first baseline recorded
    // `unavailable` for both while every page count in it came from a real
    // render — a manifest claiming the run had no renderer is worse than one
    // with a hole in it, because it looks complete.
    libreoffice: probeVersion(input.libreofficePath ?? 'soffice', [
      '--version',
    ]),
    poppler: probeVersion(input.pdftoppmPath ?? 'pdftoppm', ['-v']),
    fonts: fontInventory(),
    exportServer: {
      endpointClass: endpointClass(input.exportServerUrl),
      version: UNAVAILABLE,
    },
    maxRetries: input.maxRetries,
  };
}
