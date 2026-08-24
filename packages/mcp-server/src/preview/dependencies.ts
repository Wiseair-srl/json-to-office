/**
 * The two host binaries a preview cannot do without.
 *
 * `jto_info` already answers "is LibreOffice here"; this module reuses that
 * probe rather than growing a second one that could disagree with it — an
 * agent that was told preview is available and then gets told it is not has
 * learned nothing it can act on. What is added here is the part `jto_info`
 * deliberately skips: actually running the binaries. `jto_info` is a discovery
 * call made on every connection and a cold `soffice --version` costs about a
 * second, so it settles for a PATH walk and defers the rest to a real render.
 * This is that real render, and it needs the versions anyway — they are part
 * of the cache key, because a LibreOffice upgrade is a different renderer.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';

import { ERROR_CODES, failure, type Failure } from '../lib/errors.js';
import {
  pdftoppmCandidates,
  probeBinary,
  sofficeCandidates,
  type HostBinaryStatus,
} from '../tools/info.js';

const VERSION_TIMEOUT_MS = 15000;

export interface PreviewDependencies {
  libreoffice: HostBinaryStatus;
  pdftoppm: HostBinaryStatus;
}

/** Injectable so the missing-dependency path is testable on a host that has both. */
export type DependencyProbe = () => Promise<PreviewDependencies>;

export const probePreviewDependencies: DependencyProbe = async () => {
  const [libreoffice, pdftoppm] = await Promise.all([
    probeBinary(sofficeCandidates(), 'LIBREOFFICE_PATH'),
    probeBinary(pdftoppmCandidates(), 'PDFTOPPM_PATH'),
  ]);
  return { libreoffice, pdftoppm };
};

/** Per-platform install line, so the refusal ends in something runnable. */
function installHint(): string {
  switch (process.platform) {
    case 'darwin':
      return 'brew install --cask libreoffice && brew install poppler';
    case 'win32':
      return 'winget install TheDocumentFoundation.LibreOffice; winget install oschwartz10612.Poppler';
    default:
      return 'sudo apt-get install libreoffice poppler-utils (or your distribution’s equivalent)';
  }
}

/**
 * The structured refusal for a host that cannot render, or undefined when it can.
 *
 * Names what is missing, where it was looked for, which env var overrides the
 * search and how to install it — everything an agent needs to tell a human
 * exactly one thing to do. Never a protocol error: the server is fine, this
 * host simply lacks an optional dependency, and every other tool still works.
 */
export function missingDependencyFailure(
  dependencies: PreviewDependencies
): Failure | undefined {
  const missing: string[] = [];
  if (!dependencies.libreoffice.available)
    missing.push('LibreOffice (soffice)');
  if (!dependencies.pdftoppm.available) missing.push('poppler (pdftoppm)');
  if (missing.length === 0) return undefined;

  return failure(
    ERROR_CODES.DEPENDENCY_MISSING,
    `jto_preview renders through LibreOffice and poppler; this host is missing ${missing.join(' and ')}.`,
    {
      suggestion: `Install them (${installHint()}), or point the server at existing binaries with LIBREOFFICE_PATH / PDFTOPPM_PATH. Validation, generation and diff do not need either.`,
      context: {
        missing,
        libreoffice: dependencies.libreoffice,
        pdftoppm: dependencies.pdftoppm,
      },
    }
  );
}

/**
 * Version identity of one binary: its own version line plus its size and
 * mtime.
 *
 * The version line alone would be enough if every build reported one, and the
 * stat alone would be enough if binaries were never rebuilt in place. Together
 * they change whenever the converter does, which is all the cache key needs —
 * and the readable half is what gets reported next to the pixels so a caller
 * can tell which LibreOffice produced them.
 */
async function binaryIdentity(
  binary: string,
  args: string[],
  signal?: AbortSignal
): Promise<{ identity: string; version?: string }> {
  const [version, stat] = await Promise.all([
    readVersion(binary, args, signal),
    fs.stat(binary).catch(() => undefined),
  ]);
  const identity = [
    version ?? 'unknown',
    stat ? `${stat.size}:${stat.mtimeMs}` : 'nostat',
  ].join('|');
  return { identity, ...(version !== undefined && { version }) };
}

function readVersion(
  binary: string,
  args: string[],
  signal?: AbortSignal
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      {
        timeout: VERSION_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        ...(signal && { signal }),
      },
      (error, stdout, stderr) => {
        // pdftoppm prints its version to stderr and exits non-zero for `-v`,
        // so neither the exit code nor the stream choice can be assumed.
        const text = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
        const line = text.split('\n')[0]?.trim();
        if (!line && error) return resolve(undefined);
        resolve(line || undefined);
      }
    );
  });
}

export interface ConverterVersions {
  /** Cache-key material: opaque, changes whenever a converter does. */
  identities: Record<string, string>;
  /** Human-readable, reported next to the rendered pages. */
  libreoffice?: string;
  pdftoppm?: string;
}

/**
 * Memoized per resolved path: the binaries do not change while the server
 * runs, and a cold `soffice --version` is a second nobody should pay twice.
 */
const identityCache = new Map<string, { identity: string; version?: string }>();

export async function readConverterVersions(
  dependencies: PreviewDependencies,
  signal?: AbortSignal
): Promise<ConverterVersions> {
  const soffice = dependencies.libreoffice.path;
  const pdftoppm = dependencies.pdftoppm.path;
  if (!soffice || !pdftoppm) {
    // Only reachable when a caller skipped `missingDependencyFailure`; the key
    // still has to be well-defined rather than throw here.
    return { identities: { libreoffice: 'absent', pdftoppm: 'absent' } };
  }

  const [office, poppler] = await Promise.all([
    memoized(soffice, ['--version'], signal),
    memoized(pdftoppm, ['-v'], signal),
  ]);

  return {
    identities: { libreoffice: office.identity, pdftoppm: poppler.identity },
    ...(office.version !== undefined && { libreoffice: office.version }),
    ...(poppler.version !== undefined && { pdftoppm: poppler.version }),
  };
}

async function memoized(
  binary: string,
  args: string[],
  signal?: AbortSignal
): Promise<{ identity: string; version?: string }> {
  const cached = identityCache.get(binary);
  if (cached) return cached;
  const identity = await binaryIdentity(binary, args, signal);
  identityCache.set(binary, identity);
  return identity;
}

/** Drop the memoized identities. Tests use this to isolate. */
export function resetConverterVersions(): void {
  identityCache.clear();
}
