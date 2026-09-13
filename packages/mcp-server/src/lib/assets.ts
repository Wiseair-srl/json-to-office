/**
 * Image files a document names, checked the way generation will need them.
 *
 * A path is a plain string to the schema, so a document naming a file that is
 * not there validated clean and then failed the render — as `E_INTERNAL`, the
 * code this server keeps for its own bugs, because what escaped was an unnamed
 * `Error` from wherever the bytes were first wanted: the DOCX image loader,
 * pptxgenjs at write time, `fs` itself. None of those carries a pointer or a
 * code to classify. The document carries both: it says which image named the
 * file, and where.
 *
 * One check, three callers. `jto_validate` reports it; `jto_generate` and
 * `jto_preview` ask it when a render fails, so the failure comes back as the
 * finding validation would have given, at the same pointer.
 *
 * The verdict mirrors what generation does with each image, which differs by
 * where the image sits:
 * - A DOCX image fails the build (`E_ASSET_UNREADABLE`), except directly in a
 *   table cell, which draws a text placeholder instead (`W_ASSET_UNREADABLE`).
 * - PPTX never reads a file outside `baseDir` or the working directory: it
 *   drops the image and warns, and that warning — the core's own
 *   `W_IMAGE_PATH_OUTSIDE_ROOTS` — is the answer here too. A file inside them
 *   that is not there fails the build. A DOCX raster `visual` is a PPTX slide,
 *   so the images on it follow PPTX.
 *
 * Remote URLs and data URIs are not checked: one needs the network, and the
 * other is already in the document.
 */

import { constants, promises as fs } from 'fs';
import path from 'path';

import type { FormatName } from './adapters.js';
import {
  ERROR_CODES,
  diagnostic,
  normalizeWarningCode,
  type Diagnostic,
} from './errors.js';

/** `core-pptx`'s warning for an image path it will not read. */
const OUTSIDE_ROOTS = 'IMAGE_PATH_OUTSIDE_ROOTS';

export interface AssetCheckOptions {
  /** What relative paths resolve against, exactly as generation takes it. */
  baseDir?: string;
}

/** One image source that is a local path, and whose pipeline will read it. */
interface ImageReference {
  /** JSON Pointer to the path value itself: the patch target. */
  pointer: string;
  value: string;
  rules: FormatName;
  /** A DOCX table cell draws a missing image as text rather than failing. */
  placeholder: boolean;
}

type Unreadable = 'missing' | 'not-a-file' | 'unreadable';

/** A DOCX table cell's content: the one place a missing image does not fail. */
const TABLE_CELL_CONTENT =
  /\/props\/columns\/\d+\/(?:cells\/\d+|header)\/content$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const hasValue = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * The file an image source reads, when it reads one.
 *
 * Both cores resolve `svg`, then `base64`, then `path`, and count a blank
 * value as absent — so a `path` beside either of the others is never read.
 */
function localPath(source: Record<string, unknown>): string | undefined {
  if (hasValue(source.svg) || hasValue(source.base64)) return undefined;
  if (!hasValue(source.path)) return undefined;
  return /^(https?:\/\/|data:)/i.test(source.path) ? undefined : source.path;
}

function escapeSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Every image source in the document that names a local file.
 *
 * Walked generically rather than by component, because images sit in more
 * places than `children` — headers, footers, table cells, block slots, visual
 * elements — and a walk that knew the list would drift from it. What it does
 * know is what generation skips: a disabled component, and the block
 * definitions under `props.blocks`, which are templates rather than content.
 */
function collect(
  node: unknown,
  pointer: string,
  rules: FormatName,
  out: ImageReference[]
): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      collect(child, `${pointer}/${index}`, rules, out)
    );
    return;
  }
  if (!isRecord(node)) return;
  if (typeof node.name === 'string' && node.enabled === false) return;

  const props = isRecord(node.props) ? node.props : undefined;
  if (node.name === 'image' && props) {
    const value = localPath(props);
    if (value !== undefined) {
      out.push({
        pointer: `${pointer}/props/path`,
        value,
        rules,
        placeholder: rules === 'docx' && TABLE_CELL_CONTENT.test(pointer),
      });
    }
  }

  // A slide background, or a visual's canvas. On a slide a colour or a
  // gradient beside the image wins and the image is never read, so either one
  // ends the question there.
  if (
    pointer.endsWith('/background') &&
    isRecord(node.image) &&
    !node.color &&
    !node.gradient
  ) {
    const value = localPath(node.image);
    if (value !== undefined) {
      out.push({
        pointer: `${pointer}/image/path`,
        value,
        rules,
        placeholder: false,
      });
    }
  }

  const inner: FormatName =
    rules === 'docx' && node.name === 'visual' && props?.renderMode !== 'native'
      ? 'pptx'
      : rules;
  for (const [key, value] of Object.entries(node)) {
    const child = `${pointer}/${escapeSegment(key)}`;
    if (child === '/props/blocks') continue;
    collect(value, child, inner, out);
  }
}

