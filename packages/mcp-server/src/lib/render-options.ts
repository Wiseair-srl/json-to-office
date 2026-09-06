/**
 * Checks on the render OPTIONS, before any document is touched.
 *
 * `renderOptionProperties` is one bag shared by generate, preview and diff, so
 * a value one tool rejects and another forwards straight into the core is a
 * difference no agent can predict from the schema. Everything here answers in
 * the vocabulary `checkRenderer` already established — the defect is in the
 * request, not in the JSON — and lives beside it rather than inside
 * `lib/errors.ts`, which owns the vocabulary and not the option semantics.
 */

import path from 'path';

import type { FormatAdapter, FormatName } from './adapters.js';
import { loadCore } from './core.js';
import {
  OPTION_ERROR_CODES,
  diagnostic,
  failure,
  type Diagnostic,
  type Failure,
} from './errors.js';

/**
 * A code this module adds. It belongs in `lib/errors.ts`' `OPTION_ERROR_CODES`
 * beside `E_UNKNOWN_RENDERER`, whose shape it deliberately mirrors; it is
 * declared here only because that file is another issue's to edit.
 */
export const UNKNOWN_THEME = 'W_UNKNOWN_THEME';

/** Earliest instant a ZIP local-file header can express. */
const ZIP_EPOCH_YEAR = 1980;

/**
 * Reject an unparseable date option.
 *
 * Both cores raise a plain `Error` over one, which `guarded` can only report as
 * `E_INTERNAL` — the code documented as "always a bug here, never the
 * caller's". It is the caller's, and it is a one-character repair, so it gets a
 * structured refusal naming the option instead of an internal stack trace.
 */
export function checkDateOption(
  option: string,
  value: string | undefined,
  omitHint: string
): Failure | undefined {
  if (value === undefined) return undefined;
  if (!Number.isNaN(new Date(value).getTime())) return undefined;
  return failure(
    OPTION_ERROR_CODES.INVALID_DATE,
    `Invalid ${option} "${value}".`,
    {
      suggestion: `Use ISO 8601, e.g. "2026-06-09T10:00:00Z", or ${omitHint}`,
      context: { option, value },
    }
  );
}

/**
 * `generatedAt`: a date option, plus the ZIP floor.
 *
 * .docx and .pptx are ZIP containers whose entry timestamps start at 1980, and
 * both cores refuse an earlier instant for exactly that reason. Checking it
 * here keeps that refusal a repairable answer rather than an internal error
 * raised deep inside a packaging routine.
 */
export function checkGeneratedAt(
  value: string | undefined
): Failure | undefined {
  const unparseable = checkDateOption(
    'generatedAt',
    value,
    'omit it to stamp the current time.'
  );
  if (unparseable !== undefined || value === undefined) return unparseable;

  if (new Date(value).getUTCFullYear() >= ZIP_EPOCH_YEAR) return undefined;
  return failure(
    OPTION_ERROR_CODES.INVALID_DATE,
    `generatedAt "${value}" is before 1980.`,
    {
      suggestion:
        'Office files are ZIP containers, whose entry timestamps start at 1980-01-01; pick a later instant.',
      context: { option: 'generatedAt', value },
    }
  );
}

export type ResolvedThemePath = { ok: true; path?: string } | Failure;

/**
 * Keep the MCP surface data-only and make its relative-path rule explicit.
 *
 * `jto-ops` also serves the CLI, where executable JS theme modules remain a
 * deliberate power-user feature. An MCP caller is different: repository files
 * are untrusted input, so forwarding a module path into dynamic `import()`
 * would execute it with the server's privileges.
 */
export function resolveThemePathOption(
  themePath: string | undefined,
  baseDir: string | undefined
): ResolvedThemePath {
  if (themePath === undefined) return { ok: true };
  if (path.extname(themePath) !== '.json') {
    return failure(
      OPTION_ERROR_CODES.INVALID_THEME_PATH,
      `themePath must name a data-only .json theme, not "${themePath}".`,
      {
        suggestion:
          'Use a .json theme file. Executable JavaScript theme modules are not accepted over MCP.',
        context: { option: 'themePath', value: themePath },
      }
    );
  }
  const root = baseDir === undefined ? process.cwd() : path.resolve(baseDir);
  return { ok: true, path: path.resolve(root, themePath) };
}

