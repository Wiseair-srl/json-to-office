/**
 * The one directory this server is allowed to write to.
 *
 * #204's contract is "no writes outside the root", and the caller names the
 * file. Anything a caller can name, a caller can point somewhere else — so the
 * check has to survive `..`, absolute paths, Windows drive letters and, once
 * the root is a real directory on disk, symlinks planted inside it. Every
 * write therefore goes through `resolveOutputPath`, which answers a path only
 * when it provably lands inside the root.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ERROR_CODES, failure, type Failure } from './errors.js';

/** Env var that names the output root, below the `--output-dir` flag. */
export const OUTPUT_DIR_ENV = 'JTO_MCP_OUTPUT_DIR';

/** Prefix for the per-connection temp root, when nothing else was configured. */
const TEMP_PREFIX = 'jto-mcp-';

export interface OutputRoot {
  /** Absolute path of the root. May not exist on disk until first use. */
  readonly path: string;
  /**
   * True when this root is a temp directory this process invented, and so is
   * safe to delete on shutdown. A configured root is never removed.
   */
  readonly ephemeral: boolean;
  /** Create the root if absent; returns its real (symlink-resolved) path. */
  ensure(): Promise<string>;
  /**
   * Absolute path for `name` inside the root, with parent directories created.
   * Fails structurally rather than throwing — the result is a tool result.
   */
  resolveOutputPath(name: string): Promise<ResolvedOutputPath>;
  /** Remove the root, but only when `ephemeral`. */
  dispose(): Promise<void>;
}

export type ResolvedOutputPath =
  | { ok: true; path: string; relative: string }
  | Failure;

export interface OutputRootOptions {
  /** `--output-dir` value, highest precedence. */
  flagDir?: string;
  /** Defaults to `process.env`; injectable so the precedence is testable. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to `os.tmpdir()`; injectable for the same reason. */
  tmpDir?: string;
}

/**
 * Reject a name before it ever touches the filesystem.
 *
 * Cheap, synchronous and exhaustive about the shapes that cannot possibly be
 * inside the root, so the expensive realpath check below only ever has to
 * worry about symlinks.
 */
export function checkOutputName(name: string): Failure | undefined {
  if (typeof name !== 'string' || name.trim() === '') {
    return failure(
      ERROR_CODES.OUTPUT_ROOT_ESCAPE,
      'Output file name must be a non-empty string.'
    );
  }
  if (name.includes('\0')) {
    return failure(
      ERROR_CODES.OUTPUT_ROOT_ESCAPE,
      'Output file name must not contain NUL.'
    );
  }
  if (path.isAbsolute(name) || path.win32.isAbsolute(name)) {
    return failure(
      ERROR_CODES.OUTPUT_ROOT_ESCAPE,
      `Output file name must be relative to the output root: "${name}".`,
      { suggestion: 'Pass a bare file name, e.g. "report.docx".' }
    );
  }
  // A bare drive-relative path ("C:report.docx") is neither absolute nor
  // rooted, and resolves against that drive's CWD on Windows.
  if (/^[A-Za-z]:/.test(name)) {
    return failure(
      ERROR_CODES.OUTPUT_ROOT_ESCAPE,
      `Output file name must not carry a drive letter: "${name}".`
    );
  }
  const segments = name.split(/[/\\]/);
  if (segments.some((segment) => segment === '..')) {
    return failure(
      ERROR_CODES.OUTPUT_ROOT_ESCAPE,
      `Output file name must not traverse upwards: "${name}".`,
      { suggestion: 'Remove the ".." segments.' }
    );
  }
  return undefined;
}

/** True when `candidate` is `root` itself or lives beneath it. */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
}

/**
 * Create the parent chain of a candidate path, one segment at a time, and
 * answer with the real path of the deepest one.
 *
 * `mkdir -p` over the whole chain is the wrong primitive here: it follows a
 * directory symlink already planted in the root and creates the missing
 * segments on the far side of it. Checking afterwards still refuses the write,
 * but by then the server has made directories at a caller-chosen location
 * outside the root — a side effect a refusal is not supposed to have. So each
 * segment is resolved and checked before the next one is created, and the walk
 * stops at the link rather than building through it.
 *
 * `root` is already a real path, so the walk starts on solid ground and only
 * has to worry about what it finds below.
 */