/**
 * Whether the PPTX pipeline reads `resolved` at all.
 *
 * `core-pptx`'s `isAllowedLocalPath`, restated: under `baseDir` when one is
 * given, or under the working directory. Restated rather than imported
 * because the core reads its base directory from a generation scope; the gate
 * agreement suite renders the same paths to keep the two honest.
 */
function insidePptxRoots(
  resolved: string,
  baseDir: string | undefined
): boolean {
  const roots =
    baseDir === undefined
      ? [process.cwd()]
      : [path.resolve(baseDir), process.cwd()];
  return roots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
}

async function readability(resolved: string): Promise<Unreadable | undefined> {
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return 'not-a-file';
    await fs.access(resolved, constants.R_OK);
    return undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable';
  }
}

function unreadableImage(
  reference: ImageReference,
  resolved: string,
  reason: Unreadable,
  baseDir: string | undefined
): Diagnostic {
  const { value } = reference;
  const subject = reason === 'not-a-file' ? 'Image path' : 'Image file';
  const where = resolved === value ? '' : ` (${resolved})`;
  const state =
    reason === 'missing'
      ? 'does not exist'
      : reason === 'not-a-file'
        ? 'is not a file'
        : 'cannot be read';
  const outcome = reference.placeholder
    ? ' The table cell will show a text placeholder instead of the picture.'
    : '';
  const resolution = path.isAbsolute(value)
    ? ''
    : baseDir === undefined
      ? ' Relative paths resolve against the server working directory unless you pass `baseDir` — the same one you generate with.'
      : ' Relative paths resolve against `baseDir`.';
  return diagnostic(
    reference.placeholder
      ? ERROR_CODES.ASSET_UNREADABLE_ADVISORY
      : ERROR_CODES.ASSET_UNREADABLE,
    `${subject} "${value}"${where} ${state}.${outcome}`,
    {
      severity: reference.placeholder ? 'warning' : 'error',
      path: reference.pointer,
      suggestion: `Point it at an existing file, or embed the image as base64.${resolution}`,
      context: {
        value,
        resolved,
        reason,
        ...(baseDir !== undefined && { baseDir }),
      },
    }
  );
}

function outsideRoots(
  reference: ImageReference,
  resolved: string,
  baseDir: string | undefined
): Diagnostic {
  return diagnostic(
    normalizeWarningCode(OUTSIDE_ROOTS),
    `Image path resolves outside the document base directory: ${reference.value}. Generation drops the image.`,
    {
      severity: 'warning',
      path: reference.pointer,
      suggestion:
        baseDir === undefined
          ? 'Keep the file under the server working directory, or pass `baseDir` naming the folder it is in; or embed the image as base64.'
          : 'Keep the file under `baseDir` or the server working directory, or embed the image as base64.',
      context: { code: OUTSIDE_ROOTS, value: reference.value, resolved },
    }
  );
}

/** Every image file the document names that generation cannot use, in document order. */
export async function assetDiagnostics(
  format: FormatName,
  document: unknown,
  options: AssetCheckOptions = {}
): Promise<Diagnostic[]> {
  const references: ImageReference[] = [];
  collect(document, '', format, references);
  if (references.length === 0) return [];

  const { baseDir } = options;
  // A template reuses one picture a dozen times; each file is asked once.
  const checked = new Map<string, Promise<Unreadable | undefined>>();
  const found = await Promise.all(
    references.map(async (reference) => {
      const resolved =
        baseDir === undefined
          ? path.resolve(reference.value)
          : path.resolve(baseDir, reference.value);
      if (reference.rules === 'pptx' && !insidePptxRoots(resolved, baseDir)) {
        return outsideRoots(reference, resolved, baseDir);
      }
      let pending = checked.get(resolved);
      if (pending === undefined) {
        pending = readability(resolved);
        checked.set(resolved, pending);
      }
      const reason = await pending;
      return reason === undefined
        ? undefined
        : unreadableImage(reference, resolved, reason, baseDir);
    })
  );
  return found.filter((entry): entry is Diagnostic => entry !== undefined);
}

/**
 * Only the images generation fails over — what explains a render that threw.
 *
 * Empty when there are none, which is the caller's cue that the failure was
 * something else.
 */
export async function assetFailures(
  format: FormatName,
  document: unknown,
  options: AssetCheckOptions = {}
): Promise<Diagnostic[]> {
  return (await assetDiagnostics(format, document, options)).filter(
    (entry) => entry.severity === 'error'
  );
}