/**
 * Built-in theme names, so a diagnostic can list what would have worked.
 *
 * The adapter is the authority and is asked first. It answers `{}` from a
 * bundled ESM build, where its synchronous `require` of the core meets tsup's
 * throwing shim, so the core loaded through `loadCore` answers instead. Both
 * branches collapse into one the day jto-ops loads its themes asynchronously.
 */
export async function builtinThemeNames(
  adapter: FormatAdapter
): Promise<string[]> {
  const fromAdapter = Object.keys(adapter.getBuiltinThemes());
  if (fromAdapter.length > 0) return fromAdapter.sort();
  return (await loadCore(adapter.name))?.themeNames ?? [];
}

/**
 * The DOCX core's own `props.theme` warning, as it reaches a diagnostic.
 *
 * The core raises it as `theme_not_found`; `normalizeWarningCode` lifts it into
 * the published namespace before it gets here, so this matches the normalized
 * spelling rather than the core's.
 */
const CORE_THEME_NOT_FOUND = 'W_THEME_NOT_FOUND';

/** `props.theme` of a document, when it names one. */
function documentTheme(document: unknown): string | undefined {
  if (typeof document !== 'object' || document === null) return undefined;
  const props = (document as { props?: unknown }).props;
  if (typeof props !== 'object' || props === null) return undefined;
  const theme = (props as { theme?: unknown }).theme;
  return typeof theme === 'string' && theme.length > 0 ? theme : undefined;
}

function unknownTheme(
  format: FormatName,
  name: string,
  known: readonly string[],
  source: 'theme' | 'props.theme'
): Diagnostic {
  const where =
    source === 'theme' ? '.' : "; it came from the document's `props.theme`.";
  // What actually happened differs by source, and an agent comparing two runs
  // will notice: an ignored `theme` leaves the document's own theme standing,
  // while an ignored `props.theme` leaves nothing but the built-in default.
  const fell =
    source === 'theme'
      ? "This render kept the document's own theme."
      : 'This render used the built-in default.';
  const names = known.map((id) => `"${id}"`).join(', ');
  return diagnostic(
    UNKNOWN_THEME,
    `Unknown ${format} theme "${name}"${where}`,
    {
      severity: 'warning',
      suggestion:
        known.length > 0
          ? `Use one of: ${names}, or a path to a theme file. ${fell}`
          : `Use a name from jto_discover.formats[].themes, or a path to a theme file. ${fell}`,
      context: { format, theme: name, themes: [...known], source },
    }
  );
}

/**
 * Themes that were asked for and did not happen.
 *
 * `createGenerator` reports the theme it settled on, and both adapters leave
 * that undefined in exactly one case: a named theme that resolved to nothing —
 * no built-in of that name, no readable file, no inline JSON — after which the
 * render falls back without saying so. Reading their verdict rather than
 * re-deciding it here is what keeps a legitimate theme FILE from being reported
 * as a typo.
 *
 * `props.theme` is a separate question, and asked only when no option overrode
 * it: the DOCX core already reports an unresolvable one (as `W_THEME_NOT_FOUND`)
 * and the PPTX core does not, so a warning that is already present is never
 * repeated.
 */
export async function themeDiagnostics(
  adapter: FormatAdapter,
  input: {
    requested?: string;
    resolved?: string;
    document: unknown;
    reported: readonly Diagnostic[];
  }
): Promise<Diagnostic[]> {
  if (input.resolved !== undefined) return [];

  if (input.requested !== undefined) {
    return [
      unknownTheme(
        adapter.name,
        input.requested,
        await builtinThemeNames(adapter),
        'theme'
      ),
    ];
  }

  const inDocument = documentTheme(input.document);
  if (inDocument === undefined) return [];
  if (input.reported.some((entry) => entry.code === CORE_THEME_NOT_FOUND)) {
    return [];
  }
  const known = await builtinThemeNames(adapter);
  if (known.length === 0 || known.includes(inDocument)) return [];
  return [unknownTheme(adapter.name, inDocument, known, 'props.theme')];
}
