/**
 * Format-independent renderer contracts.
 *
 * This module deliberately knows nothing about DOCX or PPTX semantics. Each
 * format owns its own intermediate representation (`DocxIR`, `PptxIR`) and its
 * own feature union; the only thing shared between them is the shape of the
 * contract a backend adapter must satisfy.
 *
 * Do not add format-specific feature names, IR nodes or units here.
 */

/** The Office formats this repository can produce. */
export type OfficeFormat = 'docx' | 'pptx';

/**
 * Options every renderer accepts.
 *
 * `deterministic` asks the adapter (and the packaging step after it) to make
 * output byte-stable across runs: fixed zip entry timestamps, fixed core
 * metadata timestamps, no random identifiers.
 *
 * `generatedAt` pins the timestamp written into package metadata. Callers that
 * want reproducible bytes pass both.
 */
export interface RenderOptions {
  deterministic?: boolean;
  generatedAt?: Date;
}

/**
 * A backend that turns a format-specific IR into package bytes.
 *
 * @typeParam TIR - the format's intermediate representation (plain data)
 * @typeParam TFeature - the format's feature union (see `capabilities.ts`)
 * @typeParam TId - the string-literal union of renderer ids for the format
 */
export interface OfficeRenderer<
  TIR,
  TFeature extends string,
  TId extends string,
> {
  readonly id: TId;
  readonly format: OfficeFormat;
  readonly capabilities: ReadonlySet<TFeature>;

  render(document: TIR, options?: RenderOptions): Promise<Uint8Array>;
}

/**
 * Exhaustiveness guard for discriminated-union switches.
 *
 * Reaching this at runtime means an IR node kind was added without a matching
 * `case`, so it throws rather than silently dropping content.
 */
export function assertNever(value: never, context?: string): never {
  const described = describeUnhandled(value);
  throw new Error(
    context
      ? `Unhandled variant in ${context}: ${described}`
      : `Unhandled variant: ${described}`
  );
}

function describeUnhandled(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return String(value);
  }
  const kind = (value as { kind?: unknown }).kind;
  const type = (value as { type?: unknown }).type;
  if (typeof kind === 'string') return `kind="${kind}"`;
  if (typeof type === 'string') return `type="${type}"`;
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
