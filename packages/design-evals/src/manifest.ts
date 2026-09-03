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

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const UNAVAILABLE = 'unavailable';

export interface RunManifest {
  gitSha: string;
  /** True when the tree had uncommitted changes: the SHA does not describe it. */
  gitDirty: boolean;
  packageVersions: Record<string, string>;
  agentSdkVersion: string;
  /** The exact model identifier the runs were made with. */
  model: string;
  modelParameters: Record<string, unknown>;
  /** SHA-256 of the server instructions the agent was given. */
  serverInstructionsHash: string;
  /** SHA-256 of the skill, or `none` for a cold run. */
  skillHash: string;
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

function run(command: string, args: readonly string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
    }).trim();
  } catch {
    return UNAVAILABLE;
  }
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
  model: string;
  modelParameters: Record<string, unknown>;
  serverInstructions: string;
  /** The skill text an assisted run was given; omit for a cold run. */
  skill?: string;
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

  return {
    gitSha: git.sha,
    gitDirty: git.dirty,
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
    skillHash: input.skill === undefined ? 'none' : sha256(input.skill),
    mode: input.mode,
    os: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
    },
    node: process.version,
    libreoffice: input.libreofficePath
      ? run(input.libreofficePath, ['--version'])
      : UNAVAILABLE,
    poppler: input.pdftoppmPath ? run(input.pdftoppmPath, ['-v']) : UNAVAILABLE,
    fonts: fontInventory(),
    exportServer: {
      endpointClass: endpointClass(input.exportServerUrl),
      version: UNAVAILABLE,
    },
    maxRetries: input.maxRetries,
  };
}
