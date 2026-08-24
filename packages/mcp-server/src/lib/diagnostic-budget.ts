/**
 * What a tool is allowed to say back, and in how many words.
 *
 * One wrong prop repeated down sixty paragraphs is sixty near-identical
 * diagnostics: the same code, the same message, a different index. An agent
 * pays for every one of them and learns the same fact once, so the repeats
 * collapse into an occurrence count on the first and the survivors are capped.
 *
 * `jto_validate` grew the cap first and still carries its own copy; both should
 * end up here once that file is free to edit.
 */

import { type Diagnostic } from './errors.js';

/** Cap applied when the caller names none. */
export const DEFAULT_MAX_DIAGNOSTICS = 100;

/** Advertised bound, so every tool's `maxDiagnostics` means the same thing. */
export const MAX_DIAGNOSTICS_LIMIT = 1000;

const SEVERITY_RANK: Record<Diagnostic['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Collapse repeats of one defect into the first occurrence.
 *
 * Code and message together identify the defect; the path is what varies, so
 * the first one is kept as the place to look and the rest become a count. A
 * defect that occurred once is returned untouched — an `occurrences: 1` on
 * every diagnostic would be noise on the common case.
 */
function deduplicate(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const byDefect = new Map<string, { entry: Diagnostic; count: number }>();
  for (const entry of diagnostics) {
    const key = `${entry.severity} ${entry.code} ${entry.message}`;
    const seen = byDefect.get(key);
    if (seen) seen.count += 1;
    else byDefect.set(key, { entry, count: 1 });
  }
  return [...byDefect.values()].map(({ entry, count }) =>
    count === 1
      ? entry
      : { ...entry, context: { ...entry.context, occurrences: count } }
  );
}

/**
 * Deduplicate, then cap without losing the fatal entries.
 *
 * A document with a hundred style warnings and one structural error would
 * otherwise report the warnings and drop the only thing that stops it
 * rendering. The sort is stable, so document order survives within each band.
 */
export function condenseDiagnostics(
  diagnostics: readonly Diagnostic[],
  limit: number = DEFAULT_MAX_DIAGNOSTICS
): { kept: Diagnostic[]; truncated: boolean } {
  const unique = deduplicate(diagnostics);
  if (unique.length <= limit) return { kept: unique, truncated: false };
  const ordered = [...unique].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
  return { kept: ordered.slice(0, limit), truncated: true };
}

/** The `maxDiagnostics` input property, spelled once for every tool that caps. */
export const maxDiagnosticsProperty = {
  type: 'integer' as const,
  minimum: 1,
  maximum: MAX_DIAGNOSTICS_LIMIT,
  description:
    `Cap on returned diagnostics (default ${DEFAULT_MAX_DIAGNOSTICS}). ` +
    'Repeats of one defect collapse into the first, which then carries ' +
    '`context.occurrences`; errors are kept ahead of warnings when the cap ' +
    'still bites.',
};

/** The `truncated` output property that goes with it. */
export const truncatedProperty = {
  type: 'boolean' as const,
  description: '`diagnostics` was capped by `maxDiagnostics`.',
};