async function ensureParentInside(
  root: string,
  parentDir: string
): Promise<{ ok: true; path: string } | Failure> {
  let current = root;
  const segments = path
    .relative(root, parentDir)
    .split(path.sep)
    .filter((segment) => segment !== '');

  for (const segment of segments) {
    const next = path.join(current, segment);
    try {
      await fs.mkdir(next);
    } catch (error) {
      // Anything but "already there" is a real filesystem problem — a
      // read-only root, a file where a directory belongs — and belongs to the
      // caller, not to this check.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    // Re-resolved even when we just created it: between the mkdir and here,
    // another process could have swapped the directory for a link.
    const real = await fs.realpath(next);
    if (!isInside(root, real)) {
      return failure(
        ERROR_CODES.OUTPUT_ROOT_ESCAPE,
        `Output path leaves the output root through a symlinked directory: "${segment}".`,
        { context: { outputRoot: root, resolved: real } }
      );
    }
    current = real;
  }

  return { ok: true, path: current };
}

/**
 * Real path of `target` when it already exists, `target` itself when it does
 * not.
 *
 * The overwrite case is the interesting one: an existing artifact path may be
 * a symlink, and a link that stays inside the root is a legitimate place to
 * write — reported as the file actually written, not as the link.
 */
async function realpathIfPresent(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}

/**
 * Resolve the root: `--output-dir`, then `JTO_MCP_OUTPUT_DIR`, then a temp
 * directory of our own.
 *
 * Creation is deferred — a connection that never generates anything should not
 * leave a directory behind — so the temp root's name is decided here but the
 * `mkdir` happens on first use.
 */
export function createOutputRoot(options: OutputRootOptions = {}): OutputRoot {
  const env = options.env ?? process.env;
  const configured = options.flagDir?.trim() || env[OUTPUT_DIR_ENV]?.trim();
  const ephemeral = !configured;
  const rootPath = configured
    ? path.resolve(configured)
    : path.join(
        options.tmpDir ?? os.tmpdir(),
        `${TEMP_PREFIX}${process.pid}-${Date.now().toString(36)}`
      );

  let realRoot: string | undefined;

  async function ensure(): Promise<string> {
    if (realRoot === undefined) {
      await fs.mkdir(rootPath, { recursive: true });
      realRoot = await fs.realpath(rootPath);
    }
    return realRoot;
  }

  return {
    path: rootPath,
    ephemeral,
    ensure,

    async resolveOutputPath(name: string): Promise<ResolvedOutputPath> {
      const rejected = checkOutputName(name);
      if (rejected) return rejected;

      const root = await ensure();
      const candidate = path.resolve(root, name);
      if (!isInside(root, candidate)) {
        return failure(
          ERROR_CODES.OUTPUT_ROOT_ESCAPE,
          `Output path escapes the output root: "${name}".`,
          { context: { outputRoot: root } }
        );
      }

      // The textual check above cannot see symlinks, so the parent chain is
      // built and verified segment by segment before anything is written. The
      // leaf gets resolved too — a link named exactly as the artifact is
      // invisible to a parent-only check, and `writeFile` follows it just as
      // happily as a linked directory.
      const parent = await ensureParentInside(root, path.dirname(candidate));
      if (!parent.ok) return parent;
      const realCandidate = await realpathIfPresent(
        path.join(parent.path, path.basename(candidate))
      );
      if (!isInside(root, realCandidate)) {
        return failure(
          ERROR_CODES.OUTPUT_ROOT_ESCAPE,
          `Output path resolves outside the output root through a symlink: "${name}".`,
          { context: { outputRoot: root, resolved: realCandidate } }
        );
      }

      return {
        ok: true,
        path: realCandidate,
        relative: path.relative(root, realCandidate),
      };
    },

    async dispose(): Promise<void> {
      if (!ephemeral || realRoot === undefined) return;
      await fs.rm(realRoot, { recursive: true, force: true });
      realRoot = undefined;
    },
  };
}
