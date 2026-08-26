/**
 * Structured results, not protocol errors.
 *
 * A JSON-RPC error tells the agent "the call failed" and nothing it can act
 * on. Every defect this server can describe — a bad document, an unknown
 * handle, a missing host binary — is therefore a normal tool RESULT carrying
 * path-addressed diagnostics, which the agent can read, repair and retry.
 * Protocol errors stay reserved for transport and server failures (#202).
 */

import {
  runWithDiagnosticSink,
  type DiagnosticTone,
} from '@json-to-office/jto-ops';
import {
  RENDERER_DEPENDENCY_MISSING,
  type QualityFinding,
  type ValidationError,
} from '@json-to-office/shared';
import { ValueErrorType } from '@sinclair/typebox/errors';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * One machine-actionable defect.
 *
 * `path` is an RFC 6901 JSON Pointer into the document the tool was given, so
 * an agent holding a workspace handle can turn a diagnostic straight into a
 * JSON Patch target (#271).
 */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** Stable machine code — see `ERROR_CODES`. */
  code: string;
  message: string;
  /** JSON Pointer into the offending document, when the defect has a location. */
  path?: string;
  /** What to do about it, in one sentence. */
  suggestion?: string;
  /** Free-form extras (offending value, component name, renderer id, …). */
  context?: Record<string, unknown>;
}

/**
 * The envelope every tool's `structuredContent` starts from.
 *
 * `ok` is the single field a caller must branch on; `diagnostics` is always
 * present (possibly empty) so clients never special-case its absence.
 */
export interface ToolEnvelope {
  ok: boolean;
  diagnostics: Diagnostic[];
}

/**
 * Stable codes. Callers — including our own tests and downstream agents —
 * branch on these, so treat them as API: add freely, rename never.
 *
 * `E_` for something that blocks, `W_` for something that does not. Every
 * `code` this server puts on the wire is one of these: the validators speak
 * three private dialects of their own (TypeBox ordinals, snake_case, the
 * cores' own names) and `normalizeCode` maps all three in here at the
 * boundary, so an agent has exactly one vocabulary to branch on.
 */
