/**
 * Image source resolution (PPTX)
 *
 * Resolves the three mutually-exclusive image sources into a single string that
 * can be probed and handed to pptxgenjs. Precedence mirrors core-docx:
 * `svg > base64 > path`. Raw SVG markup is wrapped into an `image/svg+xml`
 * data URI so it embeds as a vector (PowerPoint 2016+).
 */
import path from 'node:path';
import { getBaseDir, resolveFromBaseDir } from './baseDirContext';

/** A source field counts only when it carries a non-empty (non-whitespace) value. */
const hasValue = (v?: string): v is string =>
  typeof v === 'string' && v.trim().length > 0;

export function resolveImageSource(props: {
  svg?: string;
  base64?: string;
  path?: string;
}): string | undefined {
  if (hasValue(props.svg)) {
    const encoded = Buffer.from(props.svg, 'utf-8').toString('base64');
    return `data:image/svg+xml;base64,${encoded}`;
  }
  // Mirror the conflict-validator predicate: blank base64/path are treated as
  // absent, so a whitespace-only value can't shadow a real later source.
  if (hasValue(props.base64)) return props.base64;
  if (hasValue(props.path)) return props.path;
  return undefined;
}

/**
 * Local files must live under the document base directory (when set) or CWD —
 * path-traversal guard (#142). `resolved` must already be absolute.
 */
export function isAllowedLocalPath(resolved: string): boolean {
  const baseDir = getBaseDir();
  const allowedRoots = baseDir ? [baseDir, process.cwd()] : [process.cwd()];
  return allowedRoots.some(
    (root) => resolved.startsWith(root + path.sep) || resolved === root
  );
}

/**
 * Resolve a source string that may be a URL, data URI, or local file path:
 * URLs and data URIs pass through; local paths resolve against the active
 * document base directory when the generation scope set one, eagerly —
 * pptxgenjs reads `path` entries during write(), outside the generation
 * scope. Returns `undefined` when a local path escapes the allowed roots, so
 * out-of-root paths never reach pptxgenjs (#142).
 */
export function safeLocalPath(source: string): string | undefined {
  if (/^(https?:\/\/|data:)/.test(source)) return source;
  const resolved = path.resolve(resolveFromBaseDir(source));
  return isAllowedLocalPath(resolved) ? resolved : undefined;
}
