import type { OfficeFormat } from './types';

/**
 * Diagnostics raised when an IR asks a renderer for something it cannot do.
 *
 * These are distinct from `GenerationWarning` (see `../types/warnings`), which
 * describes authoring problems found while building the document. A renderer
 * diagnostic describes a *backend* limitation: the document is fine, this
 * particular adapter just cannot express part of it.
 */

export type RendererDiagnosticSeverity = 'error' | 'warning';

/**
 * One unsupported (or degraded) feature at one place in the IR.
 *
 * `path` is an IR path such as `slides[2].elements[0].fill` — not an author-JSON
 * path — because the check runs against compiled IR. Compilers record the
 * authoring path alongside where it is useful for the message text.
 */
export interface RendererDiagnostic<TFeature extends string = string> {
  feature: TFeature;
  path: string;
  severity: RendererDiagnosticSeverity;
  message: string;
}

export interface UnsupportedRendererFeatureErrorInit<
  TFeature extends string = string,
> {
  format: OfficeFormat;
  rendererId: string;
  diagnostics: readonly RendererDiagnostic<TFeature>[];
}

/**
 * Aggregated failure thrown *before* rendering starts.
 *
 * One error carries every unsupported feature found in the IR so a caller sees
 * the whole gap at once instead of fixing them one render at a time.
 */
export class UnsupportedRendererFeatureError<
  TFeature extends string = string,
> extends Error {
  public readonly code = 'UNSUPPORTED_RENDERER_FEATURE';
  public readonly format: OfficeFormat;
  public readonly rendererId: string;
  /** Distinct unsupported features, in first-seen order. */
  public readonly features: readonly TFeature[];
  /** Distinct IR paths that required them, in first-seen order. */
  public readonly paths: readonly string[];
  /** Every error-severity diagnostic that produced this failure. */
  public readonly diagnostics: readonly RendererDiagnostic<TFeature>[];

  constructor(init: UnsupportedRendererFeatureErrorInit<TFeature>) {
    const { format, rendererId, diagnostics } = init;
    const features = distinct(diagnostics.map((d) => d.feature));
    const paths = distinct(diagnostics.map((d) => d.path));

    super(formatMessage(format, rendererId, diagnostics, features));

    this.name = 'UnsupportedRendererFeatureError';
    this.format = format;
    this.rendererId = rendererId;
    this.features = features;
    this.paths = paths;
    this.diagnostics = [...diagnostics];

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsupportedRendererFeatureError);
    }
  }
}

/**
 * A renderer id that is not registered for the format asked for.
 *
 * Caller input, not an infrastructure failure — which is the whole reason it is
 * a class with a `code` rather than a bare `Error`. A server matching on the
 * message text could only answer `500`, so an unknown id looked like the
 * service falling over, and a retry looked worth attempting (#263).
 */
export class UnknownRendererError extends Error {
  public readonly code = 'UNKNOWN_RENDERER';
  public readonly format: OfficeFormat;
  /** What the caller asked for. */
  public readonly rendererId: string;
  /** Every id registered for this format, in registration order. */
  public readonly availableIds: readonly string[];

  constructor(
    format: OfficeFormat,
    rendererId: string,
    availableIds: readonly string[]
  ) {
    const known = availableIds.map((id) => `"${id}"`).join(', ');
    super(
      `Unknown ${format} renderer "${rendererId}". Available renderers: ${known}.`
    );

    this.name = 'UnknownRendererError';
    this.format = format;
    this.rendererId = rendererId;
    this.availableIds = [...availableIds];

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnknownRendererError);
    }
  }
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function formatMessage<TFeature extends string>(
  format: OfficeFormat,
  rendererId: string,
  diagnostics: readonly RendererDiagnostic<TFeature>[],
  features: readonly TFeature[]
): string {
  const featureList = features.map((f) => `"${f}"`).join(', ');
  const lines = diagnostics.map(
    (d) => `  - ${d.feature} at ${d.path}: ${d.message}`
  );
  return (
    `The "${rendererId}" ${format} renderer does not support ${features.length} ` +
    `required feature(s): ${featureList}.\n${lines.join('\n')}`
  );
}

/** Build a `RendererDiagnostic` with `severity: 'error'`. */
export function rendererError<TFeature extends string>(
  feature: TFeature,
  path: string,
  message: string
): RendererDiagnostic<TFeature> {
  return { feature, path, severity: 'error', message };
}

/** Build a `RendererDiagnostic` with `severity: 'warning'`. */
export function rendererWarning<TFeature extends string>(
  feature: TFeature,
  path: string,
  message: string
): RendererDiagnostic<TFeature> {
  return { feature, path, severity: 'warning', message };
}

/** Split diagnostics into blocking errors and non-blocking warnings. */
export function partitionDiagnostics<TFeature extends string>(
  diagnostics: readonly RendererDiagnostic<TFeature>[]
): {
  errors: RendererDiagnostic<TFeature>[];
  warnings: RendererDiagnostic<TFeature>[];
} {
  const errors: RendererDiagnostic<TFeature>[] = [];
  const warnings: RendererDiagnostic<TFeature>[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') errors.push(diagnostic);
    else warnings.push(diagnostic);
  }
  return { errors, warnings };
}