export const ERROR_CODES = {
  /** An exception escaped a tool handler. Always a bug here, never the caller's. */
  INTERNAL: 'E_INTERNAL',
  /** Neither `document` nor `handle` was supplied. */
  DOC_SOURCE_MISSING: 'E_DOC_SOURCE_MISSING',
  /** Both `document` and `handle` were supplied. */
  DOC_SOURCE_AMBIGUOUS: 'E_DOC_SOURCE_AMBIGUOUS',
  /** `handle` names no open workspace on this connection. */
  UNKNOWN_HANDLE: 'E_UNKNOWN_HANDLE',
  /** `revision` does not match the workspace's current revision. */
  STALE_REVISION: 'E_STALE_REVISION',
  /** A handle was used but no workspace store is installed (#271 not wired). */
  WORKSPACES_UNAVAILABLE: 'E_WORKSPACES_UNAVAILABLE',
  /** A requested output name resolved outside the output root. */
  OUTPUT_ROOT_ESCAPE: 'E_OUTPUT_ROOT_ESCAPE',
  /** Inline base64 was requested for an artifact over the size limit. */
  ARTIFACT_TOO_LARGE: 'E_ARTIFACT_TOO_LARGE',
  /** The document failed a rule that has no more specific code. */
  INVALID_DOCUMENT: 'E_INVALID_DOCUMENT',
  /** The document could not be parsed as JSON. */
  INVALID_JSON: 'E_INVALID_JSON',
  /** A property the schema requires is absent. */
  REQUIRED_PROPERTY: 'E_REQUIRED_PROPERTY',
  /** A property the component does not declare. */
  UNEXPECTED_PROPERTY: 'E_UNEXPECTED_PROPERTY',
  /** A value of the wrong JSON type. */
  TYPE_MISMATCH: 'E_TYPE_MISMATCH',
  /** No branch of a union accepted the value. */
  UNION_MISMATCH: 'E_UNION_MISMATCH',
  /** Right type, outside the schema's bounds, length, pattern or format. */
  VALUE_CONSTRAINT: 'E_VALUE_CONSTRAINT',
  /** Right type and shape, but not a value this position accepts. */
  INVALID_VALUE: 'E_INVALID_VALUE',
  /** `name` is not a component this format registers, or not one allowed here. */
  UNKNOWN_COMPONENT: 'E_UNKNOWN_COMPONENT',
  /** Two props that exclude each other were both set. */
  MUTUALLY_EXCLUSIVE: 'E_MUTUALLY_EXCLUSIVE',
  /** A theme the document names does not exist. */
  THEME_NOT_FOUND: 'E_THEME_NOT_FOUND',
  /** The document is empty. */
  EMPTY_DOCUMENT: 'E_EMPTY_DOCUMENT',
  /** The renderer could draw the document, but not this one feature of it. */
  UNSUPPORTED_RENDERER_FEATURE: 'W_UNSUPPORTED_RENDERER_FEATURE',
  /** A note the render host emitted mid-run (unknown theme, unreadable theme file). */
  HOST_NOTE: 'W_HOST_NOTE',
  /** A generation warning the core raised without a code of its own. */
  GENERATION: 'W_GENERATION',
  /** A required host binary (LibreOffice, poppler) is absent. */
  DEPENDENCY_MISSING: 'E_DEPENDENCY_MISSING',
  /** The client cancelled the request. */
  CANCELLED: 'E_CANCELLED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Build one diagnostic; `severity` defaults to `error`. */
export function diagnostic(
  code: string,
  message: string,
  extra: Omit<Diagnostic, 'code' | 'message' | 'severity'> & {
    severity?: DiagnosticSeverity;
  } = {}
): Diagnostic {
  const { severity = 'error', ...rest } = extra;
  return { severity, code, message, ...rest };
}

/**
 * TypeBox names its defect kinds by ordinal, bucketed into our vocabulary.
 *
 * Order matters: the first rule that matches wins, so the two property rules
 * run before the constraint rule that would otherwise claim
 * `IntersectUnevaluatedProperties`. Anything left over — `String`, `Number`,
 * `Object`, `Literal`, `Never` — names a JSON type, which is a type mismatch.
 */
const TYPEBOX_BUCKETS: readonly (readonly [RegExp, string])[] = [
  [/^ObjectRequiredProperty$/, ERROR_CODES.REQUIRED_PROPERTY],
  [
    /^(ObjectAdditionalProperties|IntersectUnevaluatedProperties)$/,
    ERROR_CODES.UNEXPECTED_PROPERTY,
  ],
  [/^Union$/, ERROR_CODES.UNION_MISMATCH],
  [
    /Maximum|Minimum|MultipleOf|Items|Contains|Length|Pattern|Format|Properties/,
    ERROR_CODES.VALUE_CONSTRAINT,
  ],
];

/** `ValueErrorType` the other way round: "45" -> "ObjectRequiredProperty". */
const TYPEBOX_NAMES = new Map<string, string>(
  Object.entries(ValueErrorType)
    .filter(([, ordinal]) => typeof ordinal === 'number')
    .map(([name, ordinal]) => [String(ordinal), name])
);

/**
 * The cores' own spellings, which name defects TypeBox has no kind for.
 *
 * A Map rather than an object literal: the key is a validator's string, and a
 * plain object would answer `constructor` with a function.
 */
const CORE_CODES = new Map<string, string>(
  Object.entries({
    required: ERROR_CODES.REQUIRED_PROPERTY,
    required_property: ERROR_CODES.REQUIRED_PROPERTY,
    unknown_field: ERROR_CODES.UNEXPECTED_PROPERTY,
    invalid_type: ERROR_CODES.TYPE_MISMATCH,
    invalid_value: ERROR_CODES.INVALID_VALUE,
    unsupported_value: ERROR_CODES.INVALID_VALUE,
    unknown_component: ERROR_CODES.UNKNOWN_COMPONENT,
    mutually_exclusive: ERROR_CODES.MUTUALLY_EXCLUSIVE,
    theme_not_found: ERROR_CODES.THEME_NOT_FOUND,
    empty_input: ERROR_CODES.EMPTY_DOCUMENT,
    json_parse_error: ERROR_CODES.INVALID_JSON,
    unsupported_renderer_feature: ERROR_CODES.UNSUPPORTED_RENDERER_FEATURE,
    // `shared-docx`'s catch-all for a rule with no kind of its own, and the
    // marker it puts on a validator that threw. Neither is more specific than
    // "the document did not pass".
    custom: ERROR_CODES.INVALID_DOCUMENT,
    validation_exception: ERROR_CODES.INTERNAL,
  })
);

/**
 * One validator code, mapped into the published vocabulary.
 *
 * The transformer in `shared` stringifies TypeBox's `ValueErrorType` straight
 * into `code`, so a wrong prop type reached agents as `"54"`. Ordinals are an
 * internal enum — they renumber whenever TypeBox inserts a member — and they
 * appear in no table we publish, so an agent branching on `code` matched
 * nothing for the single commonest defect class there is. The ordinal is
 * therefore resolved back through the enum this package has installed and
 * bucketed by name; the raw spelling survives in `context.validatorCode` for
 * anyone debugging the validator itself.
 *
 * Codes already in the namespace pass through, so a caller that builds one
 * with `diagnostic()` is never rewritten.
 */
export function normalizeCode(code: string | undefined): string {
  if (code === undefined) return ERROR_CODES.INVALID_DOCUMENT;
  if (/^[EW]_/.test(code)) return code;

  const core = CORE_CODES.get(code);
  if (core !== undefined) return core;

  const name = TYPEBOX_NAMES.get(code);
  if (name === undefined) return ERROR_CODES.INVALID_DOCUMENT;
  for (const [pattern, mapped] of TYPEBOX_BUCKETS) {
    if (pattern.test(name)) return mapped;
  }
  return ERROR_CODES.TYPE_MISMATCH;
}

/**
 * One core generation-warning code, mapped into the published vocabulary.
 *
 * The cores raise warnings under bare SCREAMING_SNAKE names — `FONT_UNRESOLVED`,
 * `CHART_NO_DATA`, `UNKNOWN_SHAPE`. Those carry neither prefix, so an agent
 * deciding whether to stop by reading the first two characters matched neither
 * `E_` nor `W_` and fell through on the one class of diagnostic that is always
 * safe to continue past. Prefixing keeps that test total; the core's own
 * spelling stays on `context.code`, which is what the CLI prints and what a
 * caller comparing the two surfaces reads.
 */
export function normalizeWarningCode(code: string | undefined): string {
  if (code === undefined || code === '') return ERROR_CODES.GENERATION;
  if (/^[EW]_/.test(code)) return code;
  return `W_${code.toUpperCase()}`;
}

/**
 * Adapt the repo's `ValidationError` to a diagnostic.
 *
 * The two shapes already agree on `path`/`message`/`suggestion`; the mapping
 * exists to give every diagnostic a code from one published vocabulary, so
 * clients can always switch on `code`.
 */
export function fromValidationError(
  error: ValidationError,
  severity: DiagnosticSeverity = 'error'
): Diagnostic {
  const code = normalizeCode(error.code);
  const context = {
    ...(error.value !== undefined && { value: error.value }),
    ...(error.code !== undefined &&
      error.code !== code && { validatorCode: error.code }),
  };
  return {
    severity,
    code,
    message: error.message,
    ...(error.path !== undefined && { path: error.path }),
    ...(error.suggestion !== undefined && { suggestion: error.suggestion }),
    ...(Object.keys(context).length > 0 && { context }),
  };
}

export function fromValidationErrors(
  errors: readonly ValidationError[] | undefined,
  severity: DiagnosticSeverity = 'error'
): Diagnostic[] {
  return (errors ?? []).map((error) => fromValidationError(error, severity));
}

/** A failed operation: `ok: false` plus at least one diagnostic. */
export interface Failure extends ToolEnvelope {
  ok: false;
}

export function failure(
  code: string,
  message: string,
  extra: Omit<Diagnostic, 'code' | 'message' | 'severity'> & {
    severity?: DiagnosticSeverity;
  } = {}
): Failure {
  return { ok: false, diagnostics: [diagnostic(code, message, extra)] };
}

export function failureFrom(diagnostics: Diagnostic[]): Failure {
  return { ok: false, diagnostics };
}

/** A successful operation, with room for the non-fatal diagnostics it collected. */
export function success<T extends object>(
  payload: T,
  diagnostics: Diagnostic[] = []
): T & ToolEnvelope {
  return { ok: true, diagnostics, ...payload };
}

/**
 * The two-channel result every tool returns.
 *
 * `structuredContent` is what the schema-aware client reads; the text block is
 * the same object stringified, which is what a client without structured
 * output support (and every transcript) sees. They are never allowed to
 * disagree, hence one argument.
 */
export function toolResult<T extends object>(
  payload: T
): {
  content: [{ type: 'text'; text: string }];
  structuredContent: T;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

/**
 * Errors that are the host's fault rather than ours.
 *
 * `shared`'s renderer loader renames a failed backend import so the missing
 * package can be told apart from a bug. `E_INTERNAL` on one of those reads as
 * "a bug here" and sends the agent to file an issue when the fix is an install
 * line, which the message already carries.
 */
const HOST_DEPENDENCY_ERRORS = new Set([RENDERER_DEPENDENCY_MISSING]);

/**
 * Whether a stack trace may ride along on an internal failure.
 *
 * Off by default. A stack is absolute filesystem paths and our own module
 * layout, and it goes into whatever transcript the client keeps — the agent
 * reading it can do nothing with either, and the user did not ask to publish
 * their home directory. `JTO_MCP_DEBUG_STACKS=1` puts it back for the case it
 * was there for, which is someone debugging this server.
 */
function stackAllowed(): boolean {
  const flag = process.env.JTO_MCP_DEBUG_STACKS;
  return flag === '1' || flag === 'true';
}

/** A line `jto-ops` emitted mid-run, as a diagnostic the agent can read. */
function hostNote(text: string, tone: DiagnosticTone = 'muted'): Diagnostic {
  return {
    // Never `error`. The body has already decided `ok` by the time a note
    // lands, so an error-severity note would contradict the verdict beside it.
    severity: tone === 'error' || tone === 'warning' ? 'warning' : 'info',
    code: ERROR_CODES.HOST_NOTE,
    message: text,
  };
}

/**
 * Drop the notes the tool already reported properly.
 *
 * `jto-ops` forwards every structured `GenerationWarning` to the sink as
 * `"<component>: <message>"` on its way past, so a tool that collects
 * `options.warnings` — `jto_generate` does — would report each of them twice,
 * once with its component and code and once as a bare line. The structured
 * copy is the better one, so the echo goes.
 */
function withoutEchoes(
  notes: readonly Diagnostic[],
  reported: readonly Diagnostic[]
): Diagnostic[] {
  if (reported.length === 0) return [...notes];
  return notes.filter(
    (note) =>
      !reported.some(
        (entry) =>
          note.message === entry.message ||
          note.message.endsWith(`: ${entry.message}`)
      )
  );
}

/**
 * Fold the run's notes into the envelope the tool is about to return.
 *
 * Every tool result carries `ok`/`diagnostics`; `jto_preview` alone keeps its
 * envelope one level down in `payload`, because the page bytes ride in content
 * blocks beside it. Those two shapes are exhaustive today — a third would
 * quietly drop its notes rather than grow a field its `outputSchema` does not
 * declare, which the SDK would reject outright.
 */
function withHostNotes<T extends object>(
  result: T,
  notes: readonly Diagnostic[]
): T {
  if (notes.length === 0) return result;
  const own = (result as { diagnostics?: unknown }).diagnostics;
  if (Array.isArray(own)) {
    const fresh = withoutEchoes(notes, own as Diagnostic[]);
    return fresh.length > 0
      ? { ...result, diagnostics: [...own, ...fresh] }
      : result;
  }
  const payload = (result as { payload?: { diagnostics?: unknown } }).payload;
  if (payload !== undefined && Array.isArray(payload.diagnostics)) {
    const reported = payload.diagnostics as Diagnostic[];
    const fresh = withoutEchoes(notes, reported);
    if (fresh.length === 0) return result;
    return {
      ...result,
      payload: { ...payload, diagnostics: [...reported, ...fresh] },
    };
  }
  return result;
}

/**
 * Run a tool body, converting anything that escapes into a diagnostic and
 * collecting the warnings the run emitted along the way.
 *
 * Without the first half an exception becomes a JSON-RPC error, which is
 * exactly the signal we reserve for transport failures — the agent would be
 * told the server broke when in fact one document did.
 *
 * The second half is why the sink is installed here and not once per
 * connection: `runWithDiagnosticSink` is `AsyncLocalStorage.run`, so a sink
 * wrapped around server setup is long gone by the time a request arrives on a
 * later turn of the loop, and every "Unknown theme …" `jto-ops` emitted was
 * dropped. One request is the largest scope that actually holds, and it is
 * also the one the agent can read — the notes come back in `diagnostics`
 * beside the result they belong to instead of on a stderr no client parses.
 */
export async function guarded<T extends object>(
  body: () => Promise<T>
): Promise<T | Failure> {
  const notes: Diagnostic[] = [];
  try {
    const result = await runWithDiagnosticSink(
      (text, tone) => notes.push(hostNote(text, tone)),
      body
    );
    return withHostNotes(result, notes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof Error && HOST_DEPENDENCY_ERRORS.has(error.name)
        ? ERROR_CODES.DEPENDENCY_MISSING
        : ERROR_CODES.INTERNAL;
    return withHostNotes(
      failure(code, message, {
        context: {
          ...(stackAllowed() &&
            error instanceof Error &&
            error.stack !== undefined && { stack: error.stack }),
        },
      }),
      notes
    );
  }
}

/**
 * Codes for defects in the REQUEST rather than in the document.
 *
 * `ERROR_CODES` covers the document and the transport; these cover the options
 * an agent chose, which are a third thing — an agent that asked for a renderer
 * that does not exist has nothing to repair in its JSON.
 */
export const OPTION_ERROR_CODES = {
  /** `renderer` names no renderer this format registers. */
  UNKNOWN_RENDERER: 'E_UNKNOWN_RENDERER',
  /** `date` is not parseable as a date. */
  INVALID_DATE: 'E_INVALID_DATE',
  /** `themePath` is not a data-only JSON theme path. */
  INVALID_THEME_PATH: 'E_INVALID_THEME_PATH',
  /** The tool does not support the requested format. */
  UNSUPPORTED_FORMAT: 'E_UNSUPPORTED_FORMAT',
} as const;

/**
 * Findings both cores drop from their generation gate.
 *
 * `core-docx`'s `generateBufferWithWarnings` and `core-pptx`'s
 * `assertValidPresentationForGeneration` both filter this code out before
 * deciding whether to throw, because the compiler's capability pass is the
 * authority on what a renderer can actually draw. `jto_validate` exists to
 * predict generation, so it demotes them to warnings rather than sending an
 * agent to repair a document that renders — the finding, its code and its path
 * all survive.
 */
const DEFERRED_TO_COMPILER = new Set<string>([
  ERROR_CODES.UNSUPPORTED_RENDERER_FEATURE,
]);

/** Path spellings the validators use for "the document itself". */
const ROOT_SENTINELS = new Set(['', '/', '#', 'root']);

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Normalize a validator path to an RFC 6901 JSON Pointer.
 *
 * The validators speak two dialects. The document validators emit
 * pointer-shaped strings already (`/children/0/props/text`) but leave `~`
 * unescaped and spell the root `root`; the older component validators emit
 * JavaScript-ish paths (`children[0].props.text`, `name`). Both end up here so
 * that every diagnostic this server hands back can be used verbatim as a JSON
 * Patch target against a workspace document (#271).
 */
export function toJsonPointer(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const trimmed = path.trim();
  if (ROOT_SENTINELS.has(trimmed)) return '';

  const segments = trimmed.startsWith('/')
    ? trimmed.slice(1).split('/')
    : trimmed
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter((segment) => segment !== '');

  if (segments.length === 0) return '';
  return `/${segments.map(escapePointerSegment).join('/')}`;
}

/**
 * Drop the type complaint TypeBox adds to a property it just called missing.
 *
 * An absent required prop comes back twice — `ObjectRequiredProperty` and then
 * the type check on the same absent value, at the same pointer. The second is
 * not a second repair: an agent that adds the property fixes both, and an
 * agent that trusts the count thinks its document is twice as broken as it is.
 */
function collapseMissingProperties(diagnostics: Diagnostic[]): Diagnostic[] {
  const missing = new Set(
    diagnostics
      .filter((entry) => entry.code === ERROR_CODES.REQUIRED_PROPERTY)
      .map((entry) => entry.path)
  );
  if (missing.size === 0) return diagnostics;
  return diagnostics.filter(
    (entry) =>
      entry.code !== ERROR_CODES.TYPE_MISMATCH || !missing.has(entry.path)
  );
}

/** Adapt validator errors to diagnostics, with pointers and gate-faithful severity. */
export function validationDiagnostics(
  errors: readonly ValidationError[] | undefined
): Diagnostic[] {
  return collapseMissingProperties(
    fromValidationErrors(errors).map((entry) => {
      const pointer = toJsonPointer(entry.path);
      return {
        ...entry,
        ...(DEFERRED_TO_COMPILER.has(entry.code) && {
          severity: 'warning' as const,
        }),
        ...(pointer !== undefined && { path: pointer }),
      };
    })
  );
}

/**
 * Adapt the cores' design-quality findings (#216) to diagnostics.
 *
 * Nothing to normalize: the collectors already speak the published vocabulary
 * (`W_QUALITY_*`), carry RFC 6901 pointers, and decide their own severity —
 * always `warning` or `info`, so a quality finding can never flip a tool's
 * `ok`. The mapping exists only to change the field spelling.
 */
export function qualityDiagnostics(
  findings: readonly QualityFinding[]
): Diagnostic[] {
  return findings.map((finding) => ({
    severity: finding.severity,
    code: finding.code,
    message: finding.message,
    path: finding.path,
    ...(finding.suggestion !== undefined && {
      suggestion: finding.suggestion,
    }),
    ...(finding.context !== undefined && { context: finding.context }),
  }));
}

function looksLikeValidationErrors(value: unknown): value is ValidationError[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { message?: unknown }).message === 'string'
    )
  );
}

/**
 * Diagnostics out of an exception, when the exception is really a bad document.
 *
 * Both cores gate generation by throwing — `JsonValidationError` carrying
 * `validationErrors`, `PresentationValidationError` carrying `errors`. Left
 * alone those become `E_INTERNAL`, which tells an agent the server broke when
 * in fact its JSON did. Duck-typed rather than `instanceof`, because the
 * classes live inside the cores that `jto-ops` deliberately imports on demand.
 */
export function diagnosticsFromThrown(
  error: unknown
): Diagnostic[] | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { validationErrors?: unknown; errors?: unknown };
  if (looksLikeValidationErrors(candidate.validationErrors)) {
    return validationDiagnostics(candidate.validationErrors);
  }
  if (looksLikeValidationErrors(candidate.errors)) {
    return validationDiagnostics(candidate.errors);
  }
  return undefined;
}

export interface DiagnosticCounts {
  error: number;
  warning: number;
  info: number;
}

/** Diagnostics by severity. `error > 0` is what every tool gates `ok` on. */
export function countDiagnostics(
  diagnostics: readonly Diagnostic[]
): DiagnosticCounts {
  return {
    error: diagnostics.filter((entry) => entry.severity === 'error').length,
    warning: diagnostics.filter((entry) => entry.severity === 'warning').length,
    info: diagnostics.filter((entry) => entry.severity === 'info').length,
  };
}
